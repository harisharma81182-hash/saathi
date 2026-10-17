// Retry with exponential backoff and "full jitter".
//
// Exponential: wait 0.5s, 1s, 2s... so a struggling service gets room to recover.
// Jitter: each wait is random between 0 and that value, so a thousand clients that failed at the
// same moment do not all retry at the same moment and knock the service over again.
// If the service told us how long to wait (Retry-After), we respect that instead.

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function backoffDelay(attempt, { baseMs = 500, maxMs = 8000, random = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(random() * cap);
}

/**
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{
 *   retries?: number,
 *   isRetryable?: (err: any) => boolean,
 *   retryAfterMs?: (err: any) => number | undefined,
 *   deadlineMs?: number,
 *   baseMs?: number, maxMs?: number,
 *   onRetry?: (err: any, attempt: number, delayMs: number) => void,
 *   signal?: AbortSignal,
 *   random?: () => number,
 * }} opts
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries = 2,
    isRetryable = () => true,
    retryAfterMs = () => undefined,
    deadlineMs = Infinity,
    onRetry,
    signal,
  } = opts;
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delay = retryAfterMs(err) ?? backoffDelay(attempt, opts);
      // Do not start a retry that would finish after the caller has given up anyway.
      if (Date.now() - startedAt + delay >= deadlineMs) throw err;
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay, signal);
    }
  }
}
