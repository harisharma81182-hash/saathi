import mongoose from 'mongoose';

// A destructive action the agent proposed but must not do on its own, such as deleting a task.
// The chat shows Confirm / Cancel; only Confirm runs it (POST /api/agent/actions/:id/confirm).
// Unanswered proposals expire after a while, so an old Confirm button cannot fire much later.
export const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

const pendingActionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    type: { type: String, enum: ['task.delete'], required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    summary: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    // Kept for a day after expiry so a late click gets a clear message, then removed by MongoDB.
    removeAt: { type: Date, required: true },
  },
  { timestamps: true },
);

pendingActionSchema.index({ removeAt: 1 }, { expireAfterSeconds: 0 });
pendingActionSchema.index({ userId: 1, status: 1, createdAt: -1 });

export function publicPendingAction(a) {
  return {
    id: String(a._id),
    type: a.type,
    summary: a.summary,
    status: a.status,
    expiresAt: a.expiresAt,
  };
}

export const PendingAction = mongoose.model('PendingAction', pendingActionSchema);
