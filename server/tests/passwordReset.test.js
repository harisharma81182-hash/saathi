import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

describe('password reset ("Password bhool gaye?")', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let request;
  let outbox;
  let PasswordReset;
  let RateCounter;
  let SAME_ANSWER;

  const forgot = (email, ip = '10.0.0.1') => request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', ip).send({ email });
  const reset = (token, password, ip = '10.0.0.1') => request(app).post('/api/auth/reset-password').set('X-Forwarded-For', ip).send({ token, password });
  // The link is emailed after the answer (so the timing reveals nothing); wait for it to arrive.
  const nextMail = async (count) => {
    for (let i = 0; i < 100 && outbox.length < count; i++) await new Promise((r) => setTimeout(r, 50));
    return outbox[count - 1];
  };
  const tokenFrom = (mail) => /#reset=([\w-]+)/.exec(mail.text)[1];

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    request = (await import('supertest')).default;
    app = createApp();
    ({ PasswordReset } = await import('../src/models/PasswordReset.js'));
    ({ RateCounter } = await import('../src/models/RateCounter.js'));
    ({ SAME_ANSWER } = await import('../src/services/passwordReset.service.js'));
    const mail = await import('../src/services/mail.service.js');
    outbox = [];
    mail.setOutboxForTests(outbox);
  });
  beforeEach(async () => {
    outbox.length = 0;
    await RateCounter.deleteMany({ _id: /^pwreset/ });
  });
  after(async () => {
    (await import('../src/services/mail.service.js')).setOutboxForTests(null);
    await teardownDb();
  });

  it('gives the same answer for registered and unknown emails, and only emails the real one', async () => {
    await loggedInAgent(app, { name: 'Himanshu', email: 'himanshu@example.com' });
    const known = await forgot('himanshu@example.com');
    const unknown = await forgot('nobody@example.com');
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.body.message, SAME_ANSWER);

    const mail = await nextMail(1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(outbox.length, 1, 'nothing is sent for an unknown email');
    assert.equal(mail.to, 'himanshu@example.com');
    assert.match(mail.text, /30 minute/);
    // Only the hash is stored, never the token from the link.
    const token = tokenFrom(mail);
    const saved = await PasswordReset.findOne({}).lean();
    assert.notEqual(saved.tokenHash, token);
    assert.equal(saved.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.ok(saved.expiresAt - saved.createdAt <= 30 * 60 * 1000 + 1000);
  });

  it('sets the new password, logs out every old session, and works only once', async () => {
    const { agent } = await loggedInAgent(app, { name: 'Asha', email: 'asha@example.com', password: 'oldpass123' });
    assert.equal((await agent.get('/api/auth/me')).status, 200);

    await forgot('asha@example.com');
    const token = tokenFrom(await nextMail(1));
    assert.deepEqual((await request(app).post('/api/auth/reset-password/check').send({ token })).body, { valid: true });

    // Same rules as signup.
    const weak = await reset(token, 'short');
    assert.equal(weak.status, 400);
    assert.match(weak.body.error.message, /8 characters/);

    const ok = await reset(token, 'newpass456');
    assert.equal(ok.status, 200);
    assert.match(ok.body.message, /Password badal gaya/);

    // The old session (a cookie from before the reset) no longer works.
    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 401);
    // Old password out, new password in.
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'oldpass123' })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'newpass456' })).status, 200);

    // The same link a second time: refused, with what to do next.
    const again = await reset(token, 'another789');
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, 'RESET_LINK_INVALID');
    assert.deepEqual((await request(app).post('/api/auth/reset-password/check').send({ token })).body, { valid: false });
  });

  it('two clicks on the same link at once: only one succeeds', async () => {
    await loggedInAgent(app, { name: 'Dev', email: 'dev@example.com' });
    await forgot('dev@example.com');
    const token = tokenFrom(await nextMail(1));
    const results = await Promise.all([reset(token, 'first1234'), reset(token, 'second1234')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it('a link stops working after 30 minutes, and a newer link replaces the older one', async () => {
    await loggedInAgent(app, { name: 'Ravi', email: 'ravi@example.com' });
    await forgot('ravi@example.com');
    const first = tokenFrom(await nextMail(1));
    await forgot('ravi@example.com');
    const second = tokenFrom(await nextMail(2));
    assert.equal((await reset(first, 'newpass456')).status, 400, 'the older link was replaced');

    await PasswordReset.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await reset(second, 'newpass456');
    assert.equal(expired.status, 400);
    assert.match(expired.body.error.message, /30 minute/);
  });

  it('limits requests per IP and emails per address', async () => {
    await loggedInAgent(app, { name: 'Neha', email: 'neha@example.com' });
    // Per address: at most 3 emails an hour, but the answer never changes.
    for (let i = 0; i < 4; i++) assert.equal((await forgot('neha@example.com', `10.1.0.${i}`)).status, 200);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(outbox.length, 3);
    // Per IP: 5 requests in 15 minutes, then a 429 (which says nothing about any account).
    for (let i = 0; i < 5; i++) await forgot(`x${i}@example.com`, '10.2.0.1');
    const blocked = await forgot('x9@example.com', '10.2.0.1');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);
  });

  it('when the email service refuses (Resend 403), the user still gets the same answer and the server keeps running', async () => {
    const mail = await import('../src/services/mail.service.js');
    const { env } = await import('../src/config/env.js');
    await loggedInAgent(app, { email: 'resend.fail@example.com' });
    const realFetch = globalThis.fetch;
    let tried = false;
    globalThis.fetch = async () => {
      tried = true;
      return new Response('{"message":"You can only send testing emails to your own email address"}', { status: 403 });
    };
    mail.setOutboxForTests(null);
    env.RESEND_API_KEY = 'test-resend-key';
    try {
      const res = await forgot('resend.fail@example.com', '10.0.0.9');
      assert.equal(res.status, 200);
      assert.equal(res.body.message, SAME_ANSWER);
      for (let i = 0; i < 100 && !tried; i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal(tried, true);
      await new Promise((r) => setTimeout(r, 100)); // the refusal is logged, nothing throws
      assert.equal((await request(app).get('/api/health/live')).status, 200);
    } finally {
      globalThis.fetch = realFetch;
      env.RESEND_API_KEY = '';
      mail.setOutboxForTests(outbox);
    }
  });

  it('rejects a made-up token', async () => {
    const res = await reset(crypto.randomBytes(32).toString('base64url'), 'newpass456');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'RESET_LINK_INVALID');
  });
});
