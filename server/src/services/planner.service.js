import { z } from 'zod';
import { DateTime } from 'luxon';
import { Task } from '../models/Task.js';
import { Reminder } from '../models/Reminder.js';
import { DayPlan, publicDayPlan } from '../models/DayPlan.js';
import { AppError } from '../utils/AppError.js';
import { isoDateTime, objectId, escapeRegex } from '../utils/schemas.js';
import { atLocalTime, localDateKey } from '../utils/time.js';
import * as tasks from './task.service.js';
import * as reminders from './reminder.service.js';

// Two planning workflows used by the agent:
//  - study plan: an exam date becomes a deadline task plus daily study sessions with reminders
//  - day plan: today's tasks arranged into time slots around the user's classes
//
// The model decides WHAT to study (it knows the syllabus) and WHEN to do things today; this code
// decides the dates and does the saving, so the result is always valid and every item is undoable.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 18:30.');

export const MAX_PLAN_DAYS = 14;

export const studyPlanSchema = z.object({
  subject: z.string().trim().min(1, 'Which subject is the exam for?').max(60),
  examAt: isoDateTime,
  topics: z.array(z.string().trim().min(1).max(80)).max(20, 'At most 20 topics.').default([]),
  studyTime: hhmm.default('18:00'),
  // An open plan for this subject already exists:
  //   replace = the user is changing it (new topics, new time): its upcoming sessions are removed first
  //   force   = the user really wants a second, separate plan next to it
  replace: z.boolean().default(false),
  force: z.boolean().default(false),
});

const tagFor = (subject) => subject.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 30) || 'study';

/** Which topic(s) to study on each day. The last day is always for revision. */
export function sessionLabels(topics, days) {
  if (days === 1) return ['Revision and practice questions'];
  const studyDays = days - 1;
  const labels = [];
  if (topics.length === 0) {
    for (let i = 0; i < studyDays; i++) labels.push(`Study session ${i + 1}`);
  } else if (topics.length >= studyDays) {
    // More topics than days: group neighbouring topics together.
    for (let i = 0; i < studyDays; i++) {
      const from = Math.floor((i * topics.length) / studyDays);
      const to = Math.floor(((i + 1) * topics.length) / studyDays);
      labels.push(topics.slice(from, to).join(', '));
    }
  } else {
    // More days than topics: a big topic gets more than one day.
    for (let i = 0; i < studyDays; i++) {
      const topic = topics[Math.floor((i * topics.length) / studyDays)];
      labels.push(labels.some((l) => l === topic || l === `${topic} (continued)`) ? `${topic} (continued)` : topic);
    }
  }
  labels.push('Revision and practice questions');
  // Keep titles readable (and inside the 200-character task title limit).
  return labels.map((l) => (l.length > 120 ? `${l.slice(0, 119)}…` : l));
}

