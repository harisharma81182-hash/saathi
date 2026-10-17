import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

describe('auth', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let request;

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    request = (await import('supertest')).default;
    app = createApp();
  });

  after(teardownDb);

  it('signs up, sets an httpOnly cookie, and never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'secret123' });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'asha@example.com');
    assert.equal(res.body.user.passwordHash, undefined);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    assert.match(cookie, /saathi_token=/);
    assert.match(cookie, /HttpOnly/i);
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Asha 2', email: 'asha@example.com', password: 'secret123' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('rejects weak passwords and bad emails with field-level details', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    assert.equal(res.status, 400);
    const fields = res.body.error.details.map((d) => d.field);
    assert.ok(fields.includes('name'));
    assert.ok(fields.includes('email'));
    assert.ok(fields.includes('password'));
  });

  it('logs in with the right password and refuses the wrong one with the same message', async () => {
    const ok = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret123' });
    assert.equal(ok.status, 200);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@example.com', password: 'wrong1234' });
    const noSuchUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong1234' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(noSuchUser.status, 401);
    assert.equal(wrongPassword.body.error.message, noSuchUser.body.error.message);
  });

  it('protects /me and returns the user once logged in', async () => {
    const anon = await request(app).get('/api/auth/me');
    assert.equal(anon.status, 401);

    const { agent, user } = await loggedInAgent(app);
    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, user.id);
  });

  it('rejects a forged token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.real.token');
    assert.equal(res.status, 401);
  });

  it('updates the timezone and rejects an unknown one', async () => {
    const { agent } = await loggedInAgent(app);
    const ok = await agent.patch('/api/auth/me').send({ timezone: 'Europe/London' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.timezone, 'Europe/London');

    const bad = await agent.patch('/api/auth/me').send({ timezone: 'Mars/Olympus' });
    assert.equal(bad.status, 400);
  });

  it('logout clears the cookie', async () => {
    const { agent } = await loggedInAgent(app);
    const out = await agent.post('/api/auth/logout');
    assert.equal(out.status, 204);
    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 401);
  });

  it('returns clean JSON for malformed bodies and unknown routes', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_JSON');

    const missing = await request(app).get('/api/nope');
    assert.equal(missing.status, 404);
  });
});
