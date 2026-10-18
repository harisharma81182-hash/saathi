import { z } from 'zod';
import { Activity } from '../models/Activity.js';
import { Message } from '../models/Message.js';
import { PendingAction, PENDING_ACTION_TTL_MS, publicPendingAction } from '../models/PendingAction.js';
import { MEMORY_KINDS } from '../models/Memory.js';
import { objectId, escapeRegex } from '../utils/schemas.js';
import { toLocalIso, formatLocal } from '../utils/time.js';
import * as tasks from '../services/task.service.js';
import * as habits from '../services/habit.service.js';
import * as notes from '../services/note.service.js';
import * as reminders from '../services/reminder.service.js';
import * as activity from '../services/activity.service.js';
import * as agenda from '../services/agenda.service.js';
import * as memory from '../services/memory.service.js';
import * as planner from '../services/planner.service.js';

// Saathi's tools: the things the agent can actually do in the user's account.
//
// Each tool has:
//   description  what the model reads to decide when to use it
//   input        a zod schema. It is turned into the JSON schema Claude sees, AND used to check
//                what Claude sends before anything runs (reusing the same schemas as the REST API)
//   run          does the work through the normal services, as actor "agent", so every change is
//                in the activity log and can be undone
//
// run returns { data, summary?, confirm? }:
//   data     what the model gets back (kept short: tokens cost money)
//   summary  one line for the receipt shown in the chat
//   confirm  a proposed action the user must confirm in the UI (deleting a task)

const AGENT = { actor: 'agent' };

const isoHint = 'Full ISO 8601 date-time with the user\'s UTC offset, e.g. 2026-10-19T09:00:00+05:30.';

// Compact views for the model: ids it needs for follow-up calls, local times it can read.
function taskView(t, tz) {
  return {
    id: String(t._id ?? t.id),
    title: t.title,
    status: t.status,
    kind: t.kind,
    priority: t.priority,
    due: t.dueAt ? toLocalIso(new Date(t.dueAt), tz) : null,
    tags: t.tags,
    ...(t.repeat && { repeat: t.repeat }),
  };
}

function reminderView(r, tz) {
  return {
    id: String(r._id ?? r.id),
    text: r.text,
    at: toLocalIso(new Date(r.remindAt), tz),
    status: r.status,
    taskId: r.taskId ? String(r.taskId) : null,
  };
}

const noteView = (n) => ({ id: String(n._id ?? n.id), title: n.title, body: n.body.length > 300 ? `${n.body.slice(0, 300)}…` : n.body, tags: n.tags });

export function todayView(today, tz) {
  return {
    dueToday: today.dueToday.map((t) => taskView(t, tz)),
    overdue: today.overdue.map((t) => taskView(t, tz)),
    upcomingReminders: today.upcomingReminders.map((r) => reminderView(r, tz)),
    countdowns: today.countdowns.map((t) => ({ ...taskView(t, tz), daysLeft: t.daysLeft })),
    counts: today.counts,
    dayPlan: today.dayPlan,
    habits: (today.habits ?? []).map((h) => ({ ...taskView(h, tz), streak: h.streak })),
  };
}

const describe = (schema, text) => schema.describe(text);

