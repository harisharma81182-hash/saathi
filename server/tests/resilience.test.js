// Unit tests for the pieces that keep the app stable under load. No database needed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js'; // sets test env vars before src/config/env.js loads

const { Semaphore } = await import('../src/utils/semaphore.js');
const { withRetry, backoffDelay } = await import('../src/utils/retry.js');
const { CircuitBreaker } = await import('../src/ai/circuitBreaker.js');
const { createAiGateway, isRetryableAiError } = await import('../src/ai/gateway.js');
const { TtlCache } = await import('../src/utils/ttlCache.js');
const { hashPassword, verifyPassword, needsRehash } = await import('../src/security/password.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const httpError = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { status, headers });

describe('Semaphore', () => {
  it('never runs more than max at once', async () => {
    const s = new Semaphore({ max: 3 });
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        s.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await tick(5);
          running--;
        }),
      ),
    );
    assert.equal(peak, 3);
    assert.deepEqual({ active: s.active, waiting: s.waiting.length }, { active: 0, waiting: 0 });
  });

  it('rejects with 503 BUSY when the queue is full (load shedding)', async () => {
    const s = new Semaphore({ max: 1, maxQueue: 1 });
    const blocker = s.run(() => tick(30));
    const queued = s.run(() => 'ran');
    await assert.rejects(s.run(() => 'never'), { status: 503, code: 'BUSY' });
    assert.equal(await queued, 'ran');
    await blocker;
  });

  it('rejects waiters that wait longer than queueTimeoutMs', async () => {
    const s = new Semaphore({ max: 1, queueTimeoutMs: 10 });
    const blocker = s.run(() => tick(50));
    await assert.rejects(s.run(() => 'late'), { code: 'BUSY' });
    await blocker;
    assert.equal(s.active, 0);
  });
});

describe('retry with backoff', () => {
  it('backoff grows exponentially and stays under the cap', () => {
    const max = () => 0.999999;
    assert.ok(backoffDelay(0, { baseMs: 100, random: max }) < 100);
    assert.ok(backoffDelay(3, { baseMs: 100, random: max }) < 800);
    assert.ok(backoffDelay(30, { baseMs: 100, maxMs: 1000, random: max }) < 1000);
  });

  it('retries retryable errors and then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw httpError(529);
        return 'ok';
      },
      { retries: 3, baseMs: 1, maxMs: 2 },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls++;
          throw httpError(400);
        },
        { retries: 3, isRetryable: isRetryableAiError, baseMs: 1 },
      ),
    );
    assert.equal(calls, 1);
  });
});

describe('CircuitBreaker', () => {
  it('opens after N failures, fails fast, then lets one trial through after cooldown', () => {
    let now = 0;
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => now });
    for (let i = 0; i < 3; i++) {
      assert.ok(b.allow());
      b.failure();
    }
    assert.equal(b.state, 'open');
    assert.equal(b.allow(), false);

    now = 1000;
    assert.equal(b.state, 'half-open');
    assert.equal(b.allow(), true); // the trial call
    assert.equal(b.allow(), false); // only one trial at a time
    b.success();
    assert.equal(b.state, 'closed');
  });

  it('reopens if the trial call fails', () => {
    let now = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 100, now: () => now });
    b.allow();
    b.failure();
    now = 100;
    assert.ok(b.allow());
    b.failure();
    assert.equal(b.state, 'open');
  });
});

