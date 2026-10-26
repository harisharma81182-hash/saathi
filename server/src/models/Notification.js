import mongoose from 'mongoose';

// Something Saathi wants to tell the user: a reminder firing, a nudge about an overdue task, the
// morning plan... Stored, so it is never lost; shown live in the app, and also sent as a push
// notification and/or an email (see services/delivery.service.js).
export const NOTIFICATION_KINDS = ['reminder', 'due_soon', 'due_now', 'nudge', 'morning', 'recap', 'countdown', 'achievement', 'agent', 'system'];
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 1000 },
    // Saathi's face for this notification (the AI picks it with the text); null = default.
    expression: { type: String, default: null },
    // Extra details for buttons, e.g. the recap's leftover task ids ("move to tomorrow").
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    refType: { type: String, enum: ['reminder', 'task', null], default: null },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
    // One notification per event, even if the job that creates it runs twice.
    dedupeKey: { type: String },
    // How it went out: devices reached by push, whether an email was sent, or why not.
    delivery: { type: mongoose.Schema.Types.Mixed, default: null },
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
    expression: n.expression ?? null,
    data: n.data ?? null,
    refType: n.refType,
    refId: n.refId ? String(n.refId) : null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

export const Notification = mongoose.model('Notification', notificationSchema);
