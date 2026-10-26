import { z } from 'zod';
import { DateTime } from 'luxon';
import { logger } from '../lib/logger.js';
import { aiConfigured } from '../ai/provider.js';
import { FocusSession, ACTIVE_FOCUS, MAX_FOCUS_MINUTES, publicFocus } from '../models/FocusSession.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { objectId } from '../utils/schemas.js';
import { enqueue } from '../jobs/queue.js';
import * as activity from './activity.service.js';
import * as tasks from './task.service.js';
import * as notifications from './notification.service.js';
import { proactiveMessage } from './agent.service.js';

// Focus timer: any length (1 minute to 12 hours), on a task or any activity. One active timer per
// user. The end time lives on the server and a job fires when it is reached, so the "time up"
// notification arrives even with every tab closed. A finished session is written to the activity
// timeline and counted in the day's focus minutes.

const log = logger.child({ component: 'focus' });
export const MAX_MINUTES = MAX_FOCUS_MINUTES;
const MIN = 60_000;

export const startSchema = z
  .object({
    minutes: z.coerce.number().int().min(1, 'At least 1 minute.').max(MAX_MINUTES, 'At most 12 hours.'),
    taskId: objectId.optional(),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.taskId || v.label, 'Say what the timer is for (a task or a few words).');
export const extendSchema = z.object({ minutes: z.coerce.number().int().min(1).max(MAX_MINUTES).default(5) });
export const finishSchema = z.object({ done: z.boolean().default(true) });

const fmt = (ms) => {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m} min`;
};

function scheduleEnd(session) {
  return enqueue(
    'focus.end',
    { sessionId: String(session._id), endsAt: session.endsAt.toISOString() },
    { runAt: session.endsAt, maxAttempts: 5, dedupeKey: `focus:${session._id}:${session.endsAt.getTime()}` },
  );
}

async function active(userId) {
  return FocusSession.findOne({ userId, status: { $in: ACTIVE_FOCUS } });
}
async function activeOrFail(userId, id) {
  const s = await FocusSession.findOne({ _id: id, userId });
  if (!s) throw AppError.notFound('Timer not found.');
  if (!ACTIVE_FOCUS.includes(s.status)) throw AppError.conflict('This timer has already ended.');
  return s;
}

/** Time spent running since the last start, added to focusedMs. */
function bank(s, now) {
  if (s.status === 'running' && s.runningSince) s.focusedMs += Math.max(0, Math.min(now, s.endsAt) - s.runningSince);
  s.runningSince = null;
}

export async function current(userId, now = new Date()) {
  const s = await active(userId);
  return s ? publicFocus(s, now) : null;
}

export async function start(user, { minutes, taskId, label }, { actor = 'user', replace = false, now = new Date() } = {}) {
  let task = null;
  if (taskId) {
    task = await Task.findOne({ _id: taskId, userId: user._id, deletedAt: null }).lean();
    if (!task) throw AppError.notFound('Task not found.');
  }
  const existing = await active(user._id);
  if (existing) {
    if (!replace) throw AppError.conflict(`A timer is already running ("${existing.label}"). Finish or cancel it first.`);
    await cancel(user, existing._id, { now });
  }
  let s;
  try {
    s = await FocusSession.create({
      userId: user._id,
      taskId: task?._id ?? null,
      label: label ?? task.title,
      plannedMs: minutes * MIN,
      endsAt: new Date(now.getTime() + minutes * MIN),
      runningSince: now,
      source: actor,
    });
  } catch (err) {
    if (err?.code === 11000) throw AppError.conflict('A timer is already running. Finish or cancel it first.');
    throw err;
  }
  await scheduleEnd(s);
  return publicFocus(s, now);
}

export async function pause(user, id, { now = new Date() } = {}) {
  const s = await activeOrFail(user._id, id);
  if (s.status !== 'running') throw AppError.conflict('The timer is not running.');
  s.remainingMs = Math.max(0, s.endsAt - now);
  bank(s, now);
  s.status = 'paused';
  s.endsAt = null;
  await s.save();
  return publicFocus(s, now);
}

export async function resume(user, id, { now = new Date() } = {}) {
  const s = await activeOrFail(user._id, id);
  if (s.status !== 'paused') throw AppError.conflict('The timer is not paused.');
  s.status = 'running';
  s.runningSince = now;
  s.endsAt = new Date(now.getTime() + s.remainingMs);
  s.remainingMs = null;
  await s.save();
  await scheduleEnd(s);
  return publicFocus(s, now);
}

/** "+5 min" while running or paused, or "10 min aur" after the time ran out. */
export async function extend(user, id, { minutes }, { now = new Date() } = {}) {
  const s = await activeOrFail(user._id, id);
  s.plannedMs += minutes * MIN;
  if (s.status === 'paused') s.remainingMs += minutes * MIN;
  else if (s.status === 'running') s.endsAt = new Date(s.endsAt.getTime() + minutes * MIN);
  else {
    s.status = 'running';
    s.runningSince = now;
    s.endsAt = new Date(now.getTime() + minutes * MIN);
  }
  await s.save();
  if (s.status === 'running') await scheduleEnd(s);
  return publicFocus(s, now);
}

async function end(user, s, status, now) {
  bank(s, now);
  s.status = status;
  s.endsAt = null;
  s.remainingMs = null;
  s.endedAt = now;
  await s.save();
  if (s.focusedMs >= MIN) {
    await activity.record({
      userId: user._id,
      actor: s.source,
      action: status === 'completed' ? 'focus.completed' : 'focus.stopped',
      entityType: 'focus',
      entity: s,
      summary: `${status === 'completed' ? 'Focused' : 'Focused (stopped early)'} ${fmt(s.focusedMs)} on "${s.label}"`,
    });
  }
}

/** "Khatam" or "Ho gaya": ends the timer (and completes its task when done). Returns a celebration line. */
export async function finish(user, id, { done = true } = {}, { now = new Date(), writeLine = celebrationLine } = {}) {
  const s = await activeOrFail(user._id, id);
  await end(user, s, 'completed', now);
  if (done && s.taskId) {
    await tasks.complete(user._id, s.taskId).catch((err) => log.warn({ err: err.message }, 'task not completed after focus'));
  }
  const line = await writeLine(user, s);
  return { focus: publicFocus(s, now), message: line?.text ?? null, expression: line?.expression ?? 'proud', focusedLabel: fmt(s.focusedMs) };
}

export async function cancel(user, id, { now = new Date() } = {}) {
  const s = await activeOrFail(user._id, id);
  await end(user, s, 'cancelled', now);
  return publicFocus(s, now);
}

/** Saathi's short celebration for a finished focus session, or null. Never throws. */
async function celebrationLine(user, s) {
  if (!aiConfigured()) return null;
  try {
    return await proactiveMessage(
      user,
      `${user.name} just finished a focus session on "${s.label}": ${fmt(s.focusedMs)} of real focus (planned ${fmt(s.plannedMs)}). Celebrate it in one short, warm, proud line with one emoji, mentioning the time. In their language.`,
      { signal: AbortSignal.timeout(8_000) },
    );
  } catch {
    return null;
  }
}

/** The job at the end time: the timer becomes "time up" and the user is notified everywhere. */
export async function timeUp({ sessionId, endsAt }, { now = new Date() } = {}) {
  const s = await FocusSession.findById(sessionId);
  if (!s || s.status !== 'running' || s.endsAt?.toISOString() !== endsAt) return { skipped: 'changed' };
  const user = await User.findById(s.userId).lean();
  if (!user) return { skipped: 'no user' };
  bank(s, s.endsAt);
  s.status = 'timeup';
  await s.save();

  let line = null;
  if (aiConfigured()) {
    line = await proactiveMessage(
      user,
      `${user.name}'s focus timer on "${s.label}" (${fmt(s.plannedMs)}) just ended. Write one short, friendly line asking if it is done, offering 10 more minutes if not. In their language.`,
      { signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
  }
  await notifications.create({
    userId: s.userId,
    kind: 'timer',
    title: user.language === 'en' ? `Time's up: ${s.label}` : `Time pura: ${s.label}`,
    body: line?.text ?? (user.language === 'en' ? 'Done? Or 10 more minutes?' : 'Ho gaya? Ya 10 min aur?'),
    expression: line?.expression ?? 'surprised',
    data: { sessionId: String(s._id), taskId: s.taskId ? String(s.taskId) : undefined },
    dedupeKey: `timer:${s._id}:${endsAt}`,
  });
  return { timeUp: true };
}

/** Focus minutes today and in the last 7 days (ended sessions plus the one running now). */
export async function stats(user, now = new Date()) {
  const day = DateTime.fromJSDate(now, { zone: user.timezone }).startOf('day');
  const weekStart = day.minus({ days: 6 }).toJSDate();
  const [ended, live] = await Promise.all([
    FocusSession.find({ userId: user._id, endedAt: { $gte: weekStart } }, { focusedMs: 1, endedAt: 1 }).lean(),
    active(user._id),
  ]);
  let today = 0;
  let week = 0;
  for (const s of ended) {
    week += s.focusedMs;
    if (s.endedAt >= day.toJSDate()) today += s.focusedMs;
  }
  if (live) {
    const ms = publicFocus(live, now).focusedMs;
    today += ms;
    week += ms;
  }
  return { todayMinutes: Math.round(today / MIN), weekMinutes: Math.round(week / MIN) };
}
