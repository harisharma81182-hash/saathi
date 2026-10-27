import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Sends email in one of two ways:
//  - Brevo's HTTP API when BREVO_API_KEY is set. Render's free plan blocks the SMTP ports, but an
//    HTTPS request (port 443) goes through, so this is the way on the live app.
//  - SMTP from .env otherwise (Gmail with an App Password works on a laptop or a paid server).
// With neither (local development) nothing is sent: the message is written to the server log, so
// the reset link can still be opened by hand.

const log = logger.child({ component: 'mail' });
let transport = null;
let testOutbox = null;

export const mailConfigured = () => Boolean(env.BREVO_API_KEY || env.SMTP_HOST);

function getTransport() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // Fail fast instead of keeping a request (or a job) waiting on a dead mail server.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

async function sendWithBrevo({ from, to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Saathi', email: from },
      to: [{ email: to }],
      subject,
      textContent: text,
      ...(html ? { htmlContent: html } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Brevo explains the problem in the body (e.g. "sender not verified"); never log the key.
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo refused the email (${res.status}): ${detail.slice(0, 300)}`);
  }
  const { messageId } = await res.json().catch(() => ({}));
  return messageId;
}

/** Sends one email. Throws if the mail service refuses it (callers decide what to do). */
export async function sendMail({ to, subject, text, html }) {
  if (testOutbox) {
    testOutbox.push({ to, subject, text, html });
    return { test: true };
  }
  if (!mailConfigured()) {
    // Development: show the message in the log instead. Never do this with email configured.
    log.warn({ to, subject }, `Email is not set up, so this email was not sent. Its text:\n${text}`);
    return { logged: true };
  }
  const from = env.MAIL_FROM ?? env.SMTP_USER;
  if (env.BREVO_API_KEY) {
    const messageId = await sendWithBrevo({ from, to, subject, text, html });
    log.info({ to, messageId, via: 'brevo' }, 'email sent');
    return { sent: true };
  }
  const info = await getTransport().sendMail({ from: `Saathi <${from}>`, to, subject, text, html });
  log.info({ to, messageId: info.messageId, via: 'smtp' }, 'email sent');
  return { sent: true };
}

/** Tests: collect emails in an array instead of sending them. Pass null to stop. */
export function setOutboxForTests(outbox) {
  testOutbox = outbox;
}
