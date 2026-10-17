import crypto from 'node:crypto';
import { Job } from '../models/Job.js';
import { backoffDelay } from '../utils/retry.js';

const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_LOCK_MS = 2 * 60 * 1000;

const workerId = `${process.env.HOSTNAME ?? 'local'}:${process.pid}`;

/**
 * Adds a job. With a dedupeKey, adding the same job twice returns the existing one instead.
 */
export async function enqueue(type, payload = {}, { runAt = new Date(), maxAttempts = 5, dedupeKey } = {}) {
  try {
    return await Job.create({
      type,
      payload,
      runAt,
      maxAttempts,
      attemptsLeft: maxAttempts,
      ...(dedupeKey && { dedupeKey }),
    });
  } catch (err) {
    if (err?.code === 11000 && dedupeKey) return Job.findOne({ dedupeKey });
    throw err;
  }
}

/**
 * Atomically takes the next due job. Because this is a single findOneAndUpdate,
 * two workers can never claim the same job, however many instances are running.
 *
 * Each claim gets its own random lock token. complete()/fail()/extendLock() only act if the token
 * still matches, so a run that lost its lock (too slow, or its worker was presumed dead) can never
 * overwrite the result of the run that took over.
 *
 * Jobs whose lock expired (their worker crashed) are claimed again, unless they have used up
 * their attempts; sweepAbandoned() dead-letters those.
 */
export async function claimNext({ lockMs = DEFAULT_LOCK_MS, now = new Date() } = {}) {
  const lockToken = `${workerId}:${crypto.randomBytes(6).toString('hex')}`;
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', runAt: { $lte: now } },
        { status: 'running', lockedUntil: { $lt: now }, attemptsLeft: { $gt: 0 } },
      ],
    },
    {
      $set: { status: 'running', lockedBy: lockToken, lockedUntil: new Date(now.getTime() + lockMs) },
      $inc: { attempts: 1, attemptsLeft: -1 },
    },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  );
}

/** Keeps a long-running job's lock alive. Returns false if the lock was lost. */
export async function extendLock(job, lockMs = DEFAULT_LOCK_MS) {
  const res = await Job.updateOne(
    { _id: job._id, lockedBy: job.lockedBy, status: 'running' },
    { $set: { lockedUntil: new Date(Date.now() + lockMs) } },
  );
  return res.matchedCount === 1;
}

export async function complete(job) {
  const now = new Date();
  await Job.updateOne(
    { _id: job._id, lockedBy: job.lockedBy },
    {
      $set: {
        status: 'done',
        finishedAt: now,
        lockedBy: null,
        lockedUntil: null,
        expireAt: new Date(now.getTime() + DONE_RETENTION_MS),
      },
    },
  );
}

/**
 * Failed attempt: retry later with backoff, or give up after maxAttempts and keep the job
 * as "failed" (a dead letter) so it can be inspected instead of silently disappearing.
 */
export async function fail(job, err, { permanent = false } = {}) {
  const now = new Date();
  const giveUp = permanent || job.attemptsLeft <= 0;
  const message = String(err?.message ?? err).slice(0, 1000);
  await Job.updateOne(
    { _id: job._id, lockedBy: job.lockedBy },
    {
      $set: giveUp
        ? {
            status: 'failed',
            lastError: message,
            finishedAt: now,
            lockedBy: null,
            lockedUntil: null,
            expireAt: new Date(now.getTime() + DONE_RETENTION_MS),
          }
        : {
            status: 'queued',
            lastError: message,
            runAt: new Date(now.getTime() + Math.max(1000, backoffDelay(job.attempts, { baseMs: 2000, maxMs: 5 * 60 * 1000 }))),
            lockedBy: null,
            lockedUntil: null,
          },
    },
  );
  return giveUp ? 'failed' : 'retry';
}

/** Gives a claimed-but-not-started job back to the queue (used when a worker is stopping). */
export async function release(job) {
  await Job.updateOne(
    { _id: job._id, lockedBy: job.lockedBy },
    { $set: { status: 'queued', lockedBy: null, lockedUntil: null }, $inc: { attempts: -1, attemptsLeft: 1 } },
  );
}

/**
 * Jobs that crashed their worker on every attempt: lock expired and no attempts left.
 * Mark them failed so they stop looking "running" forever.
 */
export async function sweepAbandoned(now = new Date()) {
  const res = await Job.updateMany(
    { status: 'running', lockedUntil: { $lt: now }, attemptsLeft: { $lte: 0 } },
    {
      $set: {
        status: 'failed',
        lastError: 'worker stopped responding on every attempt',
        finishedAt: now,
        lockedBy: null,
        lockedUntil: null,
        expireAt: new Date(now.getTime() + DONE_RETENTION_MS),
      },
    },
  );
  return res.modifiedCount;
}

export async function stats() {
  const rows = await Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}
