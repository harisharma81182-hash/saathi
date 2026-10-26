import { Reminder } from '../../models/Reminder.js';
import { Notification } from '../../models/Notification.js';
import { Task } from '../../models/Task.js';
import { User } from '../../models/User.js';
import { logger } from '../../lib/logger.js';
import { aiConfigured } from '../../ai/provider.js';
import { formatLocal } from '../../utils/time.js';
import * as notifications from '../../services/notification.service.js';
import { proactiveMessage } from '../../services/agent.service.js';

const log = logger.child({ component: 'reminders' });

// The AI line must never make a reminder late: if it takes longer than this, the plain text goes out.
export const REMINDER_AI_TIMEOUT_MS = 12_000;

// Fires one reminder. Safe to run more than once for the same job (idempotent):
//  - the reminder was cancelled, snoozed to another time, or deleted -> nothing to do
//  - the notification uses a dedupe key, so a retry never notifies twice
//  - the notification is written BEFORE the reminder is marked sent, so a crash in between means
//    the job is retried and finishes the work, instead of a reminder marked sent that nobody saw
//
// The title is always the user's own reminder text. The body is a short line Saathi writes at fire
// time (with the user's name, time of day and agenda in context); without AI it stays empty.
export async function fireReminder({ reminderId, remindAt }, { writeLine = writeReminderLine } = {}) {
  const reminder = await Reminder.findById(reminderId).lean();
  if (!reminder) return { skipped: 'deleted' };
  if (reminder.status !== 'scheduled') return { skipped: reminder.status };
  if (new Date(reminder.remindAt).toISOString() !== remindAt) return { skipped: 'rescheduled' };

  const dedupeKey = `reminder:${reminder._id}:${remindAt}`;
  // A retry after the notification was already written: don't pay for a second AI line.
  const already = await Notification.exists({ dedupeKey });
  const line = already ? null : await writeLine(reminder);

  // The linked task gives the notification its "Ho gaya" button; study-plan sessions get the study look.
  const task = reminder.taskId ? await Task.findOne({ _id: reminder.taskId, deletedAt: null }, { status: 1, tags: 1 }).lean() : null;
  await notifications.create({
    userId: reminder.userId,
    kind: 'reminder',
    data: task ? { taskId: String(task._id), study: task.tags?.includes('study-plan') || undefined } : null,
    title: reminder.text,
    body: line?.text ?? '',
    expression: line?.expression ?? null,
    refType: 'reminder',
    refId: reminder._id,
    dedupeKey,
  });

  await Reminder.updateOne(
    { _id: reminder._id, status: 'scheduled', remindAt: new Date(remindAt) },
    { $set: { status: 'sent', sentAt: new Date() } },
  );
  return { fired: true, aiLine: Boolean(line) };
}

/** Saathi's line for a reminder, or null (no AI, too slow, quota used up...). Never throws. */
export async function writeReminderLine(reminder) {
  if (!aiConfigured()) return null;
  try {
    const user = await User.findById(reminder.userId).lean();
    if (!user) return null;
    const task = reminder.taskId ? await Task.findOne({ _id: reminder.taskId, deletedAt: null }).lean() : null;
    const about = task
      ? ` It is for the task "${task.title}"${task.dueAt ? `, due ${formatLocal(task.dueAt, user.timezone)}` : ''}${task.status === 'done' ? ' (already marked done)' : ''}.`
      : '';
    return await proactiveMessage(
      user,
      `A reminder ${user.name} set is due right now: "${reminder.text}".${about} Write the message you send them now: one or two short lines in their language, like a friend reminding them, with one small push to start. Don't repeat the reminder word for word.`,
      { signal: AbortSignal.timeout(REMINDER_AI_TIMEOUT_MS) },
    );
  } catch (err) {
    log.warn({ reminderId: String(reminder._id), err: err.message }, 'reminder line not written, sending the plain reminder');
    return null;
  }
}
