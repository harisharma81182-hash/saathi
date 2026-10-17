import { z } from 'zod';
import { Task, publicTask } from '../models/Task.js';
import { Reminder, publicReminder } from '../models/Reminder.js';
import { dayRange, lastNDays, localDateKey, daysUntil, partOfDay } from '../utils/time.js';
import { escapeRegex } from '../utils/schemas.js';
import { significantWords } from './task.service.js';
import { getDayPlan } from './planner.service.js';

const live = (userId) => ({ userId, deletedAt: null });

/**
 * Everything the Today panel and the greeting need, in one call:
 * what is due today, what is overdue, upcoming reminders, deadline countdowns.
 */
export async function today(user, now = new Date()) {
  const { start, end } = dayRange(user.timezone, now);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [dueToday, overdue, reminders, deadlines, doneToday, openCount, dayPlan] = await Promise.all([
    Task.find({ ...live(user._id), status: 'open', dueAt: { $gte: start, $lte: end } }).sort({ dueAt: 1 }).limit(20).lean(),
    Task.find({ ...live(user._id), status: 'open', dueAt: { $lt: start } }).sort({ dueAt: 1 }).limit(20).lean(),
    Reminder.find({ userId: user._id, status: 'scheduled', remindAt: { $gte: now, $lte: in24h } }).sort({ remindAt: 1 }).limit(10).lean(),
    Task.find({ ...live(user._id), status: 'open', kind: 'deadline', dueAt: { $gte: start, $lte: in30d } }).sort({ dueAt: 1 }).limit(5).lean(),
    Task.countDocuments({ ...live(user._id), status: 'done', completedAt: { $gte: start, $lte: end } }),
    Task.countDocuments({ ...live(user._id), status: 'open' }),
    getDayPlan(user, now),
  ]);

  return {
    user: { name: user.name, timezone: user.timezone },
    now: now.toISOString(),
    partOfDay: partOfDay(user.timezone, now),
    dueToday: dueToday.map(publicTask),
    overdue: overdue.map(publicTask),
    upcomingReminders: reminders.map(publicReminder),
    countdowns: deadlines.map((t) => ({ ...publicTask(t), daysLeft: daysUntil(t.dueAt, user.timezone, now) })),
    dayPlan,
    counts: { openTasks: openCount, doneToday, overdue: overdue.length, dueToday: dueToday.length },
  };
}

/**
 * Tasks completed per day for the last 14 days, this week vs last week, and the current streak
 * (days in a row with at least one completed task).
 */
export async function weeklyProgress(user, now = new Date()) {
  const days = lastNDays(user.timezone, 14, now);
  const done = await Task.find(
    { ...live(user._id), status: 'done', completedAt: { $gte: days[0].start, $lte: days.at(-1).end } },
    { completedAt: 1 },
  ).lean();

  const perDay = Object.fromEntries(days.map((d) => [d.key, 0]));
  for (const t of done) {
    const key = localDateKey(t.completedAt, user.timezone);
    if (key in perDay) perDay[key]++;
  }
  const series = days.map((d) => ({ date: d.key, completed: perDay[d.key] }));
  const thisWeek = series.slice(7).reduce((s, d) => s + d.completed, 0);
  const lastWeek = series.slice(0, 7).reduce((s, d) => s + d.completed, 0);

  // Streak: count back from today; if nothing is done yet today, start from yesterday.
  let streak = 0;
  let i = series.length - 1;
  if (series[i].completed === 0) i--;
  for (; i >= 0 && series[i].completed > 0; i--) streak++;

  return { series, thisWeek, lastWeek, change: thisWeek - lastWeek, streak };
}

export const hintsSchema = z.object({ q: z.string().trim().min(1).max(200) });

/**
 * "Guide while typing": as the user types a message, show open tasks that look related
 * ("2 tasks about 'lab file' are already open"). Only searches the user's own data, no AI call,
 * so it is fast and free to run on every few keystrokes.
 */
export async function hints(userId, text) {
  const words = significantWords(text).slice(0, 6);
  if (!words.length) return { matches: [], total: 0, words: [] };
  const rx = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const match = { ...live(userId), status: 'open', title: rx };
  const [rows, total] = await Promise.all([
    Task.find(match).sort({ dueAt: 1 }).limit(5).lean(),
    Task.countDocuments(match),
  ]);
  return { matches: rows.map(publicTask), total, words };
}
