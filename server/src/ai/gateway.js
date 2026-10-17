import { env } from '../config/env.js';
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
//  2. Concurrency limit  at most AI_MAX_CONCURRENCY calls in flight per instance
//  3. Bounded queue      extra calls wait up to AI_QUEUE_TIMEOUT_MS, then get a fast 503
//  4. Timeout            a hung call is aborted after AI_REQUEST_TIMEOUT_MS
//  5. Retry + backoff    on 429 / 5xx / 529 overloaded / network errors, respecting Retry-After
//  6. Model fallback     if the primary model is overloaded, try the fallback model
//  7. Circuit breaker    if the provider keeps failing, fail fast for a while instead of piling up
//
// The provider itself is passed in (`call`), so this works for Claude today and could wrap any other
// API, and the tests can use a fake provider.

const log = logger.child({ component: 'ai-gateway' });

export function isRetryableAiError(err) {
  if (err?.name === 'AbortError' || err?.code === 'AI_TIMEOUT') return true;
  const status = err?.status;
  if (status === undefined) return true; // network failure, DNS, connection reset
  return status === 408 || status === 409 || status === 429 || status >= 500; // 529 = overloaded
}

function retryAfterFromError(err) {
  const raw = err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : undefined;
}

export function createAiGateway({
  maxConcurrency = env.AI_MAX_CONCURRENCY,
  maxQueue = env.AI_MAX_QUEUE,
  queueTimeoutMs = env.AI_QUEUE_TIMEOUT_MS,
  requestTimeoutMs = env.AI_REQUEST_TIMEOUT_MS,
  models = [env.ANTHROPIC_MODEL, env.ANTHROPIC_FALLBACK_MODEL].filter(Boolean),
  retries = 2,
  perUserPerMinute = env.AI_USER_PER_MINUTE,
  perUserPerDay = env.AI_USER_PER_DAY,
  breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 30_000 }),
  retryOptions = {},
} = {}) {
  const limiter = new Semaphore({ name: 'ai', max: maxConcurrency, maxQueue, queueTimeoutMs });

  async function enforceUserQuota(userId) {
    if (!userId) return;
    await quota.enforce(
      [
        { key: `ai:${userId}:min`, limit: perUserPerMinute, windowMs: 60_000 },
        { key: `ai:${userId}:day`, limit: perUserPerDay, windowMs: 24 * 60 * 60_000 },
      ],
      "You've sent a lot of messages quickly. Take a short break and try again.",
    );
  }

  /**
   * @param {{ userId?: string, call: (ctx: { model: string, signal: AbortSignal, attempt: number }) => Promise<T> }} req
   */
  async function run({ userId, call, signal: outerSignal }) {
    if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
    await enforceUserQuota(userId);

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
      try {
        const result = await withRetry(
          async (attempt) => {
            const model = models[Math.min(modelIndex, models.length - 1)];
            // The caller may have gone away while this call waited in the queue.
            // ('abort' listeners never fire for a signal that is already aborted, so check first.)
            if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
            const controller = new AbortController();
            const onOuterAbort = () => controller.abort(outerSignal.reason);
            outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
            const timer = setTimeout(() => controller.abort(Object.assign(new Error('AI request timed out'), { code: 'AI_TIMEOUT' })), requestTimeoutMs);
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
            deadlineMs: requestTimeoutMs * 2,
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
        log.error({ status: err?.status, code: err?.code, msg: err?.message }, 'AI call failed');
        const out = new AppError(503, 'AI_UNAVAILABLE', "I couldn't think that through just now. Try again in a moment.");
        out.retryAfterSeconds = 5;
        throw out;
      }
    }
  }

  return { run, stats: () => ({ ...limiter.stats(), breaker: breaker.state }) };
}
