import { DateTime } from 'luxon';
import { logger } from '../lib/logger.js';
import { aiConfigured } from '../ai/provider.js';
import { Task } from '../models/Task.js';
import { Reminder } from '../models/Reminder.js';
import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';
import { AppError } from '../utils/AppError.js';
import { daysUntil, formatLocal } from '../utils/time.js';
import * as notifications from './notification.service.js';
import * as tasks from './task.service.js';
import * as reminders from './reminder.service.js';
import * as agenda from './agenda.service.js';
import { proactiveMessage } from './agent.service.js';
import { isOnline } from './live.service.js';
import * as focus from './focus.service.js';

// The notifications that are not reminders or nudges:
//
//   due_soon / due_now  a task is due in about an hour / now (scan every 5 minutes, each sent once
//                       per due time; several tasks at once become one notification)
//   morning             "Aaj ka din": today's tasks, deadlines and reminders, once a day, 7 to 9 AM
//   countdown           an exam or deadline is 3 days, 1 day or 0 days away, in the same morning run
//   achievement         a streak or weekly milestone, checked when a task is completed
//   agent               what Saathi did from the chat, only if the app was closed by the time it finished
//
// Every message is written by the AI in the user's language and Saathi's voice. If the AI is busy or
// down, a short plain message goes out instead: these are useful on time, not only when pretty.

const log = logger.child({ component: 'alerts' });
const LINE_TIMEOUT_MS = 12_000;

export const SOON = { minMs: 15 * 60_000, maxMs: 65 * 60_000 }; // "due in about an hour"
export const DUE_GRACE_MS = 15 * 60_000; // "due now" is still sent up to 15 minutes late
export const MORNING_WINDOW = { from: 7, to: 9 }; // local hours [from, to)
export const COUNTDOWN_DAYS = [3, 1, 0];
export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 100];
export const WEEK_MILESTONES = [5, 10, 20, 30, 50];

/** Saathi's line for something, or null if the AI is unavailable or slow. Never throws. */
async function line(user, instruction) {
  if (!aiConfigured()) return null;
  try {
    return await proactiveMessage(user, instruction, { signal: AbortSignal.timeout(LINE_TIMEOUT_MS) });
  } catch (err) {
    log.warn({ userId: String(user._id), err: err.message }, 'AI line not written, using the plain text');
    return null;
  }
}

const english = (user) => user.language === 'en';
const quote = (rows) => rows.map((t) => `"${t.title}"`).join(', ');

// ---- due soon / due now --------------------------------------------------------------------------

/** Claims tasks atomically (so two scans never send the same alert) and groups them by user. */
async function claim(filter, field, now) {
  const found = await Task.find(filter).sort({ dueAt: 1 }).limit(500).lean();
  const byUser = new Map();
  for (const t of found) {
    const res = await Task.updateOne({ _id: t._id, [field]: null }, { $set: { [field]: now } });
    if (res.modifiedCount !== 1) continue;
    const key = String(t.userId);
    byUser.set(key, [...(byUser.get(key) ?? []), t]);
  }
  return byUser;
}

/** Tasks whose own reminder rings at the due time already: no second "due now" for them. */
async function withReminderAtDue(list) {
  const ids = list.map((t) => t._id);
  const rows = await Reminder.find({ taskId: { $in: ids }, status: { $in: ['scheduled', 'sent'] } }, { taskId: 1, remindAt: 1 }).lean();
  const covered = new Set();
  for (const r of rows) {
    const t = list.find((x) => String(x._id) === String(r.taskId));
    if (t && Math.abs(new Date(r.remindAt) - new Date(t.dueAt)) <= DUE_GRACE_MS) covered.add(String(t._id));
  }
  return covered;
}

