import { z } from 'zod';
import { Reminder, publicReminder } from '../models/Reminder.js';
import { Task } from '../models/Task.js';
import { AppError } from '../utils/AppError.js';
import { isoDateTime, objectId, pagination } from '../utils/schemas.js';
import { formatLocal } from '../utils/time.js';
import { scheduleReminderJob } from './reminder.scheduling.js';
import * as activity from './activity.service.js';

const GRACE_MS = 30_000; // allow "now" reminders despite small clock differences
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

function assertFutureTime(date) {
  const now = Date.now();
  if (date.getTime() < now - GRACE_MS) throw AppError.badRequest('That time has already passed. Pick a time in the future.');
  if (date.getTime() > now + MAX_AHEAD_MS) throw AppError.badRequest('Reminders can be at most a year ahead.');
}

export const createReminderSchema = z.object({
  text: z.string().trim().min(1, 'What should I remind you about?').max(300),
  remindAt: isoDateTime,
  taskId: objectId.optional(),
});

export const updateReminderSchema = z
  .object({
    text: z.string().trim().min(1).max(300).optional(),
    remindAt: isoDateTime.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const snoozeSchema = z
  .object({
    minutes: z.coerce.number().int().min(1).max(7 * 24 * 60).optional(),
    until: isoDateTime.optional(),
  })
  .refine((v) => (v.minutes === undefined) !== (v.until === undefined), 'Give either minutes or until.');

export const listRemindersSchema = z.object({
  status: z.enum(['scheduled', 'sent', 'cancelled', 'all']).default('scheduled'),
  ...pagination,
});

export async function list(userId, query) {
  const match = { userId };
  if (query.status !== 'all') match.status = query.status;
  const sort = query.status === 'scheduled' ? { remindAt: 1 } : { remindAt: -1 };
  const [rows, total] = await Promise.all([
    Reminder.find(match).sort(sort).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Reminder.countDocuments(match),
  ]);
  return { reminders: rows.map(publicReminder), total, page: query.page, limit: query.limit };
}

export async function get(userId, id) {
  const reminder = await Reminder.findOne({ _id: id, userId });
  if (!reminder) throw AppError.notFound('Reminder not found.');
  return reminder;
}

export async function create(user, { text, remindAt, taskId }, { actor = 'user' } = {}) {
  assertFutureTime(remindAt);
  if (taskId && !(await Task.exists({ _id: taskId, userId: user._id, deletedAt: null }))) {
    throw AppError.badRequest('The linked task was not found.');
  }
  // Same text at the same minute already scheduled: treat as the same reminder (no duplicates
  // from a double click or the agent repeating itself).
  const minute = new Date(Math.floor(remindAt.getTime() / 60_000) * 60_000);
  const existing = await Reminder.findOne({
    userId: user._id,
    status: 'scheduled',
    text,
    remindAt: { $gte: minute, $lt: new Date(minute.getTime() + 60_000) },
  });
  if (existing) return { reminder: existing, duplicate: true };

  const reminder = await Reminder.create({ userId: user._id, text, remindAt, taskId: taskId ?? null, source: actor });
  await scheduleReminderJob(reminder);
  await activity.record({
    userId: user._id,
    actor,
    action: 'reminder.created',
    entityType: 'reminder',
    entity: reminder,
    summary: `Reminder "${text}" for ${formatLocal(remindAt, user.timezone)}`,
  });
  return { reminder, duplicate: false };
}

async function mutate(user, id, { actor, action, summary, apply }) {
  const reminder = await get(user._id, id);
  const before = activity.snapshot('reminder', reminder);
  apply(reminder);
  await reminder.save();
  if (reminder.status === 'scheduled') await scheduleReminderJob(reminder);
  await activity.record({ userId: user._id, actor, action, entityType: 'reminder', entity: reminder, before, summary: summary(reminder) });
  return reminder;
}

export async function update(user, id, changes, { actor = 'user' } = {}) {
  const current = await get(user._id, id);
  if (current.status === 'cancelled') throw AppError.conflict('This reminder was cancelled.');
  if (changes.remindAt) assertFutureTime(changes.remindAt);
  return mutate(user, id, {
    actor,
    action: 'reminder.updated',
    summary: (r) => `Changed reminder "${r.text}" to ${formatLocal(r.remindAt, user.timezone)}`,
    apply: (r) => {
      Object.assign(r, changes);
      // Moving a reminder that already went off to a new time schedules it again.
      if (changes.remindAt && r.status === 'sent') {
        r.status = 'scheduled';
        r.sentAt = null;
      }
    },
  });
}

export async function snooze(user, id, { minutes, until }, { actor = 'user' } = {}) {
  const current = await get(user._id, id);
  if (current.status === 'cancelled') throw AppError.conflict('This reminder was cancelled.');
  const remindAt = until ?? new Date(Date.now() + minutes * 60_000);
  assertFutureTime(remindAt);
  return mutate(user, id, {
    actor,
    action: 'reminder.snoozed',
    summary: (r) => `Snoozed "${r.text}" to ${formatLocal(r.remindAt, user.timezone)}`,
    apply: (r) => {
      r.remindAt = remindAt;
      r.status = 'scheduled';
      r.sentAt = null;
      r.snoozeCount += 1;
    },
  });
}

export async function cancel(user, id, { actor = 'user' } = {}) {
  const current = await get(user._id, id);
  if (current.status === 'cancelled') return current;
  // The already-queued job sees status "cancelled" when it runs and does nothing.
  return mutate(user, id, {
    actor,
    action: 'reminder.cancelled',
    summary: (r) => `Cancelled reminder "${r.text}"`,
    apply: (r) => {
      r.status = 'cancelled';
    },
  });
}
