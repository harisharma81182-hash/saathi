import { RateCounter } from '../models/RateCounter.js';
import { AppError } from '../utils/AppError.js';

// Fixed-window counter shared by all instances.
// One atomic upsert + $inc per check, so two instances incrementing at the same time can never
// both "see" the last free slot.
//
// Returns { allowed, count, limit, resetAt }. With peek: true it only reads the current count.
export async function hit(key, { limit, windowMs, now = Date.now(), peek = false }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);
  if (peek) {
    const existing = await RateCounter.findById(`${key}|${windowStart}`).lean();
    const count = existing?.count ?? 0;
    return { allowed: count < limit, count, limit, resetAt };
  }
  const increment = () =>
    RateCounter.findOneAndUpdate(
      { _id: `${key}|${windowStart}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: resetAt } },
      { upsert: true, returnDocument: 'after', lean: true },
    );
  let doc;
  try {
    doc = await increment();
  } catch (err) {
    // Two instances created the same window document at the same instant; one insert lost the race.
    // The document exists now, so a second attempt is a plain increment.
    if (err?.code !== 11000) throw err;
    doc = await increment();
  }
  return { allowed: doc.count <= limit, count: doc.count, limit, resetAt };
}

// Checks several limits (e.g. per minute AND per day) and throws a 429 with Retry-After
// if any is exceeded.
export async function enforce(checks, message) {
  for (const { key, limit, windowMs } of checks) {
    const result = await hit(key, { limit, windowMs });
    if (!result.allowed) {
      const err = new AppError(429, 'RATE_LIMITED', message ?? 'Slow down a little and try again shortly.');
      err.retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
      throw err;
    }
  }
}

// Marks a window as used up, e.g. when a provider says its limit is reached although our count is
// lower (requests made elsewhere with the same key, or a counter that started late).
export async function fill(key, { limit, windowMs, now = Date.now() }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const update = () =>
    RateCounter.updateOne(
      { _id: `${key}|${windowStart}` },
      { $max: { count: limit }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs) } },
      { upsert: true },
    );
  try {
    await update();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    await update();
  }
}

// Takes back one counted hit (e.g. a login attempt that turned out to be successful).
export async function undo(key, { windowMs, now = Date.now() }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  await RateCounter.updateOne({ _id: `${key}|${windowStart}`, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

export async function reset(key, { windowMs, now = Date.now() }) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  await RateCounter.deleteOne({ _id: `${key}|${windowStart}` });
}