export async function dueScan({ now = new Date() } = {}) {
  const base = { deletedAt: null, status: 'open' };
  const soon = await claim(
    {
      ...base,
      alertedSoonAt: null,
      dueAt: { $gt: new Date(now.getTime() + SOON.minMs), $lte: new Date(now.getTime() + SOON.maxMs) },
      // Just created: the user knows; no "due in an hour" a few seconds later.
      createdAt: { $lt: new Date(now.getTime() - 10 * 60_000) },
    },
    'alertedSoonAt',
    now,
  );
  const due = await claim(
    { ...base, alertedDueAt: null, dueAt: { $gte: new Date(now.getTime() - DUE_GRACE_MS), $lte: now } },
    'alertedDueAt',
    now,
  );

  const out = { soon: 0, due: 0 };
  const users = await User.find({ _id: { $in: [...new Set([...soon.keys(), ...due.keys()])] } }).lean();
  for (const user of users) {
    try {
      const s = soon.get(String(user._id)) ?? [];
      if (s.length && (await sendDue(user, s, 'due_soon', now))) out.soon++;
      let d = due.get(String(user._id)) ?? [];
      const covered = await withReminderAtDue(d);
      d = d.filter((t) => !covered.has(String(t._id)));
      if (d.length && (await sendDue(user, d, 'due_now', now))) out.due++;
    } catch (err) {
      log.warn({ userId: String(user._id), err: err.message }, 'due alert skipped');
    }
  }
  return out;
}

async function sendDue(user, list, kind, now) {
  const tz = user.timezone;
  const one = list.length === 1;
  const when = (t) => formatLocal(t.dueAt, tz);
  const ai = await line(
    user,
    kind === 'due_soon'
      ? `These tasks of ${user.name} are due in about an hour: ${list.map((t) => `"${t.title}" at ${when(t)}`).join('; ')}. Write a short, friendly heads-up like a friend texting, with one small push to get started. One sentence, in their language.`
      : `These tasks of ${user.name} are due right now: ${quote(list)}. Write a short, friendly nudge to finish or mark them done, like a friend texting. One sentence, in their language.`,
  );
  const title = one
    ? list[0].title
    : english(user)
      ? `${list.length} tasks ${kind === 'due_soon' ? 'due in an hour' : 'due now'}`
      : `${list.length} kaam ${kind === 'due_soon' ? '1 ghante mein due' : 'abhi due'}`;
  const plain =
    kind === 'due_soon'
      ? english(user)
        ? `Due at ${when(list[0])}. Start now and finish on time!`
        : `${when(list[0])} tak karna hai. Abhi shuru kar do!`
      : english(user)
        ? `It's due now. Done? Tick it off.`
        : `Abhi due hai. Ho gaya ho toh tick kar do!`;
  const { created } = await notifications.create({
    userId: user._id,
    kind,
    title,
    body: ai?.text ?? (one ? plain : `${quote(list)}. ${plain}`),
    expression: ai?.expression ?? (kind === 'due_soon' ? 'thinking' : 'concerned'),
    refType: one ? 'task' : null,
    refId: one ? list[0]._id : null,
    data: { taskIds: list.map((t) => String(t._id)) },
    dedupeKey: `${kind}:${list.map((t) => `${t._id}@${new Date(t.dueAt).getTime()}`).join(',')}`,
  });
  return created;
}

// ---- morning plan and countdowns -----------------------------------------------------------------

export const inMorningWindow = (local) => local.hour >= MORNING_WINDOW.from && local.hour < MORNING_WINDOW.to;

