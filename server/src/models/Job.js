import mongoose from 'mongoose';

// A durable background job stored in MongoDB.
//
// Why MongoDB and not Redis/BullMQ: we already run MongoDB, our job volume is small (reminders,
// occasional slow AI work), and one fewer service means less cost and less to operate.
// The queue code only touches this model, so it can be swapped for BullMQ later if job volume
// ever needs it (see docs/SCALING.md).
const jobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
    runAt: { type: Date, default: () => new Date() },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    // maxAttempts - attempts, kept as its own field so queries can filter on it with a plain index
    // (no per-document expressions needed).
    attemptsLeft: { type: Number, default: 5 },
    // While a worker runs a job it holds a lock until lockedUntil. If that worker crashes,
    // the lock expires and another worker picks the job up again.
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    // Optional: the same dedupeKey can only be queued once (e.g. one job per reminder),
    // so double clicks or retried requests never schedule duplicate work.
    dedupeKey: { type: String },
    finishedAt: { type: Date, default: null },
    // Finished jobs are deleted automatically after a week.
    expireAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The query every worker runs to find work: "queued and due, oldest first".
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
jobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const Job = mongoose.model('Job', jobSchema);
