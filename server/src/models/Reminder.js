import mongoose from 'mongoose';

// A reminder is a promise to notify the user at remindAt.
// The actual firing is a background job (jobs/handlers/reminder.js). The job carries the remindAt
// it was scheduled for; if the reminder was snoozed or cancelled since, the old job sees the
// mismatch and does nothing. That makes firing idempotent: never twice, never a stale one.
const reminderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
    remindAt: { type: Date, required: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    status: { type: String, enum: ['scheduled', 'sent', 'cancelled'], default: 'scheduled' },
    sentAt: { type: Date, default: null },
    snoozeCount: { type: Number, default: 0 },
    source: { type: String, enum: ['user', 'agent'], default: 'user' },
  },
  { timestamps: true },
);

reminderSchema.index({ userId: 1, status: 1, remindAt: 1 });

export const REMINDER_FIELDS = ['text', 'remindAt', 'taskId', 'status', 'sentAt', 'snoozeCount'];

export function publicReminder(r) {
  return {
    id: String(r._id),
    text: r.text,
    remindAt: r.remindAt,
    taskId: r.taskId ? String(r.taskId) : null,
    status: r.status,
    sentAt: r.sentAt,
    snoozeCount: r.snoozeCount,
    source: r.source,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const Reminder = mongoose.model('Reminder', reminderSchema);
