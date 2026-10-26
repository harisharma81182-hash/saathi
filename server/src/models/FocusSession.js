import mongoose from 'mongoose';

// A focus timer: "is kaam par 2 ghante 30 minute". Times are kept on the server, so the timer is
// right after a refresh, on another device, or with the tab closed (a job fires when it ends).
//
//   running    counting down: endsAt is when it ends, runningSince when it last (re)started
//   paused     stopped for now: remainingMs is what is left
//   timeup     the time ran out; waiting for "Ho gaya" or "10 min aur"
//   completed  finished (by the user, or "Ho gaya" after time up)
//   cancelled  stopped without finishing
//
// focusedMs is the time actually spent running, added up at every pause and at the end.
export const ACTIVE_FOCUS = ['running', 'paused', 'timeup'];
export const MAX_FOCUS_MINUTES = 12 * 60;

const focusSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: [...ACTIVE_FOCUS, 'completed', 'cancelled'], default: 'running' },
    plannedMs: { type: Number, required: true },
    endsAt: { type: Date, default: null },
    remainingMs: { type: Number, default: null },
    runningSince: { type: Date, default: null },
    focusedMs: { type: Number, default: 0 },
    endedAt: { type: Date, default: null },
    source: { type: String, enum: ['user', 'agent'], default: 'user' },
  },
  { timestamps: true },
);

// At most one active timer per user.
focusSessionSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ACTIVE_FOCUS } } });
// Focus time per day (Today panel, weekly progress).
focusSessionSchema.index({ userId: 1, endedAt: 1 });

/** For the app: what is left right now, and how long the user has focused so far. */
export function publicFocus(s, now = new Date()) {
  const live = s.status === 'running' && s.runningSince ? now - new Date(s.runningSince) : 0;
  const remainingMs =
    s.status === 'running' ? Math.max(0, new Date(s.endsAt) - now) : s.status === 'paused' ? s.remainingMs : 0;
  return {
    id: String(s._id),
    label: s.label,
    taskId: s.taskId ? String(s.taskId) : null,
    status: s.status,
    plannedMs: s.plannedMs,
    remainingMs,
    endsAt: s.status === 'running' ? s.endsAt : null,
    focusedMs: s.focusedMs + live,
    startedAt: s.createdAt,
    endedAt: s.endedAt,
    serverNow: now.toISOString(),
  };
}

export const FocusSession = mongoose.model('FocusSession', focusSessionSchema);
