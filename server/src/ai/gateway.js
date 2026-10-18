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
//  1b. Per-model quota  all users together stay under each model's limit at the provider (free tier)
//  2. Concurrency limit  at most AI_MAX_CONCURRENCY calls in flight per instance
//  3. Bounded queue      extra calls wait up to AI_QUEUE_TIMEOUT_MS, then get a fast 503
//  4. Timeout            a hung attempt is aborted after AI_REQUEST_TIMEOUT_MS, and the whole call
//                        (retries included) after AI_TOTAL_TIMEOUT_MS
//  5. Retry + backoff    on 429 / 5xx / 529 overloaded / network errors, respecting Retry-After
//  6. Model chain        models are tried in order (GEMINI_MODELS): a model that is at its limit,
//                        rate-limited (429) or overloaded (5xx) hands over to the next one at once
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

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000; // windows start at 00:00 UTC (5:30 AM IST), when Gemini's daily quota resets

const secondsUntil = (windowMs) => Math.max(1, Math.ceil((windowMs - (Date.now() % windowMs)) / 1000));

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
  totalTimeoutMs = env.AI_TOTAL_TIMEOUT_MS,
  models = ai.models,
  retries = 2,
  perUserPerMinute = env.AI_USER_PER_MINUTE,
  perUserPerDay = env.AI_USER_PER_DAY,
  modelLimits = env.AI_MODEL_LIMITS,
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

  // Shared counters per model (MongoDB), keyed like "ai:model:<model>:min". A limit of 0 means none.
  const windowsFor = (model) => {
    const limits = modelLimits[model];
    if (!limits) return [];
    return [
      { kind: 'minute', key: `ai:model:${model}:min`, limit: limits.perMinute, windowMs: MINUTE_MS },
      { kind: 'day', key: `ai:model:${model}:day`, limit: limits.perDay, windowMs: DAY_MS },
    ].filter((w) => w.limit > 0);
  };

  /**
   * Picks the first model in the chain that still has room, and counts the request against it.
   * A new piece of work (a chat message, a greeting) is refused when every model is at its limit;
   * a follow-up request of a message already under way (`enforce: false`) still goes out, so a
   * message is never cut off halfway (the provider may still say no, then we move on).
   */
  async function pickModel(skip, { enforce }) {
    let minuteLimited = false;
    for (const model of models) {
      if (skip.has(model)) continue;
      let room = true;
      for (const w of windowsFor(model)) {
        const res = await quota.hit(w.key, { limit: w.limit, windowMs: w.windowMs });
        if (!res.allowed) {
          room = false;
          if (w.kind === 'minute') minuteLimited = true;
          break;
        }
      }
      if (room) return model;
    }
    const left = models.find((m) => !skip.has(m));
    if (!enforce && left) return left;
    log.warn({ minuteLimited }, 'every AI model is at its limit');
    throw minuteLimited ? aiLimitError('busy', 60) : aiLimitError('daily', secondsUntil(DAY_MS));
  }

  /** The provider said this model is at its limit: count it as full so nobody tries it again this window. */
  async function markFull(model, rateLimit) {
    const w = windowsFor(model).find((x) => x.kind === rateLimit);
    if (w) await quota.fill(w.key, { limit: w.limit, windowMs: w.windowMs });
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
      const skip = new Set(); // models that failed (limit or overload) during this call
      let failures = 0; // failures other than rate limits; only these use up `retries`
      const deadline = Date.now() + totalTimeoutMs;
      const timeoutError = () => Object.assign(new Error('AI request timed out'), { code: 'AI_TIMEOUT' });
      try {
        const result = await withRetry(
          async (attempt) => {
            // The caller may have gone away while this call waited in the queue.
            // ('abort' listeners never fire for a signal that is already aborted, so check first.)
            if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
            // Each attempt gets the normal timeout, cut short so the whole call ends by the deadline.
            const timeoutMs = Math.min(requestTimeoutMs, deadline - Date.now());
            if (timeoutMs < 1000) throw timeoutError();
            const model = await pickModel(skip, { enforce: !continuation });
            const controller = new AbortController();
            const onOuterAbort = () => controller.abort(outerSignal.reason);
            outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
            const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
            try {
              return await call({ model, signal: controller.signal, attempt });
            } catch (caught) {
              const timedOut = controller.signal.aborted && controller.signal.reason?.code === 'AI_TIMEOUT';
              const err = timedOut ? controller.signal.reason : caught;
              // Rate-limited or overloaded: the next attempt goes to the next model in the chain.
              if (err?.rateLimit) {
                await markFull(model, err.rateLimit);
                skip.add(model);
              } else {
                failures++;
                if ((err?.status === 529 || err?.status >= 500) && skip.size < models.length - 1) skip.add(model);
              }
              err.model = model;
              throw err;
            } finally {
              clearTimeout(timer);
              outerSignal?.removeEventListener('abort', onOuterAbort);
            }
          },
          {
            // Moving down the chain after a rate limit does not use up the normal retries.
            retries: retries + models.length,
            deadlineMs: totalTimeoutMs,
            isRetryable: (err) =>
              !outerSignal?.aborted &&
              (err?.rateLimit ? models.some((m) => !skip.has(m)) : failures <= retries && isRetryableAiError(err)),
            retryAfterMs: (err) => (err?.rateLimit ? 0 : retryAfterFromError(err)),
            signal: outerSignal,
            onRetry: (err, attempt, delayMs) => {
              log.warn({ model: err?.model, status: err?.status, code: err?.code, rateLimit: err?.rateLimit, attempt, delayMs }, 'AI call failed, retrying');
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
