import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { idParams } from '../utils/schemas.js';
import { publicReminder } from '../models/Reminder.js';
import * as reminders from '../services/reminder.service.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

remindersRouter.get('/', validate({ query: reminders.listRemindersSchema }), async (req, res) => {
  res.json(await reminders.list(req.user._id, req.valid.query));
});

remindersRouter.post('/', idempotent(), validate({ body: reminders.createReminderSchema }), async (req, res) => {
  const { reminder, duplicate } = await reminders.create(req.user, req.valid.body);
  // 200 instead of 201 when an identical reminder already existed, so the client can tell.
  res.status(duplicate ? 200 : 201).json({ reminder: publicReminder(reminder), duplicate });
});

remindersRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ reminder: publicReminder(await reminders.get(req.user._id, req.valid.params.id)) });
});

remindersRouter.patch('/:id', validate({ params: idParams, body: reminders.updateReminderSchema }), async (req, res) => {
  res.json({ reminder: publicReminder(await reminders.update(req.user, req.valid.params.id, req.valid.body)) });
});

remindersRouter.post('/:id/snooze', validate({ params: idParams, body: reminders.snoozeSchema }), async (req, res) => {
  res.json({ reminder: publicReminder(await reminders.snooze(req.user, req.valid.params.id, req.valid.body)) });
});

remindersRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await reminders.cancel(req.user, req.valid.params.id);
  res.status(204).end();
});
