import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { Conversation, publicConversation } from '../models/Conversation.js';
import { Message, publicMessage } from '../models/Message.js';
import { PendingAction, publicPendingAction } from '../models/PendingAction.js';
import { AppError } from '../utils/AppError.js';
import { objectId } from '../utils/schemas.js';
import { TtlCache } from '../utils/ttlCache.js';
import { formatLocal } from '../utils/time.js';
import { formatIssues } from '../middleware/validate.js';
import { getProvider, getGateway } from '../ai/provider.js';
import { PERSONA, buildContext } from '../ai/prompt.js';
import { TOOLS_BY_NAME, TOOL_DEFINITIONS } from '../ai/tools.js';
import { ExpressionFilter, DEFAULT_EXPRESSION, splitExpression } from '../ai/expression.js';
import { enqueue } from '../jobs/queue.js';
import * as agenda from './agenda.service.js';
import * as memory from './memory.service.js';
import * as activity from './activity.service.js';
import * as tasks from './task.service.js';

// Saathi's brain: one chat turn.
//
//   user message -> Claude (with tools) -> Claude asks for tools -> we run them through the normal
//   services -> results go back to Claude -> ... -> Claude writes the final reply
//
// While this runs, `emit(event, data)` streams progress to the browser: reply text as it is written,
// the face expression, a "receipt" for every change (with ids for Undo), and Confirm/Cancel
// requests for destructive actions.

const log = logger.child({ component: 'agent' });

export const MAX_STEPS = 6; // model calls per turn; the last one may not use tools, so a turn always ends
const MAX_TOKENS = 4096; // reply + the model's thinking
const HISTORY_MESSAGES = 20; // recent messages sent with every request; older ones live in the summary
const SUMMARIZE_AFTER = 40; // unsummarised messages before the background summary job runs
const OLD_MESSAGE_MS = 6 * 60 * 60 * 1000; // older user messages get a timestamp, so "kal" stays clear

export const chatSchema = z.object({
  message: z.string().trim().min(1, 'Type a message first.').max(2000, 'That message is too long. Keep it under 2000 characters.'),
  conversationId: objectId.optional(),
});

// Request settings shared by every call. Claude Haiku 5.5 thinks adaptively by default; "low"
// effort keeps chat replies quick and cheap. No temperature (not accepted by the current models).
function requestParams(model, system, messages, extra = {}) {
  return { model, max_tokens: MAX_TOKENS, system, messages, output_config: { effort: 'low' }, ...extra };
}

function systemBlocks(context) {
  return [
    { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: context },
  ];
}

async function loadContext(user, conversation, now = new Date()) {
  const [today, memories, recentChanges] = await Promise.all([
    agenda.today(user, now),
    memory.list(user._id, { limit: 60 }),
    activity.list(user._id, { limit: 6 }),
  ]);
  return buildContext({ user, now, today, memories, summary: conversation?.summary, recentChanges });
}

