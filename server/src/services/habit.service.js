import { z } from 'zod';
import { DateTime } from 'luxon';
import { Task, publicTask } from '../models/Task.js';
import { User } from '../models/User.js';
import { formatLocal } from '../utils/time.js';
import * as activity from './activity.service.js';

// Habits = repeating tasks ("roz 6 baje gym", "Mon/Wed/Fri DSA practice").
//
// Only one occurrence is open at a time. Completing it creates the next one, at the same local time
// on the next scheduled day that is still ahead. That is idempotent: the occurrence remembers the
// next one it created (nextId), and a unique index on (seriesId, dueAt) makes a second copy
// impossible even if two requests complete it at the same moment.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // luxon: 1 = Monday

export const repeatSchema = z
  .object({
    every: z.enum(['day', 'week']),
    days: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional(),
  })
  .nullable();

/** Luxon weekday numbers this habit happens on; `dueAt` decides for a weekly habit without days. */
function scheduledWeekdays(repeat, dueAt, tz) {
  if (repeat.every === 'day') return null; // every day
  if (repeat.days?.length) return new Set(repeat.days.map((d) => WEEKDAYS.indexOf(d) + 1));
  return new Set([DateTime.fromJSDate(new Date(dueAt), { zone: tz }).weekday]);
}

/** The next due time after `dueAt` that is a scheduled day and still in the future. */
export function nextDueAt(repeat, dueAt, tz, now = new Date()) {
  const days = scheduledWeekdays(repeat, dueAt, tz);
  let d = DateTime.fromJSDate(new Date(dueAt), { zone: tz });
  // Bounded: at most a year of skipped days (a habit nobody touched for months).
  for (let i = 0; i < 400; i++) {
    d = d.plus({ days: 1 });
    if ((!days || days.has(d.weekday)) && d.toJSDate() > now) return d.toJSDate();
  }
  throw new Error('could not find the next occurrence');
}

/** After an occurrence is completed: create the next one (once). Returns it, or null for normal tasks. */
export async function scheduleNext(userId, task, { actor = 'user', now = new Date() } = {}) {
  if (!task.repeat || !task.dueAt || task.nextId) return null;
  const user = await User.findById(userId, { timezone: 1 }).lean();
  const seriesId = task.seriesId ?? task._id;
  const dueAt = nextDueAt(task.repeat, task.dueAt, user.timezone, now);

  let next;
  try {
    next = await Task.create({
      userId,
      title: task.title,
      notes: task.notes,
      kind: task.kind,
      priority: task.priority,
      tags: task.tags,
      repeat: task.repeat,
      dueAt,
      seriesId,
      source: actor,
    });
    await activity.record({
      userId,
      actor,
      action: 'task.created',
      entityType: 'task',
      entity: next,
      summary: `Next "${next.title}": ${formatLocal(dueAt, user.timezone)}`,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Already there: created by a request that completed this at the same moment, or removed by an
    // Undo and now wanted again.
    next = await Task.findOneAndUpdate(
      { seriesId, dueAt },
      { $set: { deletedAt: null } },
      { returnDocument: 'after', timestamps: false },
    );
  }
  // timestamps: false, so the completed occurrence keeps the version its activity entry recorded
  // (Undo of the completion checks that version).
  await Task.updateOne({ _id: task._id }, { $set: { nextId: next._id } }, { timestamps: false });
  return next;
}

/**
 * The completion of `task` was undone (or it was reopened): remove the next occurrence it created,
 * unless the user already changed or completed that one.
 */
export async function dropUntouchedNext(task) {
  if (!task.nextId) return;
  const next = await Task.findOne({ _id: task.nextId, status: 'open', deletedAt: null }).lean();
  if (next && next.updatedAt.getTime() === next.createdAt.getTime()) {
    await Task.updateOne({ _id: next._id }, { $set: { deletedAt: new Date() } }, { timestamps: false });
  }
  await Task.updateOne({ _id: task._id }, { $set: { nextId: null } }, { timestamps: false });
}

/**
 * Days in a row this habit was done, counting back over its scheduled days. Today only counts once
 * it is done (not doing it yet today does not break the streak). Late completions count for the
 * day they were due.
 */
export async function streak(user, task, now = new Date()) {
  const tz = user.timezone;
  const seriesId = task.seriesId ?? task._id;
  const since = DateTime.fromJSDate(now, { zone: tz }).minus({ days: 120 }).toJSDate();
  const done = await Task.find({ userId: user._id, seriesId, status: 'done', deletedAt: null, dueAt: { $gte: since } }, { dueAt: 1 }).lean();
  const doneDays = new Set(done.map((t) => DateTime.fromJSDate(t.dueAt, { zone: tz }).toISODate()));
  const days = scheduledWeekdays(task.repeat, task.dueAt, tz);

  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  let count = 0;
  for (let day = today, i = 0; i < 120; i++, day = day.minus({ days: 1 })) {
    if (days && !days.has(day.weekday)) continue;
    if (doneDays.has(day.toISODate())) count++;
    else if (day.equals(today)) continue;
    else break;
  }
  return count;
}

/** The user's habits: the current open occurrence of each, with its streak. */
export async function list(user, now = new Date()) {
  const open = await Task.find({ userId: user._id, deletedAt: null, status: 'open', repeat: { $ne: null } }).sort({ dueAt: 1 }).limit(50).lean();
  return Promise.all(open.map(async (t) => ({ ...publicTask(t), streak: await streak(user, t, now) })));
}
