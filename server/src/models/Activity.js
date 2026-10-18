import mongoose from 'mongoose';

// The activity log: every change to a task, note or reminder, by the user or by the agent.
// It powers two features:
//   - the timeline ("what did Saathi do today?")
//   - Undo: `before` is enough to put things back the way they were.
const activitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: String, enum: ['user', 'agent'], required: true },
    action: { type: String, required: true }, // e.g. "task.created", "reminder.snoozed"
    entityType: { type: String, enum: ['task', 'note', 'reminder'], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    summary: { type: String, required: true, maxlength: 300 },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    // The entity's updatedAt right after this change. Undo only proceeds if nothing changed since.
    versionAfter: { type: Date, default: null },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ userId: 1, createdAt: -1 });
// Live updates look for recent Undo's too.
activitySchema.index({ userId: 1, undoneAt: 1 });

export function publicActivity(a, { undoWindowMs }) {
  return {
    id: String(a._id),
    actor: a.actor,
    action: a.action,
    entityType: a.entityType,
    entityId: String(a.entityId),
    summary: a.summary,
    createdAt: a.createdAt,
    undoneAt: a.undoneAt,
    canUndo: !a.undoneAt && Date.now() - new Date(a.createdAt).getTime() < undoWindowMs,
  };
}

export const Activity = mongoose.model('Activity', activitySchema);
