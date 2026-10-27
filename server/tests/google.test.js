import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb } from './helpers.js';

// "Continue with Google" with a fake verifier: no call to Google. A "token" here is
// "good." + the payload as base64url JSON; anything else is treated as a forged token.
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
const token = (payload) => `good.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
const person = (over = {}) => ({ sub: 'g-111', email: 'Meera@Gmail.com', email_verified: true, name: 'Meera', ...over });

describe('google sign-in', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let request;
  let google;
  let env;

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    google = await import('../src/services/google.service.js');
    ({ env } = await import('../src/config/env.js'));
    request = (await import('supertest')).default;
    google.setGoogleVerifierForTests(async (credential) => {
      if (!credential.startsWith('good.')) throw new Error('Wrong number of segments in token');
      return JSON.parse(Buffer.from(credential.slice(5), 'base64url').toString());
    });
    app = createApp();
  });

  after(async () => {
    google.setGoogleVerifierForTests(null);
    await teardownDb();
  });

  it('tells the login page the client id, and allows Google in the security headers', async () => {
    const res = await request(app).get('/api/auth/config');
    assert.equal(res.body.googleClientId, 'test-client.apps.googleusercontent.com');
    assert.match(res.headers['content-security-policy'], /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin-allow-popups');
  });

  it('creates an account on the first Google sign-in and logs in with a cookie', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/google').send({ credential: token(person()), timezone: 'Asia/Kolkata' });
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.user.email, 'meera@gmail.com');
    assert.equal(res.body.user.name, 'Meera');
    assert.equal(res.body.user.googleId, undefined);
    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'meera@gmail.com');
  });

  it('signs the same Google account in again without making a second account', async () => {
    const res = await request(app).post('/api/auth/google').send({ credential: token(person({ name: 'Meera S' })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.created, false);
  });

  it('an account made with Google has no password: password login gets the normal 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'meera@gmail.com', password: 'anything1' });
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /Google button/);
  });

  it('joins an existing password account with the same email, and the password keeps working', async () => {
    const signup = await request(app).post('/api/auth/signup').send({ name: 'Ravi', email: 'ravi@example.com', password: 'secret123' });
    const res = await request(app).post('/api/auth/google').send({ credential: token(person({ sub: 'g-222', email: 'ravi@example.com', name: 'Ravi K' })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.created, false);
    assert.equal(res.body.user.id, signup.body.user.id);
    assert.equal(res.body.user.name, 'Ravi');
    const login = await request(app).post('/api/auth/login').send({ email: 'ravi@example.com', password: 'secret123' });
    assert.equal(login.status, 200);
  });

  it('refuses a different Google account for an email that is already linked (409)', async () => {
    const res = await request(app).post('/api/auth/google').send({ credential: token(person({ sub: 'g-999' })) });
    assert.equal(res.status, 409);
  });

  it('refuses forged tokens and emails Google has not verified (401), and empty input (400)', async () => {
    const forged = await request(app).post('/api/auth/google').send({ credential: 'x'.repeat(40) });
    assert.equal(forged.status, 401);
    assert.equal(forged.headers['set-cookie'], undefined);
    const unverified = await request(app).post('/api/auth/google').send({ credential: token(person({ sub: 'g-333', email: 'new@gmail.com', email_verified: false })) });
    assert.equal(unverified.status, 401);
    const empty = await request(app).post('/api/auth/google').send({});
    assert.equal(empty.status, 400);
  });

  it('checks the nonce: the token must carry the value this browser sent to Google', async () => {
    const nonce = 'n-1234567890abcdef';
    const ok = await request(app).post('/api/auth/google').send({ credential: token(person({ nonce })), nonce });
    assert.equal(ok.status, 200);
    const copied = await request(app).post('/api/auth/google').send({ credential: token(person({ nonce: 'someone-elses-nonce-123' })), nonce });
    assert.equal(copied.status, 401);
    assert.equal(copied.headers['set-cookie'], undefined);
  });

  it('without GOOGLE_CLIENT_ID the button is hidden (null) and the endpoint answers 404', async () => {
    const saved = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = '';
    try {
      assert.equal((await request(app).get('/api/auth/config')).body.googleClientId, null);
      const res = await request(app).post('/api/auth/google').send({ credential: token(person()) });
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'GOOGLE_DISABLED');
    } finally {
      env.GOOGLE_CLIENT_ID = saved;
    }
  });
});
