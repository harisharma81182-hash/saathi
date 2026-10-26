import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../utils/schemas.js';
import { publicMemory } from '../models/Memory.js';
import { openSse } from '../utils/sse.js';
import * as agent from '../services/agent.service.js';
import * as alerts from '../services/alerts.service.js';
import * as memory from '../services/memory.service.js';

export const agentRouter = Router();
agentRouter.use(requireAuth);

/**
 * Chat with Saathi. The reply is streamed with Server-Sent Events (SSE): one HTTP response that
 * stays open and sends small events as things happen:
 *
 *   start       { conversationId, userMessageId }
 *   expression  { expression }                 face to show
 *   text        { delta }                      next piece of the reply
 *   reset       { text }                       a retry happened: replace the reply text with this
 *   tool        { id, name, status }           running / done / failed
 *   receipt     { id, tool, summary, activities }   what changed, with activity ids for Undo
 *   confirm     { id, type, summary, expiresAt }    show Confirm / Cancel
 *   error       { code, message }              friendly message, the rest of the app keeps working
 *   done        { message }                    the saved reply
 *
 * Problems found before streaming starts (bad input, unknown conversation, no API key) are normal
 * JSON errors with a status code.
 */
agentRouter.post('/chat', validate({ body: agent.chatSchema }), async (req, res) => {
  const turn = await agent.startTurn(req.user, req.valid.body);
  const { send, close } = openSse(res);

  // The user closed the tab or pressed Stop: cancel the AI call instead of paying for an unread reply.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort(new Error('client went away'));
  });

  // Remember what was done, so a user who closed the app mid-reply still learns about it.
  const receipts = [];
  let replyText = '';
  const emit = (event, data) => {
    if (event === 'receipt') receipts.push(data);
    if (event === 'done') replyText = data.message?.text ?? '';
    send(event, data);
  };

  try {
    await agent.runTurn(turn, { emit, signal: controller.signal });
  } finally {
    close();
  }
  if (controller.signal.aborted && receipts.length) {
    await alerts
      .confirmAgentWork(req.user._id, { replyText, receipts, messageId: String(turn.userMessage._id), appClosed: true })
      .catch((err) => req.log.warn({ err: err.message }, 'agent confirmation not sent'));
  }
});

agentRouter.get('/greeting', async (req, res) => {
  res.json(await agent.greeting(req.user));
});

agentRouter.get('/conversations', async (req, res) => {
  res.json({ conversations: await agent.listConversations(req.user._id) });
});

agentRouter.get(
  '/conversations/:id/messages',
  validate({ params: idParams, query: agent.messagesQuerySchema }),
  async (req, res) => {
    res.json(await agent.listMessages(req.user._id, req.valid.params.id, req.valid.query));
  },
);

agentRouter.post('/actions/:id/confirm', validate({ params: idParams }), async (req, res) => {
  res.json(await agent.confirmAction(req.user, req.valid.params.id));
});

agentRouter.post('/actions/:id/cancel', validate({ params: idParams }), async (req, res) => {
  res.json(await agent.cancelAction(req.user, req.valid.params.id));
});

// What Saathi remembers. Settings lists these, and the user can add or delete them.
agentRouter.get('/memories', async (req, res) => {
  res.json({ memories: await memory.list(req.user._id, { limit: memory.MAX_MEMORIES }) });
});

agentRouter.post('/memories', validate({ body: memory.rememberSchema }), async (req, res) => {
  const { memory: saved, duplicate } = await memory.remember(req.user._id, req.valid.body, { source: 'user' });
  res.status(duplicate ? 200 : 201).json({ memory: publicMemory(saved), duplicate });
});

agentRouter.delete('/memories/:id', validate({ params: idParams }), async (req, res) => {
  await memory.remove(req.user._id, req.valid.params.id);
  res.status(204).end();
});
