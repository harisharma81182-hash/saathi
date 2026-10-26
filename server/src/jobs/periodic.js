import { enqueue } from './queue.js';
import { logger } from '../lib/logger.js';

// Recurring background work without a separate cron service. Time is cut into slots (every 30
// minutes for the proactive scan); each slot gets one job whose dedupe key is "type:slot time", so
// any number of instances can ask for it and only one job exists. Every run queues the next slot,
// and each worker also calls ensurePeriodicJobs() now and then, so a failed run never ends the chain.

export const PERIODIC_JOBS = {
  'proactive.scan': 30 * 60_000, // morning plan, countdowns, nudges, evening recap (services/proactive.service.js)
  'alerts.scan': 5 * 60_000, // tasks due in about an hour, and due now (services/alerts.service.js)
};

/** The start of the next slot after `now`. */
export const nextSlot = (everyMs, now = new Date()) => new Date((Math.floor(now.getTime() / everyMs) + 1) * everyMs);

export async function ensurePeriodicJobs(now = new Date()) {
  for (const [type, everyMs] of Object.entries(PERIODIC_JOBS)) {
    const runAt = nextSlot(everyMs, now);
    await enqueue(type, { slot: runAt.toISOString() }, { runAt, maxAttempts: 2, dedupeKey: `${type}:${runAt.toISOString()}` });
  }
}

/** Starts the safety net: re-checks every few minutes that the next slot is queued. */
export function startPeriodicJobs({ checkEveryMs = 5 * 60_000 } = {}) {
  const log = logger.child({ component: 'periodic' });
  const ensure = () => ensurePeriodicJobs().catch((err) => log.warn({ err: err.message }, 'could not queue periodic jobs'));
  ensure();
  const timer = setInterval(ensure, checkEveryMs);
  timer.unref();
  return () => clearInterval(timer);
}
