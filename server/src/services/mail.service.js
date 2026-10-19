import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Sends email through the SMTP server in .env (Gmail with an App Password works). Without SMTP
// settings (local development) nothing is sent: the message is written to the server log, so the
// reset link can still be opened by hand.

const log = logger.child({ component: 'mail' });
let transport = null;
let testOutbox = null;

export const mailConfigured = () => Boolean(env.SMTP_HOST);

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

/** Sends one email. Throws if the SMTP server refuses it (callers decide what to do). */
export async function sendMail({ to, subject, text, html }) {
  if (testOutbox) {
    testOutbox.push({ to, subject, text, html });
    return { test: true };
  }
  if (!mailConfigured()) {
    // Development: show the message in the log instead. Never do this with SMTP configured.
    log.warn({ to, subject }, `SMTP is not set up, so this email was not sent. Its text:\n${text}`);
    return { logged: true };
  }
  const from = env.MAIL_FROM ?? env.SMTP_USER;
  const info = await getTransport().sendMail({ from: `Saathi <${from}>`, to, subject, text, html });
  log.info({ to, messageId: info.messageId }, 'email sent');
  return { sent: true };
}

/** Tests: collect emails in an array instead of sending them. Pass null to stop. */
export function setOutboxForTests(outbox) {
  testOutbox = outbox;
}
