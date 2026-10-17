import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, default: '', maxlength: 5000 },
    // "deadline" items (exams, submissions) get a countdown on the Today panel.
    kind: { type: String, enum: ['task', 'deadline'], default: 'task' },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    dueAt: { type: Date, default: null },
    tags: { type: [String], default: [] },
    completedAt: { type: Date, default: null },
    // Who made the change: the user directly, or the agent on their behalf.
    source: { type: String, enum: ['user', 'agent'], default: 'user' },
    // Soft delete, so a delete can be undone. Deleted items are hidden everywhere.
    deletedAt: { type: Date, default: null },
    // Sort keys, kept in sync automatically (see hooks below), so lists sort with a plain indexed
    // query: tasks without a due date sort last, high priority first.
    dueSort: { type: Date, default: () => NO_DUE },
    priorityRank: { type: Number, default: 1 },
  },
  { timestamps: true },
);

const NO_DUE = new Date('9999-12-31T00:00:00Z');
const RANK = { high: 0, normal: 1, low: 2 };

function sortKeys(src) {
  const out = {};
  if ('dueAt' in src) out.dueSort = src.dueAt ?? NO_DUE;
  if ('priority' in src) out.priorityRank = RANK[src.priority] ?? 1;
  return out;
}

taskSchema.pre('save', function syncSortKeys() {
  Object.assign(this, sortKeys({ dueAt: this.dueAt, priority: this.priority }));
});

// Updates that bypass save() (e.g. Undo restoring old values) keep the sort keys in sync too.
taskSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function syncSortKeysOnUpdate() {
  const update = this.getUpdate();
  if (update?.$set) Object.assign(update.$set, sortKeys(update.$set));
});

// Every query is "this user's tasks", usually filtered by status and sorted by due date.
taskSchema.index({ userId: 1, deletedAt: 1, status: 1, dueSort: 1 });
taskSchema.index({ userId: 1, deletedAt: 1, status: 1, dueAt: 1 });
// Weekly progress: tasks completed per day.
taskSchema.index({ userId: 1, completedAt: 1 });

export const TASK_FIELDS = ['title', 'notes', 'kind', 'status', 'priority', 'dueAt', 'tags', 'completedAt'];

export function publicTask(t) {
  return {
    id: String(t._id),
    title: t.title,
    notes: t.notes,
    kind: t.kind,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt,
    tags: t.tags,
    completedAt: t.completedAt,
    source: t.source,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const Task = mongoose.model('Task', taskSchema);
