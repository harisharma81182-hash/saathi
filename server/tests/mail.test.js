// Email sending without a database or a real mail service: fetch is replaced, so nothing leaves the laptop.
import './helpers.js';
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { sendMail, mailConfigured, mailStatus, RESEND_DEFAULT_FROM } from '../src/services/mail.service.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  env.BREVO_API_KEY = '';
  env.RESEND_API_KEY = '';
  env.MAIL_FROM = undefined;
});

test('without any email settings, nothing is sent (the text goes to the log)', async () => {
  assert.equal(mailConfigured(), false);
  assert.deepEqual(await sendMail({ to: 'a@example.com', subject: 'Hi', text: 'x' }), { logged: true });
});

test('with BREVO_API_KEY the email goes through Brevo over HTTPS (no SMTP port needed)', async () => {
  env.BREVO_API_KEY = 'test-key';
  env.MAIL_FROM = 'saathi@example.com';
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({ messageId: '<m1>' }), { status: 201 });
  };
  assert.equal(mailConfigured(), true);
  assert.deepEqual(await sendMail({ to: 'him@example.com', subject: 'Reset', text: 'link', html: '<b>link</b>' }), { sent: true });
  assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(call.options.headers['api-key'], 'test-key');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body.sender, { name: 'Saathi', email: 'saathi@example.com' });
  assert.deepEqual(body.to, [{ email: 'him@example.com' }]);
  assert.equal(body.htmlContent, '<b>link</b>');
});

test('a refusal from Brevo (e.g. sender not verified) is an error with the reason, not a silent success', async () => {
  env.BREVO_API_KEY = 'test-key';
  env.MAIL_FROM = 'saathi@example.com';
  globalThis.fetch = async () => new Response('{"message":"Sender not valid"}', { status: 400 });
  await assert.rejects(sendMail({ to: 'him@example.com', subject: 'Reset', text: 'link' }), /400.*Sender not valid/);
});

test('Brevo without MAIL_FROM fails with a clear message, and the startup line says what to fix', async () => {
  env.BREVO_API_KEY = 'test-key';
  const savedUser = env.SMTP_USER;
  env.SMTP_USER = undefined; // the sender falls back to SMTP_USER, so clear it for this test
  after(() => {
    env.SMTP_USER = savedUser;
  });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 201 });
  };
  assert.match(mailStatus(), /MAIL_FROM is empty/);
  await assert.rejects(sendMail({ to: 'him@example.com', subject: 'Reset', text: 'link' }), /MAIL_FROM is not set/);
  assert.equal(called, false);
  env.MAIL_FROM = 'saathi@example.com';
  assert.match(mailStatus(), /Brevo API, sender saathi@example.com/);
  assert.doesNotMatch(mailStatus(), /test-key/);
});

test('without any email settings the startup line says reset links only go to the log', () => {
  assert.match(mailStatus(), /not set up/);
});

test('Resend comes first: HTTPS API with a Bearer key, Saathi <onboarding@resend.dev> by default', async () => {
  env.RESEND_API_KEY = 'test-resend-key';
  env.BREVO_API_KEY = 'test-key'; // also set: Resend still wins
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
  };
  assert.deepEqual(await sendMail({ to: 'him@example.com', subject: 'Reset', text: 'link', html: '<b>link</b>' }), { sent: true });
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.options.headers.authorization, 'Bearer test-resend-key');
  const body = JSON.parse(call.options.body);
  assert.equal(body.from, `Saathi <${RESEND_DEFAULT_FROM}>`);
  assert.deepEqual(body.to, ['him@example.com']);
  assert.equal(body.html, '<b>link</b>');
  assert.match(mailStatus(), /^email: Resend API, sender onboarding@resend\.dev, delivers only to the Resend account owner/);
  assert.doesNotMatch(mailStatus(), /test-resend-key/);
});

test('Resend: MAIL_FROM on your own domain is used; a Gmail MAIL_FROM is ignored (Resend cannot send from it)', async () => {
  env.RESEND_API_KEY = 'test-resend-key';
  const froms = [];
  globalThis.fetch = async (_url, options) => {
    froms.push(JSON.parse(options.body).from);
    return new Response('{"id":"re_2"}', { status: 200 });
  };
  env.MAIL_FROM = 'hello@saathi.app';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  env.MAIL_FROM = 'someone@gmail.com';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  assert.deepEqual(froms, ['Saathi <hello@saathi.app>', `Saathi <${RESEND_DEFAULT_FROM}>`]);
  assert.match(mailStatus(), /MAIL_FROM someone@gmail\.com ignored/);
});

test('a refusal from Resend is an error with its reason (the caller logs it), never the key', async () => {
  env.RESEND_API_KEY = 'test-resend-key';
  globalThis.fetch = async () => new Response('{"message":"You can only send testing emails to your own email address"}', { status: 403 });
  await assert.rejects(sendMail({ to: 'other@example.com', subject: 's', text: 't' }), (err) => {
    assert.match(err.message, /Resend refused the email \(403\): .*own email address/);
    assert.doesNotMatch(err.message, /test-resend-key/);
    return true;
  });
});

test('MAIL_FROM written as "Name <email>" (like on Render) gives a valid sender, not "Saathi <Saathi <...>>"', async () => {
  env.RESEND_API_KEY = 'test-resend-key';
  const froms = [];
  globalThis.fetch = async (_url, options) => {
    froms.push(JSON.parse(options.body).from);
    return new Response('{"id":"re_3"}', { status: 200 });
  };
  env.MAIL_FROM = 'Saathi <onboarding@resend.dev>';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  assert.match(mailStatus(), /^email: Resend API, sender onboarding@resend\.dev/);
  assert.doesNotMatch(mailStatus(), /ignored/);
  env.MAIL_FROM = '"Saathi Team" <hello@saathi.app>';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  env.MAIL_FROM = 'Me <someone@gmail.com>';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  assert.deepEqual(froms, ['Saathi <onboarding@resend.dev>', 'Saathi Team <hello@saathi.app>', `Me <${RESEND_DEFAULT_FROM}>`]);
});