export async function makeStudyPlan(user, input, { actor = 'agent', now = new Date() } = {}) {
  const { subject, examAt, topics, studyTime, replace, force } = input;
  const tz = user.timezone;
  if (examAt.getTime() <= now.getTime()) throw AppError.badRequest('That exam time has already passed. Check the date.');

  // Study days: from today (if today's study time is still an hour away) up to the day before the exam.
  const examDay = DateTime.fromJSDate(examAt, { zone: tz }).startOf('day');
  let day = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  if (atLocalTime(day.toISODate(), studyTime, tz).getTime() < now.getTime() + 60 * 60_000) day = day.plus({ days: 1 });
  const dates = [];
  for (; day < examDay; day = day.plus({ days: 1 })) dates.push(day.toISODate());
  if (dates.length === 0) {
    throw AppError.badRequest(
      `The exam is too close to plan study days at ${studyTime}. Try an earlier studyTime, or just add a revision task for today.`,
    );
  }
  const planDates = dates.slice(-MAX_PLAN_DAYS);

  const tag = tagFor(subject);
  const existing = await Task.find({
    userId: user._id,
    deletedAt: null,
    status: 'open',
    tags: { $all: [tag, 'study-plan'] },
    dueAt: { $gte: now, $lte: examAt },
  })
    .select('_id')
    .lean();
  if (existing.length > 0 && !replace && !force) {
    throw AppError.conflict(
      `A ${subject} study plan already exists (${existing.length} upcoming sessions). If the user is changing it (topics, time), call again with replace: true. Use force: true only if they clearly want a second, separate plan.`,
    );
  }
  // Changing the plan: remove the upcoming sessions and cancel their reminders first. Each change is
  // in the activity log like any other, so the whole update can be undone. (Done sessions stay.)
  let replaced = 0;
  if (replace) {
    for (const { _id } of existing) {
      const linked = await Reminder.find({ userId: user._id, taskId: _id, status: 'scheduled' }).select('_id').lean();
      for (const r of linked) await reminders.cancel(user, r._id, { actor });
      await tasks.remove(user._id, _id, { actor });
      replaced++;
    }
  }

  // The exam itself, as a deadline (reuse it if the user already added it).
  const examDayRange = { $gte: examDay.toJSDate(), $lte: examDay.endOf('day').toJSDate() };
  let examTask = await Task.findOne({
    userId: user._id,
    deletedAt: null,
    status: 'open',
    kind: 'deadline',
    dueAt: examDayRange,
    title: new RegExp(escapeRegex(subject), 'i'),
  });
  const examTaskCreated = !examTask;
  if (!examTask) {
    examTask = await tasks.create(
      user._id,
      { title: `${subject} exam`, kind: 'deadline', priority: 'high', dueAt: examAt, tags: [tag, 'exam'] },
      { actor },
    );
  }

  const labels = sessionLabels(topics, planDates.length);
  const sessions = [];
  for (const [i, date] of planDates.entries()) {
    const at = atLocalTime(date, studyTime, tz);
    const task = await tasks.create(
      user._id,
      {
        title: `${subject}: ${labels[i]}`,
        notes: `Part of your ${subject} study plan (exam ${examDay.toFormat('d LLL')}).`,
        priority: i === planDates.length - 1 ? 'high' : 'normal',
        dueAt: at,
        tags: [tag, 'study-plan'],
      },
      { actor },
    );
    const { reminder } = await reminders.create(user, { text: `${subject} study time: ${labels[i]}`, remindAt: at, taskId: String(task._id) }, { actor });
    sessions.push({ task, reminder });
  }

  return { examTask, examTaskCreated, sessions, replaced };
}

export const dayPlanSchema = z.object({
  slots: z
    .array(
      z.object({
        start: hhmm,
        end: hhmm,
        label: z.string().trim().min(1).max(200),
        taskId: objectId.optional(),
      }),
    )
    .min(1, 'Add at least one slot.')
    .max(16, 'At most 16 slots in a day.'),
  note: z.string().trim().max(500).default(''),
});

export async function setDayPlan(user, { slots, note }, { now = new Date() } = {}) {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  for (const [i, s] of sorted.entries()) {
    if (s.start >= s.end) throw AppError.badRequest(`Slot "${s.label}" ends before it starts.`);
    const next = sorted[i + 1];
    if (next && next.start < s.end) throw AppError.badRequest(`Slots "${s.label}" and "${next.label}" overlap.`);
  }
  const taskIds = [...new Set(sorted.filter((s) => s.taskId).map((s) => s.taskId))];
  if (taskIds.length) {
    const found = await Task.countDocuments({ _id: { $in: taskIds }, userId: user._id, deletedAt: null });
    if (found !== taskIds.length) throw AppError.badRequest('Some slots point to tasks that do not exist. Use ids from get_today or list_tasks.');
  }

  const date = localDateKey(now, user.timezone);
  const plan = await DayPlan.findOneAndUpdate(
    { userId: user._id, date },
    { $set: { slots: sorted, note } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return publicDayPlan(plan);
}

export async function getDayPlan(user, now = new Date()) {
  const plan = await DayPlan.findOne({ userId: user._id, date: localDateKey(now, user.timezone) }).lean();
  return plan ? publicDayPlan(plan) : null;
}
