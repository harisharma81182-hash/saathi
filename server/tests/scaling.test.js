// Integration tests for the multi-instance pieces: job queue, shared quotas, health checks.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb, loggedInAgent, isRealMongo } from './helpers.js';

// Waits until check() returns true (or gives up). Database round trips to Atlas can take a few
// hundred milliseconds, so tests wait for the outcome instead of sleeping a fixed, tight amount.
async function waitFor(check, { timeoutMs = 10_000, everyMs = 50 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

describe('scaling building blocks', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let queue;
  let worker;
  let quota;
  let Job;
  let app;
  let request;

  before(async () => {
    await setupDb();
    queue = await import('../src/jobs/queue.js');
    worker = await import('../src/jobs/worker.js');
    quota = await import('../src/services/quota.service.js');
    ({ Job } = await import('../src/models/Job.js'));
    const { createApp } = await import('../src/app.js');
    request = (await import('supertest')).default;
    app = createApp();
  });

  after(teardownDb);

  describe('job queue', () => {
    it('two workers claiming at once never get the same job', async (t) => {
      if (!(await isRealMongo())) return t.skip('needs real MongoDB atomicity (run against Atlas)');
      await Job.deleteMany({});
      await Promise.all(Array.from({ length: 20 }, (_, i) => queue.enqueue('test.noop', { i })));

      // 40 concurrent claims for 20 jobs, as if several instances were polling together.
      const claims = await Promise.all(Array.from({ length: 40 }, () => queue.claimNext()));
      const ids = claims.filter(Boolean).map((j) => j._id.toString());
      assert.equal(ids.length, 20);
      assert.equal(new Set(ids).size, 20, 'no job claimed twice');
    });

    it('dedupeKey prevents duplicate jobs', async () => {
      const a = await queue.enqueue('reminder.fire', { r: 1 }, { dedupeKey: 'reminder:abc' });
      const b = await queue.enqueue('reminder.fire', { r: 1 }, { dedupeKey: 'reminder:abc' });
      assert.equal(a._id.toString(), b._id.toString());
      assert.equal(await Job.countDocuments({ dedupeKey: 'reminder:abc' }), 1);
    });

    it('does not run jobs before runAt', async () => {
      await Job.deleteMany({});
      await queue.enqueue('later', {}, { runAt: new Date(Date.now() + 60_000) });
      assert.equal(await queue.claimNext(), null);
    });

    it('a job whose worker crashed is picked up again after its lock expires', async () => {
      await Job.deleteMany({});
      await queue.enqueue('crashy', {});
      const first = await queue.claimNext({ lockMs: 1 }); // "crashes" holding a 1 ms lock
      assert.ok(first);
      await new Promise((r) => setTimeout(r, 10));
      const again = await queue.claimNext();
      assert.equal(again._id.toString(), first._id.toString());
      assert.equal(again.attempts, 2);
    });

    it('worker runs handlers, retries failures with backoff, and dead-letters after maxAttempts', async () => {
      await Job.deleteMany({});
      let okRuns = 0;
      worker.registerHandler('test.ok', async () => {
        okRuns++;
      });
      worker.registerHandler('test.broken', async () => {
        throw new Error('always fails');
      });
      worker.registerHandler('test.gone', async () => {
        throw new worker.PermanentJobError('reminder was deleted');
      });

      const ok = await queue.enqueue('test.ok');
      const broken = await queue.enqueue('test.broken', {}, { maxAttempts: 1 });
      const gone = await queue.enqueue('test.gone', {}, { maxAttempts: 5 });
      const retrying = await queue.enqueue('test.broken', {}, { maxAttempts: 3 });

      const w = worker.startWorker({ concurrency: 2, pollMs: 10, idlePollMs: 10 });
      const settled = async () => {
        const jobs = await Job.find({ _id: { $in: [ok._id, broken._id, gone._id, retrying._id] } }).lean();
        return jobs.every((j) => j.status !== 'running' && (j.status !== 'queued' || j.lastError));
      };
      await waitFor(settled);
      await w.stop(1000);

      const byId = async (j) => Job.findById(j._id).lean();
      assert.equal(okRuns, 1);
      assert.equal((await byId(ok)).status, 'done');
      assert.equal((await byId(broken)).status, 'failed');
      assert.equal((await byId(gone)).status, 'failed', 'permanent errors are not retried');
      assert.equal((await byId(gone)).attempts, 1);
      const r = await byId(retrying);
      assert.equal(r.status, 'queued', 'scheduled for a retry');
      // Compared with when the job was created, not with "now", so a slow network to the database
      // cannot make this test fail.
      assert.ok(r.runAt.getTime() >= r.createdAt.getTime() + 1000, 'retry is scheduled later (backoff)');
      assert.equal(r.lastError, 'always fails');
    });
  });

  describe('job locks', () => {
    it('a job that runs longer than its lock keeps the lock (heartbeat), so nobody else starts a copy', async () => {
      await Job.deleteMany({});
      let runs = 0;
      worker.registerHandler('test.slow', async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 4000));
      });
      await queue.enqueue('test.slow');
      // Lock of 1.5 s, job takes 4 s. Without the heartbeat the lock would expire mid-run.
      // (The lock is long enough that a slow database round trip cannot make it expire by itself.)
      const w = worker.startWorker({ concurrency: 1, pollMs: 20, idlePollMs: 20, lockMs: 1500 });
      // Meanwhile "another instance" keeps trying to claim work.
      const stolen = [];
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const j = await queue.claimNext();
        if (j) stolen.push(j);
      }
      await w.stop(5000);
      assert.equal(stolen.length, 0, 'the running job was never claimed by anyone else');
      assert.equal(runs, 1);
      assert.equal((await Job.findOne({ type: 'test.slow' }).lean()).status, 'done');
    });

    it('stale runs cannot overwrite the result of the run that took over', async () => {
      await Job.deleteMany({});
      await queue.enqueue('test.stale');
      const first = await queue.claimNext({ lockMs: 1 });
      await new Promise((r) => setTimeout(r, 10));
      const second = await queue.claimNext();
      await queue.complete(second);
      await queue.fail(first, new Error('late failure from the stale run'));
      const job = await Job.findById(first._id).lean();
      assert.equal(job.status, 'done');
    });

    it('jobs that killed their worker on every attempt are dead-lettered', async () => {
      await Job.deleteMany({});
      await queue.enqueue('test.crash', {}, { maxAttempts: 1 });
      await queue.claimNext({ lockMs: 1 });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(await queue.claimNext(), null, 'not claimed again after its last attempt');
      assert.equal(await queue.sweepAbandoned(), 1);
      assert.equal((await Job.findOne({ type: 'test.crash' }).lean()).status, 'failed');
    });
  });

  describe('shared quota', () => {
    it('counts atomically across concurrent requests', async (t) => {
      if (!(await isRealMongo())) return t.skip('needs real MongoDB atomicity (run against Atlas)');
      const results = await Promise.all(
        Array.from({ length: 15 }, () => quota.hit('test:concurrent', { limit: 10, windowMs: 60_000 })),
      );
      assert.equal(results.filter((r) => r.allowed).length, 10);
    });

    it('enforce() throws 429 with Retry-After once the limit is hit', async () => {
      const check = [{ key: 'test:enforce', limit: 2, windowMs: 60_000 }];
      await quota.enforce(check);
      await quota.enforce(check);
      await assert.rejects(quota.enforce(check), (err) => err.status === 429 && err.retryAfterSeconds > 0);
    });

    it('parallel guesses cannot get past the per-account limit', async (t) => {
      if (!(await isRealMongo())) return t.skip('needs real MongoDB atomicity (run against Atlas)');
      const email = `burst${Date.now()}@example.com`;
      await loggedInAgent(app, { email });
      const results = await Promise.all(
        Array.from({ length: 25 }, () => request(app).post('/api/auth/login').send({ email, password: 'wrong1234' })),
      );
      assert.equal(results.filter((r) => r.status === 401).length, 10);
      assert.equal(results.filter((r) => r.status === 429).length, 15);
    });

    it('a successful login does not use up an allowed failure', async () => {
      const email = `ok${Date.now()}@example.com`;
      await loggedInAgent(app, { email });
      for (let i = 0; i < 12; i++) {
        const res = await request(app).post('/api/auth/login').send({ email, password: 'secret123' });
        assert.equal(res.status, 200);
      }
    });

    it('locks an account after 10 failed logins, from any instance', async () => {
      const email = `lock${Date.now()}@example.com`;
      await loggedInAgent(app, { email });
      for (let i = 0; i < 10; i++) {
        const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong1234' });
        assert.equal(res.status, 401);
      }
      const locked = await request(app).post('/api/auth/login').send({ email, password: 'secret123' });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers['retry-after']) > 0);
    });
  });

  describe('health checks', () => {
    it('liveness and readiness are both up with a healthy database', async () => {
      const live = await request(app).get('/api/health/live');
      const ready = await request(app).get('/api/health/ready');
      assert.equal(live.status, 200);
      assert.equal(ready.status, 200);
      assert.equal(ready.body.database, 'up');
    });

    it('readiness turns 503 while shutting down, liveness stays 200', async () => {
      const { lifecycle } = await import('../src/lib/lifecycle.js');
      lifecycle.shuttingDown = true;
      try {
        assert.equal((await request(app).get('/api/health/ready')).status, 503);
        assert.equal((await request(app).get('/api/health/live')).status, 200);
      } finally {
        lifecycle.shuttingDown = false;
      }
    });

    it('every response carries a request id for tracing', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
      const echoed = await request(app).get('/api/auth/me').set('X-Request-Id', 'abc-123');
      assert.equal(echoed.headers['x-request-id'], 'abc-123');
    });
  });
});
