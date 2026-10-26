import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { Activity, publicActivity } from '../models/Activity.js';
import { Task, TASK_FIELDS } from '../models/Task.js';
import { Note, NOTE_FIELDS } from '../models/Note.js';
import { Reminder, REMINDER_FIELDS } from '../models/Reminder.js';
import { AppError } from '../utils/AppError.js';
import { scheduleReminderJob } from './reminder.scheduling.js';
import { dropUntouchedNext } from './habit.service.js';

// How long a change can be undone. The UI shows the Undo button for a few seconds;
// the server allows a little longer so slow networks and the agent ("undo that") still work.
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

const ENTITIES = {
  task: { model: Task, fields: TASK_FIELDS },
  note: { model: Note, fields: NOTE_FIELDS },
  reminder: { model: Reminder, fields: REMINDER_FIELDS },
};

export function snapshot(entityType, doc) {
  const out = {};
  for (const f of ENTITIES[entityType].fields) out[f] = doc[f] ?? null;
  if ('deletedAt' in (doc.toObject?.() ?? doc)) out.deletedAt = doc.deletedAt ?? null;
  return out;
}

// Lets the agent see which changes one tool call made (to show a receipt with Undo), without every
// service having to return its activity entries. Inside captureActivities(fn), each record() call
// is also collected in a list that only that call can see, even with many requests running at once.
const capture = new AsyncLocalStorage();

// Pass your own `entries` array to still see what was recorded when fn throws halfway.
export async function captureActivities(fn, entries = []) {
  const result = await capture.run(entries, fn);
  return { result, activities: entries };
}

// In-process event bus: fires when this instance records or undoes a change, so live updates
// (live.service.js) can tell the user's open tabs right away. Other instances find it by polling.
export const activityEvents = new EventEmitter();
activityEvents.setMaxListeners(0);

export async function record({ userId, actor, action, entityType, entity, before = null, summary }) {
  const entry = await Activity.create({
    userId,
    actor,
    action,
    entityType,
    entityId: entity._id,
    summary,
    before,
    versionAfter: entity.updatedAt,
  });
  capture.getStore()?.push(entry);
  activityEvents.emit('changed', entry);
  return entry;
}

export async function list(userId, { limit = 50 } = {}) {
  const rows = await Activity.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((a) => publicActivity(a, { undoWindowMs: UNDO_WINDOW_MS }));
}

/**
 * Reverts one change, if it is recent and nothing has changed the item since.
 *
 * Two atomic steps keep it safe under double clicks and concurrent edits:
 *  1. claim the activity (undoneAt: null -> now); a second undo of the same change finds nothing
 *  2. revert the item only if its updatedAt still equals the version this change produced
 * If step 2 finds the item changed, step 1 is rolled back and the user gets a clear 409.
 */
export async function undo(userId, activityId) {
  const activity = await Activity.findOne({ _id: activityId, userId });
  if (!activity) throw AppError.notFound('That change was not found.');
  if (activity.undoneAt) throw AppError.conflict('That change was already undone.');
  if (!ENTITIES[activity.entityType]) throw AppError.badRequest('A finished focus session cannot be undone.');
  if (Date.now() - activity.createdAt.getTime() > UNDO_WINDOW_MS) {
    throw AppError.conflict('That change is too old to undo. Edit the item directly instead.');
  }

  const claimed = await Activity.findOneAndUpdate(
    { _id: activity._id, undoneAt: null },
    { $set: { undoneAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw AppError.conflict('That change was already undone.');

  const { model } = ENTITIES[activity.entityType];
  const revert = revertUpdate(activity);
  const reverted = await model.findOneAndUpdate(
    { _id: activity.entityId, userId, updatedAt: activity.versionAfter },
    revert,
    { returnDocument: 'after' },
  );

  if (!reverted) {
    await Activity.updateOne({ _id: activity._id }, { $set: { undoneAt: null } });
    throw AppError.conflict('This item was changed again after that, so it cannot be undone safely.');
  }

  if (activity.entityType === 'reminder' && reverted.status === 'scheduled') {
    await scheduleReminderJob(reverted);
  }
  // Undoing the completion of a habit also removes the next occurrence it created (if untouched).
  if (activity.entityType === 'task' && activity.action === 'task.completed') await dropUntouchedNext(reverted);
  activityEvents.emit('changed', claimed);

  return { activity: publicActivity(claimed, { undoWindowMs: UNDO_WINDOW_MS }), entityType: activity.entityType, entity: reverted };
}

function revertUpdate(activity) {
  const { action, entityType, before } = activity;
  if (action.endsWith('.created')) {
    // Undo a create: hide it again (reminders are cancelled instead).
    return entityType === 'reminder' ? { $set: { status: 'cancelled' } } : { $set: { deletedAt: new Date() } };
  }
  // Every other change: put back the fields exactly as they were.
  return { $set: { ...before } };
}
