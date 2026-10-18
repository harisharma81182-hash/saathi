import { env, ai } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../utils/AppError.js';
import { Semaphore } from '../utils/semaphore.js';
import { withRetry } from '../utils/retry.js';
import { CircuitBreaker } from './circuitBreaker.js';
import * as quota from '../services/quota.service.js';

// Every call to the AI provider goes through this gateway. It protects the app from the provider
// (and the provider's rate limits from us):
//
//  1. Per-user quota     shared across instances (MongoDB), so one user cannot burn the budget
//  1b. App-wide quota    all users together stay under the provider's project limit (free tier)
//  2. Concurrency limit  at most AI_MAX_CONCURRENCY calls in flight per instance
//  3. Bounded queue      extra calls wait up to AI_QUEUE_TIMEOUT_MS, then get a fast 503
//  4. Timeout            a hung attempt is aborted after AI_REQUEST_TIMEOUT_MS, and the whole call
//                        (retries included) after AI_TOTAL_TIMEOUT_MS
//  5. Retry + backoff    on 429 / 5xx / 529 overloaded / network errors, respecting Retry-After
//  6. Model fallback     if the primary model is overloaded, try the fallback model
//  7. Circuit breaker    if the provider keeps failing, fail fast for a while instead of piling up
//
// The provider itself is passed in (`call`), so this works the same for Gemini and Claude, and the
// tests can use a fake provider.

const log = logger.child({ component: 'ai-gateway' });

// What the user sees when Saathi's AI budget runs out. Tasks, notes and reminders keep working.
export const AI_LIMIT_MESSAGES = {
  busy: 'Abhi mera AI thoda busy hai. Ek minute ruk ke phir try karo. Tab tak tasks, notes aur reminders normal chalte rahenge.',
  daily: 'Aaj ke liye mera free AI quota khatam ho gaya 😅 Kal phir baat karte hain. Tab tak tasks, notes aur reminders normal chalte rahenge.',
};

export function aiLimitError(kind, retryAfterSeconds) {
  const err = new AppError(429, kind === 'daily' ? 'AI_DAILY_LIMIT' : 'AI_BUSY', AI_LIMIT_MESSAGES[kind]);
  err.retryAfterSeconds = retryAfterSeconds;
  err.retryable = false; // waiting a few seconds won't help; and it is a limit, not an outage
  return err;
}

export function isRetryableAiError(err) {
  if (err?.retryable === false) return false; // e.g. the provider's daily limit: waiting won't help
  if (err?.name === 'AbortError' || err?.code === 'AI_TIMEOUT') return true;
  const status = err?.status;
  if (status === undefined) return true; // network failure, DNS, connection reset
  return status === 408 || status === 409 || status === 429 || status >= 500; // 529 = overloaded
}

function retryAfterFromError(err) {
  if (err?.retryAfterMs) return Math.min(err.retryAfterMs, 30_000); // Gemini puts the wait in the error body
  const raw = err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : undefined;
}

