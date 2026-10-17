import { z } from 'zod';
import { Task, publicTask } from '../models/Task.js';
import { AppError } from '../utils/AppError.js';
import { isoDateTime, tags, pagination, escapeRegex } from '../utils/schemas.js';
import { dayRange } from '../utils/time.js';
import * as activity from './activity.service.js';

const nullableDate = z.union([isoDateTime, z.null()]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(200),
  notes: z.string().max(5000).optional(),
  kind: z.enum(['task', 'deadline']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  dueAt: nullableDate.optional(),
  tags: tags.optional(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const listTasksSchema = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  due: z.enum(['any', 'today', 'overdue', 'upcoming', 'none']).default('any'),
  kind: z.enum(['task', 'deadline']).optional(),
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  sort: z.enum(['due', 'created', 'priority']).default('due'),
  ...pagination,
});

function liveFilter(userId) {
  return { userId, deletedAt: null };
}

export async function list(user, query) {
  const match = liveFilter(user._id);
  if (query.status !== 'all') match.status = query.status;
  if (query.kind) match.kind = query.kind;
  if (query.tag) match.tags = query.tag;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    match.$or = [{ title: rx }, { notes: rx }];
  }

  const { start, end } = dayRange(user.timezone);
  const now = new Date();
  if (query.due === 'today') match.dueAt = { $gte: start, $lte: end };
  if (query.due === 'overdue') match.dueAt = { $lt: now };
  if (query.due === 'upcoming') match.dueAt = { $gt: end };
  if (query.due === 'none') match.dueAt = null;

  // Sorting in the database so pagination stays correct.
  // "due" puts tasks without a due date last; "priority" puts high first.
  const sort = {
    due: { dueSort: 1, createdAt: -1 },
    created: { createdAt: -1 },
    priority: { priorityRank: 1, dueSort: 1, createdAt: -1 },
  }[query.sort];

  const [rows, total] = await Promise.all([
    Task.find(match)
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Task.countDocuments(match),
  ]);

  return { tasks: rows.map(publicTask), total, page: query.page, limit: query.limit };
}

export async function get(userId, id) {
  // Filtering by userId means another user's task is simply "not found": no hint that it exists.
  const task = await Task.findOne({ _id: id, ...liveFilter(userId) });
  if (!task) throw AppError.notFound('Task not found.');
  return task;
}

/** Open tasks whose title shares a word with `title`. Used to warn about likely duplicates. */
export async function findSimilarOpen(userId, title, { limit = 5 } = {}) {
  const words = significantWords(title);
  if (!words.length) return [];
  const rx = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await Task.find({ ...liveFilter(userId), status: 'open', title: rx }).sort({ dueAt: 1 }).limit(limit).lean();
  return rows.map(publicTask);
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'kal', 'aaj', 'karna', 'hai', 'ko', 'ka', 'ki', 'ke', 'mera', 'meri', 'my', 'to', 'do']);
export function significantWords(text) {
  return [...new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter(
    (w) => w.length >= 3 && !STOP_WORDS.has(w),
  );
}

export async function create(userId, data, { actor = 'user' } = {}) {
  const task = await Task.create({ ...data, userId, source: actor });
  await activity.record({
    userId,
    actor,
    action: 'task.created',
    entityType: 'task',
    entity: task,
    summary: `Created task "${task.title}"`,
  });
  return task;
}

async function mutate(userId, id, { actor, action, summary, apply }) {
  const task = await get(userId, id);
  const before = activity.snapshot('task', task);
  apply(task);
  await task.save();
  await activity.record({ userId, actor, action, entityType: 'task', entity: task, before, summary: summary(task) });
  return task;
}

export function update(userId, id, changes, { actor = 'user' } = {}) {
  return mutate(userId, id, {
    actor,
    action: 'task.updated',
    summary: (t) => `Updated task "${t.title}"`,
    apply: (t) => Object.assign(t, changes),
  });
}

export async function complete(userId, id, { actor = 'user' } = {}) {
  const task = await get(userId, id);
  // Completing twice (double click, agent retry) is a no-op, not an error and not a second log entry.
  if (task.status === 'done') return task;
  return mutate(userId, id, {
    actor,
    action: 'task.completed',
    summary: (t) => `Completed "${t.title}"`,
    apply: (t) => {
      t.status = 'done';
      t.completedAt = new Date();
    },
  });
}

export async function reopen(userId, id, { actor = 'user' } = {}) {
  const task = await get(userId, id);
  if (task.status === 'open') return task;
  return mutate(userId, id, {
    actor,
    action: 'task.reopened',
    summary: (t) => `Reopened "${t.title}"`,
    apply: (t) => {
      t.status = 'open';
      t.completedAt = null;
    },
  });
}

export function remove(userId, id, { actor = 'user' } = {}) {
  return mutate(userId, id, {
    actor,
    action: 'task.deleted',
    summary: (t) => `Deleted task "${t.title}"`,
    apply: (t) => {
      t.deletedAt = new Date();
    },
  });
}