/** "Aaj ka din": once a day, only if there is something today. Returns true if sent. */
export async function morning(user, now = new Date()) {
  const today = DateTime.fromJSDate(now, { zone: user.timezone }).toISODate();
  const dedupeKey = `morning:${user._id}:${today}`;
  if (await Notification.exists({ dedupeKey })) return false;
  const day = await agenda.today(user, now);
  const items = day.dueToday.length + day.upcomingReminders.length + day.overdue.length;
  if (!items) return false;

  const ai = await line(
    user,
    `Good morning message for ${user.name}. Today: due ${day.dueToday.map((t) => `"${t.title}"${t.dueAt ? ` at ${formatLocal(t.dueAt, user.timezone)}` : ''}`).join(', ') || 'nothing'}; reminders ${day.upcomingReminders.map((r) => `"${r.text}" at ${formatLocal(r.remindAt, user.timezone)}`).join(', ') || 'none'}; overdue ${day.overdue.length}; deadlines ${day.countdowns.map((t) => `"${t.title}" in ${t.daysLeft} days`).join(', ') || 'none'}. Write a warm, short "aaj ka din" message: the 2 or 3 most important things in order, and one line of encouragement. If they have no day plan yet, offer to plan the day with them. Two or three short sentences in their language.`,
  );
  const top = day.dueToday.slice(0, 3).map((t) => t.title).join(', ');
  const { created } = await notifications.create({
    userId: user._id,
    kind: 'morning',
    title: english(user) ? `Your day: ${day.dueToday.length} tasks, ${day.upcomingReminders.length} reminders` : `Aaj ka din: ${day.dueToday.length} kaam, ${day.upcomingReminders.length} reminder`,
    body: ai?.text ?? (top ? (english(user) ? `Today: ${top}. Let's go!` : `Aaj: ${top}. Chalo shuru karte hain!`) : english(user) ? 'Open Saathi to plan your day.' : 'Saathi kholo, din plan karte hain.'),
    expression: ai?.expression ?? 'happy',
    data: { dueToday: day.dueToday.length, reminders: day.upcomingReminders.length },
    dedupeKey,
  });
  return created;
}

/** Exams and deadlines 3 days, 1 day or 0 days away: one notification per morning. */
export async function countdown(user, now = new Date()) {
  const today = DateTime.fromJSDate(now, { zone: user.timezone }).toISODate();
  const dedupeKey = `countdown:${user._id}:${today}`;
  if (await Notification.exists({ dedupeKey })) return false;
  const deadlines = await Task.find({ userId: user._id, deletedAt: null, status: 'open', kind: 'deadline', dueAt: { $gte: now } })
    .sort({ dueAt: 1 })
    .limit(20)
    .lean();
  const near = deadlines.map((t) => ({ ...t, daysLeft: daysUntil(t.dueAt, user.timezone, now) })).filter((t) => COUNTDOWN_DAYS.includes(t.daysLeft));
  if (!near.length) return false;

  const label = (d) => (d === 0 ? (english(user) ? 'today' : 'aaj') : english(user) ? `in ${d} day${d > 1 ? 's' : ''}` : `${d} din mein`);
  const ai = await line(
    user,
    `Countdown for ${user.name}: ${near.map((t) => `"${t.title}" ${t.daysLeft === 0 ? 'is today' : `in ${t.daysLeft} days`}`).join('; ')}. Write one short, motivating line like a friend who believes in them (calm if it is today). In their language.`,
  );
  const first = near[0];
  const { created } = await notifications.create({
    userId: user._id,
    kind: 'countdown',
    title: near.length === 1 ? `${first.title}: ${label(first.daysLeft)}` : english(user) ? `${near.length} deadlines coming up` : `${near.length} deadline paas hain`,
    body: ai?.text ?? near.map((t) => `${t.title}: ${label(t.daysLeft)}`).join(' · '),
    expression: ai?.expression ?? (first.daysLeft === 0 ? 'excited' : 'thinking'),
    refType: near.length === 1 ? 'task' : null,
    refId: near.length === 1 ? first._id : null,
    data: { taskIds: near.map((t) => String(t._id)) },
    dedupeKey,
  });
  return created;
}

// ---- achievements ------------------------------------------------------------------------------

