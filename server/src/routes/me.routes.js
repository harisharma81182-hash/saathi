import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../utils/schemas.js';
import { publicNotification } from '../models/Notification.js';
import { publicTask } from '../models/Task.js';
import { publicNote } from '../models/Note.js';
import { publicReminder } from '../models/Reminder.js';
import * as agenda from '../services/agenda.service.js';
import * as focus from '../services/focus.service.js';
import * as notifications from '../services/notification.service.js';
import * as activity from '../services/activity.service.js';
import { getLiveHub } from '../services/live.service.js';
import { moveLeftoversToTomorrow } from '../services/proactive.service.js';
import { openSse } from '../utils/sse.js';

// Endpoints about "my day": the Today panel, progress, typing hints, notifications, and the
// activity timeline with Undo.
export const meRouter = Router();
meRouter.use(requireAuth);

/**
 * Live updates (Server-Sent Events). The page keeps this open; see services/live.service.js.
 *   ready         { unreadCount }   connected; fetch the Today panel once now
 *   notification  { notification }
 *   changed       { activity }      refresh what shows this item
 * If the connection drops, the browser's EventSource reconnects by itself.
 */
meRouter.get('/events', async (req, res) => {
  const hub = getLiveHub();
  const { send, close } = openSse(res);
  let disconnect;
  try {
    disconnect = hub.connect(req.user._id, { send, close });
  } catch (err) {
    // Headers are already sent, so report the problem as an event and end the stream
    // (and ask the browser to wait a minute before trying again).
    res.write('retry: 60000\n\n');
    send('error', { code: err.code ?? 'INTERNAL', message: err.message });
    return close();
  }
  res.on('close', disconnect);
  const unread = await notifications.list(req.user._id, { unread: true, page: 1, limit: 1 });
  // Tell the browser to wait 5 s before reconnecting after a drop (default is about 3 s).
  res.write('retry: 5000\n\n');
  send('ready', { unreadCount: unread.unreadCount });
});

// The evening recap's button: move today's unfinished tasks to tomorrow (each move is undoable).
meRouter.post('/leftovers/move-to-tomorrow', async (req, res) => {
  res.json(await moveLeftoversToTomorrow(req.user));
});

meRouter.get('/today', async (req, res) => {
  const [today, focusStats] = await Promise.all([agenda.today(req.user), focus.stats(req.user)]);
  res.json({ ...today, focus: focusStats });
});

meRouter.get('/progress', async (req, res) => {
  const [progress, focusStats] = await Promise.all([agenda.weeklyProgress(req.user), focus.stats(req.user)]);
  res.json({ ...progress, focus: focusStats });
});

meRouter.get('/hints', validate({ query: agenda.hintsSchema }), async (req, res) => {
  res.json(await agenda.hints(req.user._id, req.valid.query.q));
});

meRouter.get('/notifications', validate({ query: notifications.listNotificationsSchema }), async (req, res) => {
  res.json(await notifications.list(req.user._id, req.valid.query));
});

meRouter.post('/notifications/read-all', async (req, res) => {
  res.json({ updated: await notifications.markAllRead(req.user._id) });
});

meRouter.post('/notifications/:id/read', validate({ params: idParams }), async (req, res) => {
  res.json({ notification: publicNotification(await notifications.markRead(req.user._id, req.valid.params.id)) });
});

meRouter.get(
  '/activity',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) }),
  async (req, res) => {
    res.json({ activity: await activity.list(req.user._id, req.valid.query) });
  },
);

const toPublic = { task: publicTask, note: publicNote, reminder: publicReminder };

meRouter.post('/activity/:id/undo', validate({ params: idParams }), async (req, res) => {
  const { activity: undone, entityType, entity } = await activity.undo(req.user._id, req.valid.params.id);
  res.json({ activity: undone, entityType, [entityType]: toPublic[entityType](entity) });
});
