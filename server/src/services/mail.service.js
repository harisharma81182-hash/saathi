import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Sends email the first way that is set up, in this order:
//  1. Resend's HTTPS API (RESEND_API_KEY). Render's free plan blocks the SMTP ports, but an HTTPS
//     request (port 443) goes through. Without a verified domain the sender is onboarding@resend.dev
//     and Resend delivers only to the email of the Resend account's owner.
//  2. Brevo's HTTPS API (BREVO_API_KEY).
//  3. SMTP from .env (Gmail with an App Password works on a laptop or a paid server).
//  4. Nothing set (local development): the message is written to the server log, so the reset
//     link can still be opened by hand.
// A failure throws; the callers (reset link, notification email) log it and carry on, and the user
// still gets the same friendly answer.

const log = logger.child({ component: 'mail' });
let transport = null;
let testOutbox = null;

export const RESEND_DEFAULT_FROM = 'onboarding@resend.dev';
// Resend can only send from a domain verified in Resend, never from a public mailbox like Gmail.
const PUBLIC_MAILBOX = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|rediffmail|proton(mail)?)\.[a-z.]+$/i;

/** MAIL_FROM may be "you@x.com" or "Name <you@x.com>"; returns { name, email }. */
export function parseSender(raw) {
  const text = String(raw ?? '').trim();
  const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(text);
  if (m) return { name: m[1].replace(/^"(.*)"$/, '$1').trim() || 'Saathi', email: m[2] };
  return { name: 'Saathi', email: text };
}
const fromHeader = ({ name, email }) => `${name} <${email}>`;

/** The sender address for Resend: MAIL_FROM if it is on your own (verified) domain, else Resend's test sender. */
export function resendSender() {
  const email = env.MAIL_FROM ? parseSender(env.MAIL_FROM).email : '';
  return email && !PUBLIC_MAILBOX.test(email) ? email : RESEND_DEFAULT_FROM;
}

export const mailConfigured = () => Boolean(env.RESEND_API_KEY || env.BREVO_API_KEY || env.SMTP_HOST);

/** How email goes out, in one line for the startup log (never shows a key). */
export function mailStatus() {
  if (env.RESEND_API_KEY) {
    const ignored = env.MAIL_FROM && resendSender() !== parseSender(env.MAIL_FROM).email;
    return `email: Resend API, sender ${resendSender()}${ignored ? ` (MAIL_FROM ${env.MAIL_FROM} ignored: Resend cannot send from a public mailbox; verify your own domain in Resend to change the sender)` : ''}${resendSender() === RESEND_DEFAULT_FROM ? ', delivers only to the Resend account owner until a domain is verified' : ''}`;
  }
  if (env.BREVO_API_KEY) {
    const sender = env.MAIL_FROM ?? env.SMTP_USER;
    return sender
      ? `email: Brevo API, sender ${sender}`
      : 'email: Brevo API is set but MAIL_FROM is empty. Set MAIL_FROM to the sender you verified in Brevo, or no email will be sent';
  }
  if (env.SMTP_HOST) return `email: SMTP ${env.SMTP_HOST}:${env.SMTP_PORT} (on Render's free plan SMTP is blocked: set BREVO_API_KEY instead)`;
  return 'email: not set up (no RESEND_API_KEY, BREVO_API_KEY or SMTP_HOST), so reset links are only written to this log';
}

// Network errors that mean "could not reach the mail server at all" (Render's free plan blocks SMTP ports).
const UNREACHABLE = new Set(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);

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

async function sendWithResend({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: fromHeader({ name: env.MAIL_FROM ? parseSender(env.MAIL_FROM).name : 'Saathi', email: resendSender() }), to: [to], subject, text, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Resend explains the problem in the body (e.g. "you can only send testing emails to your own
    // email address"); the key is never part of the message.
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 300)}`);
  }
  const { id } = await res.json().catch(() => ({}));
  return id;
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
  if (env.RESEND_API_KEY) {
    const messageId = await sendWithResend({ to, subject, text, html });
    log.info({ to, messageId, via: 'resend' }, 'email sent');
    return { sent: true };
  }
  const sender = parseSender(env.MAIL_FROM ?? env.SMTP_USER);
  const from = sender.email;
  if (env.BREVO_API_KEY) {
    if (!from) throw new Error('MAIL_FROM is not set: Brevo needs the sender email you verified in Brevo.');
    const messageId = await sendWithBrevo({ from, to, subject, text, html });
    log.info({ to, messageId, via: 'brevo' }, 'email sent');
    return { sent: true };
  }
  let info;
  try {
    info = await getTransport().sendMail({ from: fromHeader(sender), to, subject, text, html });
  } catch (err) {
    if (UNREACHABLE.has(err.code)) {
      throw new Error(`SMTP server not reachable (${err.code}). Render's free plan blocks SMTP ports: set BREVO_API_KEY and MAIL_FROM instead.`);
    }
    throw err;
  }
  log.info({ to, messageId: info.messageId, via: 'smtp' }, 'email sent');
  return { sent: true };
}

/** Tests: collect emails in an array instead of sending them. Pass null to stop. */
export function setOutboxForTests(outbox) {
  testOutbox = outbox;
}