/** Recent messages in the shape the API expects: alternating user / assistant, starting with user. */
async function historyMessages(user, conversation, now = new Date()) {
  const match = { conversationId: conversation._id, status: 'ok' };
  if (conversation.summarizedThrough) match.createdAt = { $gt: conversation.summarizedThrough };
  const rows = (await Message.find(match).sort({ createdAt: -1 }).limit(HISTORY_MESSAGES).lean()).reverse();

  const out = [];
  for (const m of rows) {
    let text = m.text || '';
    if (m.role === 'user' && now - m.createdAt > OLD_MESSAGE_MS) text = `[${formatLocal(m.createdAt, user.timezone)}] ${text}`;
    if (m.role === 'assistant') {
      text = `[face:${m.expression ?? DEFAULT_EXPRESSION}] ${text}`;
      const done = m.toolCalls.filter((t) => t.ok && t.summary).map((t) => t.summary);
      if (done.length) text += `\n<actions>${done.join('; ')}</actions>`;
    }
    const last = out.at(-1);
    if (last?.role === m.role) last.content += `\n\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

/**
 * First half of a chat turn, before anything is streamed: checks that the AI is available, finds
 * the conversation (only the user's own) and saves the user's message. Errors here become normal
 * JSON error responses.
 */
export async function startTurn(user, { message, conversationId }) {
  const provider = getProvider(); // throws a clear 503 if no API key is configured

  let conversation;
  if (conversationId) {
    conversation = await Conversation.findOne({ _id: conversationId, userId: user._id });
    if (!conversation) throw AppError.notFound('Conversation not found.');
  } else {
    // Saathi is one friend with one ongoing chat: continue the latest conversation.
    conversation =
      (await Conversation.findOne({ userId: user._id }).sort({ lastMessageAt: -1 })) ??
      (await Conversation.create({ userId: user._id, title: message.slice(0, 60) }));
  }

  const userMessage = await Message.create({ userId: user._id, conversationId: conversation._id, role: 'user', text: message });
  await Conversation.updateOne({ _id: conversation._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: userMessage.createdAt } });
  return { user, conversation, userMessage, provider };
}

/** Second half: the model/tool loop, streaming events through `emit`. Never throws; failures become an "error" event. */
export async function runTurn({ user, conversation, userMessage, provider }, { emit = () => {}, signal } = {}) {
  const gateway = getGateway();
  const ctx = { user, conversationId: conversation._id, userMessageId: userMessage._id };
  emit('start', { conversationId: String(conversation._id), userMessageId: String(userMessage._id) });

  const toolCalls = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let text = '';
  let expression = null;
  let model = null;
  let failure = null;

  try {
    const system = systemBlocks(await loadContext(user, conversation));
    const messages = await historyMessages(user, conversation);

    for (let step = 0; step < MAX_STEPS; step++) {
      const lastStep = step === MAX_STEPS - 1;
      const textBeforeStep = text;
      let stepText = '';
      let filter;

      const response = await gateway.run({
        // The per-user quota counts chat messages, not the internal steps of one message.
        userId: step === 0 ? String(user._id) : undefined,
        continuation: step > 0, // the app-wide limit never cuts a message off halfway
        signal,
        call: ({ model: m, signal: callSignal }) => {
          // A retry after a failed attempt: drop the half-written text of that attempt.
          if (stepText) {
            stepText = '';
            emit('reset', { text: textBeforeStep });
          }
          filter = new ExpressionFilter({
            onExpression: (e) => {
              expression = e;
              emit('expression', { expression: e });
            },
          });
          const extra = { tools: TOOL_DEFINITIONS, ...(lastStep && { tool_choice: { type: 'none' } }) };
          return provider.send(requestParams(m, system, messages, extra), {
            signal: callSignal,
            onText: (delta) => {
              let out = filter.push(delta);
              if (!out) return;
              if (!stepText && textBeforeStep) out = `\n\n${out.trimStart()}`;
              stepText += out;
              emit('text', { delta: out });
            },
          });
        },
      });

      const rest = filter.flush();
      if (rest) {
        stepText += rest;
        emit('text', { delta: rest });
      }
      text += stepText;
      model = response.model;
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
      usage.cacheReadTokens += response.usage?.cache_read_input_tokens ?? 0;

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        if (response.stop_reason === 'refusal' && !text.trim()) failure = { code: 'AI_REFUSED', message: "I can't help with that one." };
        break;
      }

      // Keep the whole assistant turn (including thinking blocks) so the model can continue it.
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      // One at a time and in order: "create task, then set a reminder for it" depends on order.
      for (const call of toolUses) results.push(await runTool(ctx, call, { emit, toolCalls }));
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (signal?.aborted) {
      failure = { code: 'CANCELLED', message: 'Stopped.' };
    } else if (err instanceof AppError) {
      failure = { code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds };
    } else {
      log.error({ err }, 'agent turn failed');
      failure = { code: 'INTERNAL', message: 'Something went wrong on my side. Try again in a moment.' };
    }
  }

  // Save the reply, even a partial one: tool calls that already ran did change the user's data.
  const ok = Boolean(text.trim()) || (!failure && toolCalls.length > 0);
  const saved = await Message.create({
    userId: user._id,
    conversationId: conversation._id,
    role: 'assistant',
    text: text.trim(),
    expression: failure && !text.trim() ? 'sorry' : (expression ?? DEFAULT_EXPRESSION),
    toolCalls,
    status: ok ? 'ok' : 'failed',
    model,
    usage,
  });
  const conv = await Conversation.findOneAndUpdate(
    { _id: conversation._id },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: saved.createdAt } },
    { returnDocument: 'after' },
  );
  log.info({ conversationId: String(conversation._id), model, steps: toolCalls.length, ...usage, failed: Boolean(failure) }, 'agent turn');
  await maybeSummarize(conv).catch((err) => log.warn({ err: err.message }, 'could not queue summary'));

  if (failure) emit('error', failure);
  emit('done', { message: publicMessage(saved) });
  return saved;
}

/** Runs one tool call and returns the tool_result block for the model. */
async function runTool(ctx, call, { emit, toolCalls }) {
  const tool = TOOLS_BY_NAME.get(call.name);
  const record = (ok, summary, activities = []) =>
    toolCalls.push({ name: call.name, input: call.input, ok, summary, activityIds: activities.map((a) => a._id) });
  const fail = (message) => {
    record(false, message);
    emit('tool', { id: call.id, name: call.name, status: 'failed', message });
    return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: message };
  };

  if (!tool) return fail(`There is no tool called "${call.name}".`);

  const parsed = tool.input.safeParse(call.input ?? {});
  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues).map((i) => (i.field ? `${i.field}: ${i.message}` : i.message));
    return fail(`Invalid input. ${issues.join(' ')} Fix these and call the tool again.`);
  }

  emit('tool', { id: call.id, name: call.name, status: 'running' });
  const activities = [];
  try {
    const { result } = await activity.captureActivities(() => tool.run(ctx, parsed.data), activities);
    const summary = result.summary ?? activities.map((a) => a.summary).join('; ');
    record(true, summary, activities);
    emit('tool', { id: call.id, name: call.name, status: 'done' });
    if (activities.length || result.summary) {
      emit('receipt', {
        id: call.id,
        tool: call.name,
        summary,
        activities: activities.map((a) => ({ id: String(a._id), action: a.action, entityType: a.entityType, entityId: String(a.entityId), summary: a.summary })),
      });
    }
    if (result.confirm) emit('confirm', result.confirm);
    return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result.data) };
  } catch (err) {
    if (!(err instanceof AppError)) log.error({ err, tool: call.name }, 'tool failed');
    const message =
      err instanceof AppError ? err.message : 'That failed because of a problem on our side. Tell the user it did not work and suggest trying again later.';
    // Some changes may have happened before the error (e.g. half of a study plan). Show them, so they can be undone.
    if (activities.length) {
      emit('receipt', {
        id: call.id,
        tool: call.name,
        summary: activities.map((a) => a.summary).join('; '),
        activities: activities.map((a) => ({ id: String(a._id), action: a.action, entityType: a.entityType, entityId: String(a.entityId), summary: a.summary })),
      });
    }
    const out = fail(message);
    toolCalls.at(-1).activityIds = activities.map((a) => a._id);
    return out;
  }
}

async function maybeSummarize(conv) {
  if (!conv) return;
  const match = { conversationId: conv._id };
  if (conv.summarizedThrough) match.createdAt = { $gt: conv.summarizedThrough };
  const unsummarised = await Message.countDocuments(match);
  if (unsummarised < SUMMARIZE_AFTER) return;
  await enqueue('agent.summarize', { conversationId: String(conv._id) }, { dedupeKey: `summarize:${conv._id}:${conv.messageCount}` });
}

/**
 * Background job: folds older messages into the conversation's rolling summary, keeping the most
 * recent HISTORY_MESSAGES as they are. Safe to run twice: it only saves if nobody else updated
 * the summary in the meantime.
 */
export async function summarizeConversation(conversationId) {
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) return { skipped: 'deleted' };
  const match = { conversationId: conv._id };
  if (conv.summarizedThrough) match.createdAt = { $gt: conv.summarizedThrough };
  const rows = await Message.find(match).sort({ createdAt: 1 }).lean();
  const old = rows.slice(0, rows.length - HISTORY_MESSAGES);
  if (old.length < 10) return { skipped: 'too few messages' };

  const transcript = old.map((m) => `${m.role === 'user' ? 'User' : 'Saathi'}: ${m.text}`).join('\n');
  const provider = getProvider();
  const response = await getGateway().run({
    call: ({ model, signal }) =>
      provider.send(
        requestParams(
          model,
          'You maintain a running summary of a chat between a student and Saathi, their AI friend. Merge the new messages into the existing summary. Keep what matters later: plans, commitments, deadlines, how they were feeling, things Saathi promised, open questions. Drop small talk. Plain prose, at most 200 words, in English.',
          [{ role: 'user', content: `Existing summary:\n${conv.summary || '(none)'}\n\nNew messages:\n${transcript}` }],
        ),
        { signal },
      ),
  });
  const summary = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().slice(0, 6000);
  if (!summary) throw new Error('empty summary');

  const res = await Conversation.updateOne(
    { _id: conv._id, summarizedThrough: conv.summarizedThrough },
    { $set: { summary, summarizedThrough: old.at(-1).createdAt } },
  );
  return { summarized: old.length, saved: res.modifiedCount === 1 };
}

// Greetings are generated fresh, but opening the app five times in a minute should not cost five calls.
const greetingCache = new TtlCache({ ttlMs: 5 * 60 * 1000, maxEntries: 10_000 });

/** A fresh one- or two-line greeting for when the user opens the app. */
export async function greeting(user, { signal } = {}) {
  const cached = greetingCache.get(String(user._id));
  if (cached) return cached;

  const provider = getProvider();
  const conversation = await Conversation.findOne({ userId: user._id }).sort({ lastMessageAt: -1 }).lean();
  const context = await loadContext(user, conversation);
  const recent = conversation
    ? (await Message.find({ conversationId: conversation._id, status: 'ok' }).sort({ createdAt: -1 }).limit(4).lean())
        .reverse()
        .map((m) => `${m.role === 'user' ? user.name : 'You'}: ${m.text}`)
        .join('\n')
    : '';

  const response = await getGateway().run({
    userId: String(user._id),
    signal,
    call: ({ model, signal: callSignal }) =>
      provider.send(
        requestParams(model, systemBlocks(context), [
          {
            role: 'user',
            content: `(${user.name} just opened the app. Greet them in one or two short lines, the way a close friend would at this time of day. Mention the most useful thing from their day if there is one. No tools.)${recent ? `\n\nYour last messages together:\n${recent}` : ''}`,
          },
        ]),
        { signal: callSignal },
      ),
  });

  const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const { text, expression } = splitExpression(raw);
  if (!text) throw new AppError(503, 'AI_UNAVAILABLE', "I couldn't think of a greeting just now. Try again in a moment.");
  const out = { text, expression, generatedAt: new Date().toISOString() };
  greetingCache.set(String(user._id), out);
  return out;
}

export async function listConversations(userId) {
  const rows = await Conversation.find({ userId }).sort({ lastMessageAt: -1 }).limit(20).lean();
  return rows.map(publicConversation);
}

export const messagesQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Messages of one conversation, newest page first (pass `before` to load older ones). */
export async function listMessages(userId, conversationId, { before, limit }) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId }).lean();
  if (!conversation) throw AppError.notFound('Conversation not found.');
  const match = { conversationId: conversation._id };
  if (before) match.createdAt = { $lt: new Date(before) };
  const rows = await Message.find(match).sort({ createdAt: -1 }).limit(limit).lean();
  return { conversation: publicConversation(conversation), messages: rows.reverse().map(publicMessage) };
}

/**
 * The user tapped Confirm on something the agent proposed. Claiming the action is one atomic
 * update (pending -> confirmed), so a double click cannot run it twice.
 */
export async function confirmAction(user, id) {
  const action = await claimAction(user, id, 'confirmed');
  const activities = [];
  try {
    await activity.captureActivities(async () => {
      if (action.type === 'task.delete') await tasks.remove(user._id, action.payload.taskId, { actor: 'agent' });
    }, activities);
  } catch (err) {
    // The task is gone already (deleted elsewhere): nothing left to confirm.
    await PendingAction.updateOne({ _id: action._id }, { $set: { status: 'cancelled' } });
    throw err;
  }
  return {
    action: publicPendingAction({ ...action.toObject(), status: 'confirmed' }),
    activities: activities.map((a) => ({ id: String(a._id), action: a.action, entityType: a.entityType, entityId: String(a.entityId), summary: a.summary })),
  };
}

export async function cancelAction(user, id) {
  const action = await claimAction(user, id, 'cancelled');
  return { action: publicPendingAction({ ...action.toObject(), status: 'cancelled' }) };
}

async function claimAction(user, id, status) {
  const claimed = await PendingAction.findOneAndUpdate(
    { _id: id, userId: user._id, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status } },
    { returnDocument: 'before' },
  );
  if (claimed) return claimed;
  const existing = await PendingAction.findOne({ _id: id, userId: user._id }).lean();
  if (!existing) throw AppError.notFound('That request was not found.');
  if (existing.status !== 'pending') throw AppError.conflict(`That was already ${existing.status}.`);
  throw AppError.conflict('That request expired. Ask Saathi again if you still want it.');
}
