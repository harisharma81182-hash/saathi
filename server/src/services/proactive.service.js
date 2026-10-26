import { DateTime } from 'luxon';
import { Task, publicTask } from '../models/Task.js';
import { User } from '../models/User.js';
import { Activity } from '../models/Activity.js';
import { Message } from '../models/Message.js';
import { Notification } from '../models/Notification.js';
import { logger } from '../lib/logger.js';
import { aiConfigured } from '../ai/provider.js';
import { formatLocal } from '../utils/time.js';
import * as notifications from './notification.service.js';
import * as tasks from './task.service.js';
import { proactiveMessage, postProactiveMessage } from './agent.service.js';
import { countdown, inMorningWindow, morning } from './alerts.service.js';

// Saathi speaking first. A scan runs every 30 minutes (jobs/periodic.js) and, for each user who
// used the app in the last week, looks at their local time:
//
//    7:00 to  8:59  morning: "Aaj ka din" and exam/deadline countdowns (services/alerts.service.js);
//                   these go out even without the AI, as plain text
//
//   10:00 to 20:59  nudge: overdue tasks get a friendly push ("lab file ka kya hua?"), at most once
//                   per task per day and at most MAX_NUDGES_PER_DAY messages a day; never at night
//   21:00 to 22:29  recap: a short summary of the day, once a day, only if they were active today,
//                   with a button to move leftovers to tomorrow
//
// Nudges and recaps are written by the AI with the user's context. If the AI is unavailable they are
// simply not sent (a nice-to-have, unlike a reminder), and the next scan tries again.

const log = logger.child({ component: 'proactive' });

export const NUDGE_HOURS = { from: 10, to: 21 }; // local time, [from, to)
export const RECAP_WINDOW = { from: { hour: 21, minute: 0 }, to: { hour: 22, minute: 30 } };
export const MAX_NUDGES_PER_DAY = 2;
const OVERDUE_GRACE_MS = 30 * 60_000; // a task 5 minutes late is not worth a message yet
const ACTIVE_DAYS = 7;
const MAX_USERS_PER_SCAN = 500;

/** Users who did something (a change or a chat message) in the last week. */
async function activeUserIds(now) {
  const since = new Date(now.getTime() - ACTIVE_DAYS * 24 * 60 * 60_000);
  const [a, m] = await Promise.all([
    Activity.distinct('userId', { createdAt: { $gte: since } }),
    Message.distinct('userId', { role: 'user', createdAt: { $gte: since } }),
  ]);
  const ids = new Map([...a, ...m].map((id) => [String(id), id]));
  return [...ids.values()].slice(0, MAX_USERS_PER_SCAN);
}

export async function runScan({ now = new Date() } = {}) {
  const ai = aiConfigured();
  const ids = await activeUserIds(now);
  const users = await User.find({ _id: { $in: ids } }).lean();
  const out = { users: users.length, mornings: 0, countdowns: 0, nudges: 0, recaps: 0 };
  for (const user of users) {
    // One user's problem (AI busy, bad data) must not stop the scan for everyone else.
    try {
      const local = DateTime.fromJSDate(now, { zone: user.timezone });
      if (inMorningWindow(local)) {
        if (await morning(user, now)) out.mornings++;
        if (await countdown(user, now)) out.countdowns++;
      }
      if (ai && local.hour >= NUDGE_HOURS.from && local.hour < NUDGE_HOURS.to && (await nudge(user, now))) out.nudges++;
      if (ai && inRecapWindow(local) && (await recap(user, now))) out.recaps++;
    } catch (err) {
      log.warn({ userId: String(user._id), err: err.message }, 'proactive message skipped');
    }
  }
  return out;
}

function inRecapWindow(local) {
  const minutes = local.hour * 60 + local.minute;
  const { from, to } = RECAP_WINDOW;
  return minutes >= from.hour * 60 + from.minute && minutes < to.hour * 60 + to.minute;
}

