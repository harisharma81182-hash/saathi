import { logger } from '../lib/logger.js';
import { claimNext, complete, fail, release, extendLock, sweepAbandoned, DEFAULT_LOCK_MS } from './queue.js';

// Handlers by job type. Features register theirs at startup, e.g.
//   registerHandler('reminder.fire', async (payload, job) => { ... })
// Throw PermanentJobError for failures that retrying cannot fix (e.g. the reminder was deleted).
const handlers = new Map();

export class PermanentJobError extends Error {}

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

/**
 * Starts polling for jobs. Several workers (in several instances) can run at the same time;
 * the atomic claim in queue.js keeps them from doing the same job twice.
 */
export function startWorker({
  concurrency = 4,
  pollMs = 1000,
  idlePollMs = 2000,
  lockMs = DEFAULT_LOCK_MS,
  sweepEveryMs = 60_000,
} = {}) {
  let running = true;
  let active = 0;
  let timer = null;
  let polling = false;
  let pollAgain = false;
  let currentPoll = Promise.resolve();
  let lastSweep = 0;
  const log = logger.child({ component: 'worker' });

  async function runJob(job) {
    const handler = handlers.get(job.type);
    const jobLog = log.child({ jobId: job._id.toString(), type: job.type, attempt: job.attempts });
    if (!handler) {
      await fail(job, new Error(`No handler for job type "${job.type}"`), { permanent: true });
      jobLog.error('no handler registered');
      return;
    }

    // Long jobs keep their lock alive so nobody else starts a second copy.
    const heartbeat = setInterval(() => {
      extendLock(job, lockMs)
        .then((kept) => kept || jobLog.warn('lost the job lock; another worker may take over'))
        .catch((err) => jobLog.warn({ err: err.message }, 'could not extend job lock'));
    }, Math.max(50, Math.floor(lockMs / 3)));
    heartbeat.unref();

    const started = Date.now();
    try {
      await handler(job.payload, job);
      clearInterval(heartbeat);
      await complete(job);
      jobLog.info({ ms: Date.now() - started }, 'job done');
    } catch (err) {
      clearInterval(heartbeat);
      const outcome = await fail(job, err, { permanent: err instanceof PermanentJobError });
      jobLog[outcome === 'failed' ? 'error' : 'warn']({ err, outcome }, 'job failed');
    }
  }

  function schedule(ms) {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      currentPoll = tick();
    }, ms);
  }

  async function tick() {
    // Only one poll loop at a time, so the concurrency limit is never overshot.
    if (polling) {
      pollAgain = true;
      return;
    }
    polling = true;
    let claimedAny = false;
    try {
      if (Date.now() - lastSweep > sweepEveryMs) {
        lastSweep = Date.now();
        const swept = await sweepAbandoned();
        if (swept) log.warn({ swept }, 'dead-lettered jobs whose worker kept dying');
      }
      while (running && active < concurrency) {
        const job = await claimNext({ lockMs });
        if (!job) break;
        if (!running) {
          // stop() was called while we were claiming: hand the job back untouched.
          await release(job);
          break;
        }
        claimedAny = true;
        active++;
        runJob(job)
          // runJob's own bookkeeping (complete/fail) can throw if the database blips.
          // Never let that become an unhandled rejection that takes the whole process down;
          // the job's lock expires and it is retried.
          .catch((err) => log.error({ err: err.message, jobId: job._id.toString() }, 'job bookkeeping failed'))
          .finally(() => {
            active--;
            // A slot freed up: look for more work right away instead of waiting for the next poll.
            schedule(0);
          });
      }
    } catch (err) {
      log.error({ err: err.message }, 'poll failed (database unavailable?), backing off');
    } finally {
      polling = false;
    }
    if (pollAgain) {
      pollAgain = false;
      schedule(0);
    } else {
      schedule(claimedAny ? pollMs : idlePollMs);
    }
  }

  schedule(0);
  log.info({ concurrency }, 'worker started');

  return {
    get active() {
      return active;
    },
    // Stop taking new jobs and wait (up to timeoutMs) for running ones to finish.
    // Jobs still running after that keep their lock, which expires, and another worker retries them.
    async stop(timeoutMs = 10_000) {
      running = false;
      clearTimeout(timer);
      const deadline = Date.now() + timeoutMs;
      await Promise.race([currentPoll, new Promise((r) => setTimeout(r, timeoutMs))]);
      while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      log.info({ unfinished: active }, 'worker stopped');
    },
  };
}