/** After a task is completed: a streak or weekly milestone gets one small celebration. */
export async function checkAchievement(userId, { now = new Date() } = {}) {
  const user = await User.findById(userId).lean();
  if (!user) return { skipped: 'no user' };
  const progress = await agenda.weeklyProgress(user, now);
  const today = DateTime.fromJSDate(now, { zone: user.timezone });
  let milestone = null;
  if (STREAK_MILESTONES.includes(progress.streak)) {
    milestone = { key: `achievement:streak:${user._id}:${progress.streak}:${today.toISODate()}`, what: `a ${progress.streak}-day streak of finishing tasks`, title: english(user) ? `${progress.streak}-day streak!` : `${progress.streak} din ki streak!` };
  } else if (WEEK_MILESTONES.includes(progress.thisWeek)) {
    milestone = { key: `achievement:week:${user._id}:${today.startOf('week').toISODate()}:${progress.thisWeek}`, what: `${progress.thisWeek} tasks done in the last 7 days`, title: english(user) ? `${progress.thisWeek} tasks this week!` : `Is hafte ${progress.thisWeek} kaam done!` };
  }
  if (!milestone || (await Notification.exists({ dedupeKey: milestone.key }))) return { milestone: null };

  const ai = await line(user, `${user.name} just reached ${milestone.what}. Celebrate it in one short, proud, friendly line (no lecture). In their language.`);
  const { created } = await notifications.create({
    userId: user._id,
    kind: 'achievement',
    title: milestone.title,
    body: ai?.text ?? (english(user) ? 'Keep it going!' : 'Aise hi chalte raho!'),
    expression: ai?.expression ?? 'proud',
    data: { streak: progress.streak, thisWeek: progress.thisWeek },
    dedupeKey: milestone.key,
  });
  return { milestone: created ? milestone.title : null };
}

// ---- chat confirmation when the app was closed -------------------------------------------------

/** Saathi finished changes from the chat after the user closed the app: tell them what was done. */
export async function confirmAgentWork(userId, { replyText, receipts, messageId, appClosed = false }) {
  if (!receipts.length) return false;
  const user = await User.findById(userId).lean();
  // The chat request ending early means this tab closed; otherwise check if any tab is still open.
  if (!user || (!appClosed && isOnline(user))) return false;
  const { created } = await notifications.create({
    userId,
    kind: 'agent',
    title: english(user) ? 'Saathi got it done' : 'Saathi ne kar diya',
    body: replyText || receipts.map((r) => r.summary).join(' · '),
    expression: 'proud',
    data: { receipts: receipts.map((r) => r.summary).slice(0, 5) },
    dedupeKey: `agent:${messageId}`,
  });
  return created;
}

// ---- buttons on a notification ("Ho gaya", "10 min baad") ----------------------------------------

/** The task ids a notification is about. */
function taskIdsOf(n) {
  if (n.data?.taskId) return [n.data.taskId];
  if (n.data?.taskIds?.length) return n.data.taskIds;
  return n.refType === 'task' && n.refId ? [String(n.refId)] : [];
}

/** Runs a notification button for the user (from the service worker or the in-app card). */
export async function runAction(user, notificationId, action) {
  const n = await Notification.findOne({ _id: notificationId, userId: user._id });
  if (!n) throw AppError.notFound('Notification not found.');
  let message = null;
  if (n.kind === 'timer' && (action === 'done' || action === 'more')) {
    const id = n.data?.sessionId;
    if (action === 'done') {
      const result = await focus.finish(user, id, { done: true }).catch((err) => (err.status === 409 ? null : Promise.reject(err)));
      message = result?.message ?? (english(user) ? 'Great work, done!' : 'Kamaal kar diya, ho gaya!');
    } else {
      await focus.extend(user, id, { minutes: 10 });
      message = english(user) ? '10 more minutes. You got this!' : '10 min aur, chal kar le!';
    }
  } else if (action === 'done') {
    const ids = taskIdsOf(n);
    if (!ids.length) throw AppError.badRequest('This notification is not about a task.');
    for (const id of ids) await tasks.complete(user._id, id);
    message = ids.length === 1 ? (english(user) ? 'Marked done!' : 'Ho gaya, shabash!') : english(user) ? `${ids.length} tasks done!` : `${ids.length} kaam done!`;
  } else if (action === 'snooze') {
    if (n.refType !== 'reminder') throw AppError.badRequest('Only reminders can be snoozed.');
    await reminders.snooze(user, n.refId, { minutes: 10 });
    message = english(user) ? 'Reminding you again in 10 minutes.' : '10 minute baad phir yaad dilaunga.';
  } else if (action !== 'open') {
    throw AppError.badRequest('Unknown action.');
  }
  if (!n.readAt) await Notification.updateOne({ _id: n._id }, { $set: { readAt: new Date() } });
  return { ok: true, message };
}
