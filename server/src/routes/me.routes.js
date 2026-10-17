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
import * as notifications from '../services/notification.service.js';
import * as activity from '../services/activity.service.js';

// Endpoints about "my day": the Today panel, progress, typing hints, notifications, and the
// activity timeline with Undo.
export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/today', async (req, res) => {
  res.json(await agenda.today(req.user));
});

meRouter.get('/progress', async (req, res) => {
  res.json(await agenda.weeklyProgress(req.user));
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