describe('AI gateway', () => {
  const fast = { retryOptions: { baseMs: 1, maxMs: 2 } };

  it('retries an overloaded provider and switches to the fallback model', async () => {
    const seen = [];
    const gw = createAiGateway({ ...fast, models: ['primary', 'fallback'] });
    const out = await gw.run({
      call: async ({ model }) => {
        seen.push(model);
        if (model === 'primary') throw httpError(529);
        return 'answer';
      },
    });
    assert.equal(out, 'answer');
    assert.deepEqual(seen, ['primary', 'fallback']);
  });

  it('honours Retry-After from a 429', async () => {
    let calls = 0;
    const gw = createAiGateway({ ...fast, retries: 1 });
    const started = Date.now();
    await gw.run({
      call: async () => {
        if (calls++ === 0) throw httpError(429, { 'retry-after': '1' });
        return 'ok';
      },
    });
    assert.ok(Date.now() - started >= 950, 'waited about 1 second');
  });

  it('turns provider failures into a friendly 503 and opens the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
    const gw = createAiGateway({ ...fast, retries: 0, breaker });
    const failing = () => gw.run({ call: async () => Promise.reject(httpError(500)) });

    await assert.rejects(failing(), { status: 503, code: 'AI_UNAVAILABLE' });
    await assert.rejects(failing(), { status: 503, code: 'AI_UNAVAILABLE' });

    let called = false;
    await assert.rejects(
      gw.run({
        call: async () => {
          called = true;
        },
      }),
      (err) => err.code === 'AI_UNAVAILABLE' && err.retryAfterSeconds > 0,
    );
    assert.equal(called, false, 'breaker is open, provider not called');
  });

  it('a non-retryable error during the half-open trial does not leave the breaker stuck', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => now });
    const gw = createAiGateway({ ...fast, retries: 0, breaker });
    await assert.rejects(gw.run({ call: async () => Promise.reject(httpError(500)) }));
    assert.equal(breaker.state, 'open');

    now = 1000; // cooldown over: the next call is the trial, and it fails with our own bad request
    await assert.rejects(gw.run({ call: async () => Promise.reject(httpError(400)) }));
    const out = await gw.run({ call: async () => 'recovered' });
    assert.equal(out, 'recovered', 'a later call is allowed through and closes the breaker');
    assert.equal(breaker.state, 'closed');
  });

  it('users cancelling requests do not trip the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
    const gw = createAiGateway({ ...fast, breaker });
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const p = gw.run({
        signal: controller.signal,
        call: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      });
      controller.abort(new Error('user closed the tab'));
      await assert.rejects(p);
    }
    assert.equal(breaker.state, 'closed');
    const already = new AbortController();
    already.abort(new Error('gone'));
    await assert.rejects(gw.run({ signal: already.signal, call: async () => 'never' }), /gone/);
  });

  it('keeps the whole call, retries included, under the total timeout', async () => {
    const gw = createAiGateway({ ...fast, retries: 2, requestTimeoutMs: 1000, totalTimeoutMs: 1500 });
    let attempts = 0;
    const started = Date.now();
    await assert.rejects(
      gw.run({
        call: ({ signal }) => {
          attempts++;
          return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
        },
      }),
      { code: 'AI_UNAVAILABLE' },
    );
    const took = Date.now() - started;
    assert.ok(took < 1700, `took ${took} ms`);
    assert.equal(attempts, 1, 'no second attempt that could not finish in time');
  });

  it('aborts calls that hang past the timeout', async () => {
    const gw = createAiGateway({ ...fast, retries: 0, requestTimeoutMs: 1000 });
    const started = Date.now();
    await assert.rejects(
      gw.run({
        call: ({ signal }) =>
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      }),
      { code: 'AI_UNAVAILABLE' },
    );
    assert.ok(Date.now() - started < 1500);
  });

  it('limits concurrent provider calls per instance', async () => {
    const gw = createAiGateway({ ...fast, maxConcurrency: 2, maxQueue: 100 });
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        gw.run({
          call: async () => {
            running++;
            peak = Math.max(peak, running);
            await tick(5);
            running--;
          },
        }),
      ),
    );
    assert.equal(peak, 2);
  });
});

describe('TtlCache', () => {
  it('expires entries and evicts the oldest when full', async () => {
    const c = new TtlCache({ ttlMs: 20, maxEntries: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    assert.equal(c.get('a'), undefined);
    assert.equal(c.get('c'), 3);
    await tick(30);
    assert.equal(c.get('c'), undefined);
  });
});

describe('password hashing', () => {
  it('verifies scrypt hashes and rejects wrong passwords', async () => {
    const h = await hashPassword('secret123');
    assert.match(h, /^scrypt\$16384\$8\$5\$/);
    assert.equal(await verifyPassword('secret123', h), true);
    assert.equal(await verifyPassword('secret124', h), false);
    assert.equal(needsRehash(h), false);
  });

  it('rejects malformed stored hashes and flags weaker parameters for upgrade', async () => {
    assert.equal(await verifyPassword('secret123', 'not-a-hash'), false);
    assert.equal(await verifyPassword('secret123', undefined), false);
    assert.equal(needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA=='), true);
  });

  it('does not block the event loop while hashing', async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 5);
    await Promise.all([hashPassword('a1234567'), hashPassword('b1234567'), hashPassword('c1234567')]);
    clearInterval(interval);
    assert.ok(ticks >= 5, `event loop kept running (${ticks} timer ticks during hashing)`);
  });
});
