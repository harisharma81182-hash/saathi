import { enqueue } from '../jobs/queue.js';

// Puts a reminder on the job queue to fire at remindAt.
// The dedupe key includes the time, so scheduling the same reminder for the same time twice
// is a no-op, while a snoozed reminder (new time) gets its own new job.
export async function scheduleReminderJob(reminder) {
  const remindAt = new Date(reminder.remindAt);
  return enqueue(
    'reminder.fire',
    { reminderId: String(reminder._id), remindAt: remindAt.toISOString() },
    { runAt: remindAt, maxAttempts: 5, dedupeKey: `reminder:${reminder._id}:${remindAt.toISOString()}` },
  );
}