/** Sends one nudge about overdue tasks, if there are any not nudged today. Returns true if sent. */
export async function nudge(user, now = new Date()) {
  const tz = user.timezone;
  const today = DateTime.fromJSDate(now, { zone: tz }).toISODate();
  const startOfDay = DateTime.fromJSDate(now, { zone: tz }).startOf('day').toJSDate();
  const sentToday = await Notification.countDocuments({ userId: user._id, kind: 'nudge', createdAt: { $gte: startOfDay } });
  if (sentToday >= MAX_NUDGES_PER_DAY) return false;

  const candidates = await Task.find({
    userId: user._id,
    deletedAt: null,
    status: 'open',
    dueAt: { $lt: new Date(now.getTime() - OVERDUE_GRACE_MS) },
    nudgedOn: { $ne: today },
  })
    .sort({ priorityRank: 1, dueAt: 1 })
    .limit(3)
    .lean();
  // Claim each task for today first (atomic), so two scans running at once never nudge twice.
  const claimed = [];
  for (const t of candidates) {
    const res = await Task.updateOne({ _id: t._id, nudgedOn: { $ne: today } }, { $set: { nudgedOn: today } }, { timestamps: false });
    if (res.modifiedCount === 1) claimed.push(t);
  }
  if (claimed.length === 0) return false;

  const list = claimed.map((t) => `"${t.title}" (was due ${formatLocal(t.dueAt, tz)}, id ${t._id})`).join('; ');
  let line;
  try {
    line = await proactiveMessage(
      user,
      `You are messaging ${user.name} first; they did not write to you. These tasks are overdue: ${list}. Send one short WhatsApp-style message: ask about it like a friend, light and kind, no guilt trip, and offer one concrete next step (do it now, or you set a reminder for a better time). One or two sentences.`,
    );
  } catch (err) {
    // No AI right now: give the tasks back, so a later scan can try again today.
    await Task.updateMany({ _id: { $in: claimed.map((t) => t._id) }, nudgedOn: today }, { $set: { nudgedOn: null } }, { timestamps: false });
    throw err;
  }

  await postProactiveMessage(user, { ...line, origin: 'nudge' });
  await notifications.create({
    userId: user._id,
    kind: 'nudge',
    title: claimed.length === 1 ? claimed[0].title : `${claimed.length} kaam baaki hain`,
    body: line.text,
    expression: line.expression,
    refType: 'task',
    refId: claimed[0]._id,
    data: { taskIds: claimed.map((t) => String(t._id)) },
    dedupeKey: `nudge:${user._id}:${today}:${claimed.map((t) => t._id).join(',')}`,
  });
  return true;
}

/**
 * Leftovers of the day: open tasks due today or earlier. Not habits (they just repeat) and not
 * deadlines (an exam or a submission date cannot be moved by us).
 */
async function leftovers(user, now) {
  const end = DateTime.fromJSDate(now, { zone: user.timezone }).endOf('day').toJSDate();
  return Task.find({ userId: user._id, deletedAt: null, status: 'open', kind: 'task', repeat: null, dueAt: { $lte: end } })
    .sort({ dueAt: 1 })
    .limit(50)
    .lean();
}

/** The evening recap, once a day, only if the user was active today. Returns true if sent. */
export async function recap(user, now = new Date()) {
  const tz = user.timezone;
  const day = DateTime.fromJSDate(now, { zone: tz });
  const today = day.toISODate();
  const dedupeKey = `recap:${user._id}:${today}`;
  if (await Notification.exists({ dedupeKey })) return false;

  const start = day.startOf('day').toJSDate();
  const [activeToday, done, left] = await Promise.all([
    Activity.exists({ userId: user._id, createdAt: { $gte: start } }).then(Boolean),
    Task.find({ userId: user._id, deletedAt: null, status: 'done', completedAt: { $gte: start } }).limit(30).lean(),
    leftovers(user, now),
  ]);
  if (!activeToday) return false;

  const titles = (rows) => rows.map((t) => `"${t.title}"`).join(', ') || 'none';
  const line = await proactiveMessage(
    user,
    `It is evening. Write ${user.name}'s day recap as a friend would text it. Done today (${done.length}): ${titles(done)}. Still open from today or before (${left.length}): ${titles(left)}. Celebrate what got done (be specific), mention what is left without guilt${left.length ? ' and say you can move it to tomorrow (the app shows a button for that)' : ''}, and if it is late, tell them to sleep on time. Two or three short sentences.`,
  );

  await postProactiveMessage(user, { ...line, origin: 'recap' });
  await notifications.create({
    userId: user._id,
    kind: 'recap',
    title: `Aaj ka hisaab: ${done.length} done, ${left.length} baaki`,
    body: line.text,
    expression: line.expression,
    data: { done: done.length, leftovers: left.map((t) => String(t._id)) },
    dedupeKey,
  });
  return true;
}

/**
 * The recap's button: move today's leftovers to tomorrow, at the same time of day. Each move goes
 * through the task service, so it is in the activity log and can be undone.
 */
export async function moveLeftoversToTomorrow(user, { now = new Date(), actor = 'user' } = {}) {
  const tz = user.timezone;
  const tomorrow = DateTime.fromJSDate(now, { zone: tz }).plus({ days: 1 });
  const moved = [];
  for (const t of await leftovers(user, now)) {
    const time = DateTime.fromJSDate(t.dueAt, { zone: tz });
    const dueAt = tomorrow.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 }).toJSDate();
    moved.push(await tasks.update(user._id, t._id, { dueAt }, { actor }));
  }
  return { moved: moved.map(publicTask) };
}