export function createAiGateway({
  maxConcurrency = env.AI_MAX_CONCURRENCY,
  maxQueue = env.AI_MAX_QUEUE,
  queueTimeoutMs = env.AI_QUEUE_TIMEOUT_MS,
  requestTimeoutMs = env.AI_REQUEST_TIMEOUT_MS,
  totalTimeoutMs = env.AI_TOTAL_TIMEOUT_MS,
  models = ai.models,
  retries = 2,
  perUserPerMinute = env.AI_USER_PER_MINUTE,
  perUserPerDay = env.AI_USER_PER_DAY,
  globalPerMinute = env.AI_GLOBAL_PER_MINUTE,
  globalPerDay = env.AI_GLOBAL_PER_DAY,
  breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 30_000 }),
  retryOptions = {},
} = {}) {
  const limiter = new Semaphore({ name: 'ai', max: maxConcurrency, maxQueue, queueTimeoutMs });

  async function enforceUserQuota(userId) {
    if (!userId) return;
    await quota.enforce(
      [{ key: `ai:${userId}:min`, limit: perUserPerMinute, windowMs: 60_000 }],
      'Arre, itne saare messages ek saath! Thoda saans le lo, ek minute baad phir baat karte hain.',
    );
    await quota.enforce(
      [{ key: `ai:${userId}:day`, limit: perUserPerDay, windowMs: 24 * 60 * 60_000 }],
      'Aaj ke liye humari baaton ki limit poori ho gayi 😅 Kal phir milte hain. Tab tak tasks, notes aur reminders normal chalte rahenge.',
    );
  }

  const globalWindows = [
    { kind: 'busy', key: 'ai:global:min', limit: globalPerMinute, windowMs: 60_000 },
    { kind: 'daily', key: 'ai:global:day', limit: globalPerDay, windowMs: 24 * 60 * 60_000 }, // resets at 00:00 UTC, like Gemini's
  ].filter((w) => w.limit > 0);

  /**
   * Counts one request to the provider against the app-wide limit. A new piece of work (a chat
   * message, a greeting) is refused once the limit is reached; the follow-up requests of a chat
   * message that already started are only counted, so a message is never cut off halfway.
   */
  async function countGlobal({ enforce }) {
    for (const { kind, key, limit, windowMs } of globalWindows) {
      const res = await quota.hit(key, { limit, windowMs });
      if (enforce && !res.allowed) {
        log.warn({ kind, limit }, 'app-wide AI limit reached');
        throw aiLimitError(kind, Math.max(1, Math.ceil((res.resetAt.getTime() - Date.now()) / 1000)));
      }
    }
  }

  /**
   * @param {{
   *   userId?: string,        counts against this user's quota (pass it once per chat message)
   *   continuation?: boolean, a follow-up request of work already under way (next step of a chat turn)
   *   call: (ctx: { model: string, signal: AbortSignal, attempt: number }) => Promise<T>,
   * }} req
   */
  async function run({ userId, continuation = false, call, signal: outerSignal }) {
    if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
    await enforceUserQuota(userId);
    await countGlobal({ enforce: !continuation });

    if (!breaker.allow()) {
      const err = new AppError(503, 'AI_UNAVAILABLE', "I can't reach my brain right now. Try again in a little while.");
      err.retryAfterSeconds = breaker.retryAfterSeconds();
      throw err;
    }

    // Whatever happens below (success, provider failure, our own error, local queue full,
    // user cancelled), the breaker must hear about it exactly once.
    let recorded = false;
    try {
      return await limiter.run(() => callProvider());
    } finally {
      if (!recorded) breaker.release();
    }

    async function callProvider() {
      let modelIndex = 0;
      const deadline = Date.now() + totalTimeoutMs;
      const timeoutError = () => Object.assign(new Error('AI request timed out'), { code: 'AI_TIMEOUT' });
      try {
        const result = await withRetry(
          async (attempt) => {
            const model = models[Math.min(modelIndex, models.length - 1)];
            // The caller may have gone away while this call waited in the queue.
            // ('abort' listeners never fire for a signal that is already aborted, so check first.)
            if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
            // Each attempt gets the normal timeout, cut short so the whole call ends by the deadline.
            const timeoutMs = Math.min(requestTimeoutMs, deadline - Date.now());
            if (timeoutMs < 1000) throw timeoutError();
            if (attempt > 0) await countGlobal({ enforce: false }); // a retry is one more request for the provider
            const controller = new AbortController();
            const onOuterAbort = () => controller.abort(outerSignal.reason);
            outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
            const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
            try {
              return await call({ model, signal: controller.signal, attempt });
            } catch (err) {
              if (controller.signal.aborted && controller.signal.reason?.code === 'AI_TIMEOUT') {
                throw controller.signal.reason;
              }
              throw err;
            } finally {
              clearTimeout(timer);
              outerSignal?.removeEventListener('abort', onOuterAbort);
            }
          },
          {
            retries,
            deadlineMs: totalTimeoutMs,
            isRetryable: (err) => !outerSignal?.aborted && isRetryableAiError(err),
            retryAfterMs: retryAfterFromError,
            signal: outerSignal,
            onRetry: (err, attempt, delayMs) => {
              // Overloaded (529) or server errors: the next attempt uses the fallback model.
              if (err?.status === 529 || err?.status >= 500) modelIndex++;
              log.warn({ status: err?.status, code: err?.code, attempt, delayMs }, 'AI call failed, retrying');
            },
            ...retryOptions,
          },
        );
        breaker.success();
        recorded = true;
        return result;
      } catch (err) {
        // The user went away (closed the tab, cancelled): not the provider's fault, and nobody
        // is waiting for a friendly message.
        if (outerSignal?.aborted) throw err;
        // Only provider-side failures count against the breaker, not our own bugs or bad input.
        if (isRetryableAiError(err)) {
          breaker.failure();
          recorded = true;
        }
        if (err instanceof AppError) throw err;
        log.error({ status: err?.status, code: err?.code, error: String(err?.message ?? '').slice(0, 300) }, 'AI call failed');
        const out = new AppError(503, 'AI_UNAVAILABLE', "I couldn't think that through just now. Try again in a moment.");
        out.retryAfterSeconds = 5;
        throw out;
      }
    }
  }

  return { run, stats: () => ({ ...limiter.stats(), breaker: breaker.state }) };
}
