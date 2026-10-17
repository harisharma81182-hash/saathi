import { Reminder } from '../../models/Reminder.js';
import * as notifications from '../../services/notification.service.js';

// Fires one reminder. Safe to run more than once for the same job (idempotent):
//  - the reminder was cancelled, snoozed to another time, or deleted -> nothing to do
//  - the notification uses a dedupe key, so a retry never notifies twice
//  - the notification is written BEFORE the reminder is marked sent, so a crash in between means
//    the job is retried and finishes the work, instead of a reminder marked sent that nobody saw
export async function fireReminder({ reminderId, remindAt }) {
  const reminder = await Reminder.findById(reminderId).lean();
  if (!reminder) return { skipped: 'deleted' };
  if (reminder.status !== 'scheduled') return { skipped: reminder.status };
  if (new Date(reminder.remindAt).toISOString() !== remindAt) return { skipped: 'rescheduled' };

  await notifications.create({
    userId: reminder.userId,
    kind: 'reminder',
    title: reminder.text,
    body: '',
    refType: 'reminder',
    refId: reminder._id,
    dedupeKey: `reminder:${reminder._id}:${remindAt}`,
  });

  await Reminder.updateOne(
    { _id: reminder._id, status: 'scheduled', remindAt: new Date(remindAt) },
    { $set: { status: 'sent', sentAt: new Date() } },
  );
  return { fired: true };
}
