import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { actionsFor, inQuietHours, styleOf } from '../utils/notifyStyle.js';
import { sendToUser } from './push.service.js';
import { sendMail } from './mail.service.js';
import { isOnline } from './live.service.js';

// Getting a notification to the user, wherever they are. Every notification is saved first (so the
// app shows it live through /api/me/events when it is open); then this job, run by the worker:
//
//   1. quiet hours (11 PM to 7 AM in their time): only reminders go out; the rest wait in the app
//   2. push to every device that allowed notifications (phones and computers, tab open or closed)
//   3. email, only for the important kinds (reminder, task due, the morning plan), and only if push
//      reached no device and Saathi is not open in a tab right now: so a reminder is never missed
//      even when notifications are blocked, and nobody gets the same thing twice
//
// It runs at most once per notification (the result is stored in notification.delivery).

const log = logger.child({ component: 'delivery' });
export const MAX_EMAILS_PER_DAY = 10;

const appUrl = () => (env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/$/, '');
const titleOf = (n) => `${styleOf(n).emoji} ${n.title}`;

/** What the service worker shows (client/public/sw.js). */
export function pushPayload(n) {
  const style = styleOf(n);
  return {
    notificationId: String(n._id),
    kind: n.kind,
    title: titleOf(n),
    body: n.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    image: `/bg/${style.photo}-desktop.webp`,
    // Same kind replaces the older one on the device (grouping), except reminders: each one counts.
    tag: n.kind === 'reminder' ? `reminder:${n.refId ?? n._id}` : `saathi:${n.kind}`,
    url: style.path,
    actions: actionsFor(n),
    requireInteraction: n.kind === 'reminder',
  };
}

export async function deliver(notificationId, { now = new Date() } = {}) {
  const n = await Notification.findById(notificationId).lean();
  if (!n) return { skipped: 'gone' };
  if (n.delivery) return { skipped: 'already delivered' };
  const user = await User.findById(n.userId).lean();
  if (!user) return { skipped: 'no user' };

  const style = styleOf(n);
  const localHour = DateTime.fromJSDate(now, { zone: user.timezone }).hour;
  const quiet = inQuietHours(localHour) && !style.quietHoursOk;
  const delivery = { at: now, quiet, push: 0, email: false };

  if (!quiet) {
    const result = await sendToUser(user._id, pushPayload(n), {
      ttlSeconds: n.kind === 'reminder' ? 6 * 3600 : 3600,
      urgency: n.kind === 'reminder' ? 'high' : 'normal',
    });
    delivery.push = result.sent;
    if (result.removed) delivery.removedDevices = result.removed;

    if (style.email && result.sent === 0 && !isOnline(user, now)) {
      delivery.email = await emailCopy(user, n, now);
    }
  }

  await Notification.updateOne({ _id: n._id, delivery: null }, { $set: { delivery } });
  return delivery;
}

/** The email copy of an important notification. Returns true if sent; never throws. */
async function emailCopy(user, n, now) {
  if (!user.email) return false;
  const startOfDay = DateTime.fromJSDate(now, { zone: user.timezone }).startOf('day').toJSDate();
  const sentToday = await Notification.countDocuments({ userId: user._id, 'delivery.email': true, createdAt: { $gte: startOfDay } });
  if (sentToday >= MAX_EMAILS_PER_DAY) return false;
  try {
    await sendMail({ to: user.email, subject: titleOf(n), ...notificationEmail(user, n) });
    return true;
  } catch (err) {
    log.warn({ userId: String(user._id), err: err.message }, 'notification email not sent');
    return false;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A dark, space-themed email that reads well on phones (tables and inline styles: email clients). */
export function notificationEmail(user, n) {
  const style = styleOf(n);
  const link = `${appUrl()}${style.path}`;
  const text = `${titleOf(n)}\n\n${n.body ? `${n.body}\n\n` : ''}Saathi kholo: ${link}\n\nYeh email isliye aaya kyunki is waqt notification tumhare kisi device par nahi pahunch saka. Browser mein Saathi ke notifications allow kar do, phir email ki zaroorat nahi padegi.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(n.title)}</title></head>
<body style="margin:0;padding:0;background:#070914;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070914;background-image:radial-gradient(circle at 20% 0%,#1a1f45 0%,#070914 60%);">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td style="padding:0 4px 20px;">
      <img src="${appUrl()}/icons/icon-192.png" width="40" height="40" alt="Saathi" style="vertical-align:middle;border-radius:12px;">
      <span style="font:600 18px/40px 'Segoe UI',Arial,sans-serif;color:#F5EFE6;vertical-align:middle;padding-left:10px;">Saathi</span>
    </td></tr>
    <tr><td style="background:#121630;border:1px solid #2A3060;border-radius:20px;padding:28px 24px;">
      <p style="margin:0 0 8px;font:32px/1 'Segoe UI Emoji','Apple Color Emoji',sans-serif;">${style.emoji}</p>
      <h1 style="margin:0 0 12px;font:700 22px/1.3 'Segoe UI',Arial,sans-serif;color:#F5EFE6;">${escapeHtml(n.title)}</h1>
      ${n.body ? `<p style="margin:0 0 24px;font:16px/1.55 'Segoe UI',Arial,sans-serif;color:#C9C3D9;">${escapeHtml(n.body)}</p>` : ''}
      <a href="${link}" style="display:inline-block;background:#F2A541;color:#1B1405;font:700 16px/1 'Segoe UI',Arial,sans-serif;text-decoration:none;padding:14px 26px;border-radius:999px;">Saathi kholo</a>
    </td></tr>
    <tr><td style="padding:18px 6px 0;font:12px/1.5 'Segoe UI',Arial,sans-serif;color:#7D7894;">
      Yeh email isliye aaya kyunki is waqt notification tumhare kisi device par nahi pahunch saka. Browser mein Saathi ke notifications allow kar do, phir email ki zaroorat nahi padegi.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  return { text, html };
}

