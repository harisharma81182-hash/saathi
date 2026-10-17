import mongoose from 'mongoose';

// Something Saathi wants to tell the user: a reminder firing, a nudge about an overdue task.
// Stored, so it is never lost even if the user was offline; delivered live when they are online.
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['reminder', 'nudge', 'system'], required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    refType: { type: String, enum: ['reminder', 'task', null], default: null },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
    // One notification per event, even if the job that creates it runs twice.
    dedupeKey: { type: String },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export function publicNotification(n) {
  return {
    id: String(n._id),
    kind: n.kind,
    title: n.title,
    body: n.body,
    refType: n.refType,
    refId: n.refId ? String(n.refId) : null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

export const Notification = mongoose.model('Notification', notificationSchema);