export const TOOLS = [
  {
    name: 'create_task',
    description:
      'Create a task (something to do) or a deadline (exam, submission) for the user. Checks for similar open tasks first; if it finds some, nothing is created and you should ask the user, then call again with force: true if they still want it.',
    input: tasks.createTaskSchema.extend({
      dueAt: describe(tasks.createTaskSchema.shape.dueAt, `When it is due. ${isoHint} Omit or null if no due time.`),
      kind: describe(tasks.createTaskSchema.shape.kind, '"deadline" for exams and submissions (shown as a countdown), otherwise "task".'),
      repeat: describe(
        tasks.createTaskSchema.shape.repeat,
        'For habits and routines ("roz", "har Monday"): { every: "day" } or { every: "week", days: ["mon", "wed", "fri"] }. Needs dueAt (the first time). Completing one creates the next.',
      ),
      force: z.boolean().default(false).describe('Create even if similar open tasks exist. Only after the user confirmed.'),
    }),
    async run({ user }, { force, ...data }) {
      if (!force) {
        const similar = await tasks.findSimilarOpen(user._id, data.title);
        if (similar.length) {
          return {
            data: {
              created: false,
              reason: 'similar_open_tasks',
              similar: similar.map((t) => taskView(t, user.timezone)),
              next: 'Tell the user about these and ask whether to add the new one anyway (then call again with force: true) or use an existing one.',
            },
          };
        }
      }
      const task = await tasks.create(user._id, data, AGENT);
      return { data: { created: true, task: taskView(task, user.timezone) } };
    },
  },
  {
    name: 'list_tasks',
    description: 'List the user\'s tasks with filters. Use it to find task ids or answer "what do I have to do".',
    input: tasks.listTasksSchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
    async run({ user }, query) {
      const res = await tasks.list(user, query);
      return { data: { total: res.total, tasks: res.tasks.map((t) => taskView(t, user.timezone)) } };
    },
  },
  {
    name: 'update_task',
    description: 'Change a task: title, notes, due time, priority, kind or tags. Only send the fields that change.',
    input: z
      .object({ taskId: objectId, ...tasks.createTaskSchema.partial().shape })
      .refine((v) => Object.keys(v).length > 1, 'Nothing to update.'),
    async run({ user }, { taskId, ...changes }) {
      const task = await tasks.update(user._id, taskId, changes, AGENT);
      return { data: { updated: true, task: taskView(task, user.timezone) } };
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done. Celebrate it with the user!',
    input: z.object({ taskId: objectId }),
    async run({ user }, { taskId }) {
      const task = await tasks.complete(user._id, taskId, AGENT);
      const next = task.$locals.next;
      if (!next) return { data: { done: true, task: taskView(task, user.timezone) } };
      const streak = await habits.streak(user, task);
      return { data: { done: true, task: taskView(task, user.timezone), habit: { streak, next: taskView(next, user.timezone) } } };
    },
  },
  {
    name: 'delete_task',
    description:
      'Propose deleting a task. This does NOT delete it: the user sees Confirm / Cancel buttons and the delete only happens if they tap Confirm. Tell them to confirm.',
    input: z.object({ taskId: objectId }),
    async run({ user, conversationId }, { taskId }) {
      const task = await tasks.get(user._id, taskId);
      const now = Date.now();
      // Asking twice about the same task reuses the open proposal instead of showing two buttons.
      let action = await PendingAction.findOne({
        userId: user._id,
        type: 'task.delete',
        'payload.taskId': taskId,
        status: 'pending',
        expiresAt: { $gt: new Date(now) },
      });
      action ??= await PendingAction.create({
        userId: user._id,
        conversationId,
        type: 'task.delete',
        payload: { taskId },
        summary: `Delete task "${task.title}"`,
        expiresAt: new Date(now + PENDING_ACTION_TTL_MS),
        removeAt: new Date(now + PENDING_ACTION_TTL_MS + 24 * 60 * 60_000),
      });
      return {
        data: { deleted: false, waitingForUserConfirmation: true, task: taskView(task, user.timezone) },
        confirm: publicPendingAction(action),
      };
    },
  },
  {
    name: 'save_note',
    description: 'Save a note for the user (an idea, a list, something to remember to read).',
    input: notes.createNoteSchema,
    async run({ user }, data) {
      const note = await notes.create(user._id, data, AGENT);
      return { data: { saved: true, note: noteView(note) } };
    },
  },
  {
    name: 'search_notes',
    description: 'Search the user\'s notes by words or tag.',
    input: notes.listNotesSchema.extend({ limit: z.coerce.number().int().min(1).max(20).default(10) }),
    async run({ user }, query) {
      const res = await notes.list(user._id, query);
      return { data: { total: res.total, notes: res.notes.map(noteView) } };
    },
  },
  {
    name: 'set_reminder',
    description: 'Remind the user at a specific time. Link it to a task with taskId when it is about that task. Setting the same reminder twice is harmless.',
    input: reminders.createReminderSchema.extend({
      remindAt: describe(reminders.createReminderSchema.shape.remindAt, `When to remind. ${isoHint}`),
      text: describe(reminders.createReminderSchema.shape.text, 'Short reminder text in the user\'s language, e.g. "DBMS lab file submit karna".'),
    }),
    async run({ user }, data) {
      const { reminder, duplicate } = await reminders.create(user, data, AGENT);
      return { data: { set: true, alreadyExisted: duplicate, reminder: reminderView(reminder, user.timezone) } };
    },
  },
  {
    name: 'list_reminders',
    description: 'List reminders (scheduled by default).',
    input: reminders.listRemindersSchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
    async run({ user }, query) {
      const res = await reminders.list(user._id, query);
      return { data: { total: res.total, reminders: res.reminders.map((r) => reminderView(r, user.timezone)) } };
    },
  },
  {
    name: 'snooze_reminder',
    description: 'Move a reminder later: either by some minutes or to an exact time (give one of the two).',
    input: z
      .object({ reminderId: objectId, ...reminders.snoozeSchema.shape })
      .refine((v) => (v.minutes === undefined) !== (v.until === undefined), 'Give either minutes or until, not both.'),
    async run({ user }, { reminderId, ...snooze }) {
      const reminder = await reminders.snooze(user, reminderId, snooze, AGENT);
      return { data: { snoozed: true, reminder: reminderView(reminder, user.timezone) } };
    },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a scheduled reminder.',
    input: z.object({ reminderId: objectId }),
    async run({ user }, { reminderId }) {
      const reminder = await reminders.cancel(user, reminderId, AGENT);
      return { data: { cancelled: true, reminder: reminderView(reminder, user.timezone) } };
    },
  },
  {
    name: 'get_today',
    description: 'The user\'s day right now: tasks due today, overdue tasks, reminders in the next 24 hours, exam countdowns, today\'s plan, habits with their streaks. Use it after making changes or before planning the day.',
    input: z.object({}),
    async run({ user }) {
      return { data: todayView(await agenda.today(user), user.timezone) };
    },
  },
  {
    name: 'remember_fact',
    description: 'Save a lasting fact about the user to long-term memory (routine, goal, preference, important person, subject they find hard). Write it as a short third-person sentence, e.g. "Classes are 9 AM to 4 PM, Monday to Friday."',
    input: memory.rememberSchema.extend({ kind: z.enum(MEMORY_KINDS).default('fact') }),
    async run({ user, userMessageId }, data) {
      const { memory: saved, duplicate } = await memory.remember(user._id, data, { source: 'agent', sourceMessageId: userMessageId });
      return { data: { remembered: true, alreadyKnown: duplicate, memory: { id: String(saved._id), text: saved.text } }, summary: `Remembered: ${saved.text}` };
    },
  },
  {
    name: 'recall',
    description: 'Search long-term memories and older chat messages for something the user mentioned before.',
    input: z.object({ query: z.string().trim().min(2).max(100) }),
    async run({ user }, { query }) {
      const words = memory.memoryKey(query).split(' ').filter((w) => w.length >= 3);
      const rx = words.length ? new RegExp(words.map(escapeRegex).join('|'), 'i') : null;
      const [memories, messages] = await Promise.all([
        memory.search(user._id, query),
        rx ? Message.find({ userId: user._id, status: 'ok', text: rx }).sort({ createdAt: -1 }).limit(8).lean() : [],
      ]);
      return {
        data: {
          memories: memories.map((m) => m.text),
          messages: messages.map((m) => ({ from: m.role === 'user' ? 'user' : 'you', at: formatLocal(m.createdAt, user.timezone), text: m.text.slice(0, 300) })),
        },
      };
    },
  },
  {
    name: 'undo_last_action',
    description: 'Undo the most recent change to a task, note or reminder (by you or the user), for "undo that" or "galti ho gayi". Works for about 10 minutes after the change.',
    input: z.object({}),
    async run({ user }) {
      const last = await Activity.findOne({ userId: user._id, undoneAt: null }).sort({ createdAt: -1 }).lean();
      if (!last) return { data: { undone: false, reason: 'There is nothing recent to undo.' } };
      const { activity: undone } = await activity.undo(user._id, last._id);
      return { data: { undone: true, change: undone.summary }, summary: `Undid: ${undone.summary}` };
    },
  },
  {
    name: 'make_study_plan',
    description:
      'Create a study plan for an exam: a deadline task for the exam plus one study session per day until the day before it (up to 14 days), each with a reminder; the last day is revision. Fill topics with the real syllabus topics in a sensible order.',
    input: planner.studyPlanSchema.extend({
      examAt: describe(planner.studyPlanSchema.shape.examAt, `When the exam starts. ${isoHint} If only the date is known, use 10:00.`),
      topics: describe(planner.studyPlanSchema.shape.topics, 'Topics to cover, in study order (from the user, or the standard syllabus you know).'),
      studyTime: describe(planner.studyPlanSchema.shape.studyTime, 'Daily study time in 24-hour HH:mm, local time. Pick one that fits the user\'s routine.'),
      replace: describe(
        planner.studyPlanSchema.shape.replace,
        'The user is changing their existing plan for this subject (new topics, new time, new exam date): remove its upcoming sessions and reminders, then make the new plan.',
      ),
      force: describe(planner.studyPlanSchema.shape.force, 'Make a second, separate plan next to an existing one. Only if the user clearly asked for two plans.'),
    }),
    async run({ user }, data) {
      const plan = await planner.makeStudyPlan(user, data);
      const tz = user.timezone;
      return {
        data: {
          created: true,
          replacedSessions: plan.replaced,
          exam: { ...taskView(plan.examTask, tz), alreadyExisted: !plan.examTaskCreated },
          sessions: plan.sessions.map(({ task, reminder }) => ({ taskId: String(task._id), title: task.title, at: toLocalIso(reminder.remindAt, tz) })),
        },
        summary: plan.replaced
          ? `Study plan for ${data.subject} updated: ${plan.sessions.length} new sessions with reminders (replaced ${plan.replaced} old ones)`
          : `Study plan for ${data.subject}: ${plan.sessions.length} sessions with reminders${plan.examTaskCreated ? ', plus the exam as a deadline' : ''}`,
      };
    },
  },
  {
    name: 'plan_my_day',
    description:
      'Save today\'s plan as time slots (shown as a timeline on the Today panel). Arrange open tasks around the user\'s classes and meals, hardest work at their best time, with breaks. Planning again replaces today\'s plan.',
    input: planner.dayPlanSchema,
    async run({ user }, data) {
      const plan = await planner.setDayPlan(user, data);
      return { data: { saved: true, plan }, summary: `Planned your day: ${plan.slots.length} slots` };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// The tool list in the format the Claude API expects. Built once: the same bytes every request,
// which keeps the prompt cache valid.
export const TOOL_DEFINITIONS = TOOLS.map((t) => {
  const { $schema, ...schema } = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' });
  return { name: t.name, description: t.description, input_schema: { type: 'object', properties: {}, ...schema } };
});
