import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from '../security/password.js';
import { forgetCachedUser } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { emailSchema, passwordSchema } from './auth.service.js';
import { sendMail } from './mail.service.js';
import * as quota from './quota.service.js';

// "Password bhool gaye?"
//
//  1. The user gives an email. If it belongs to an account, a link with a random token is emailed.
//     Only the token's SHA-256 hash is stored. The answer is ALWAYS the same message, and all the
//     account-specific work happens after answering, so nobody can learn which emails have
//     accounts (not from the text, not from the timing).
//  2. The link works for 30 minutes and only once: using it is a single atomic update.
//  3. The new password follows the signup rules. Every existing session is logged out
//     (sessionVersion goes up, see middleware/auth.js), and older links stop working.

const log = logger.child({ component: 'password-reset' });

export const LINK_TTL_MS = 30 * 60 * 1000;
export const SAME_ANSWER = 'Agar ye email registered hai, toh link bhej diya gaya hai. Inbox (aur spam folder) check karo.';
const IP_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 }; // requests per IP
const EMAIL_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 }; // emails sent per address
const RESET_IP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 }; // reset attempts per IP

export const forgotSchema = z.object({ email: emailSchema });
export const tokenSchema = z.object({ token: z.string().trim().min(20, 'This link is incomplete.').max(200) });
export const resetSchema = tokenSchema.extend({ password: passwordSchema });

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const appUrl = () => (env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/$/, '');

async function limitIp(key, window, message) {
  await quota.enforce([{ key, ...window }], message);
}

/** Step 1. Always resolves with the same answer (or a 429 for one IP asking too often). */
export async function requestReset({ email }, { ip = 'unknown' } = {}) {
  await limitIp(`pwreset-ip:${ip}`, IP_LIMIT, 'Bahut baar try ho gaya. 15 minute baad phir se link maango.');
  // Not awaited: the answer must take the same time whether or not the account exists.
  deliverLink(email).catch((err) => log.error({ err: err.message }, 'could not send the reset link'));
  return { message: SAME_ANSWER };
}

async function deliverLink(email, now = new Date()) {
  const user = await User.findOne({ email }).lean();
  if (!user) return;
  // At most a few emails per address per hour, so the form cannot be used to flood someone's inbox.
  const sent = await quota.hit(`pwreset-email:${email}`, EMAIL_LIMIT);
  if (!sent.allowed) return log.warn({ userId: String(user._id) }, 'reset link limit reached for this address');

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  // Only the newest link works.
  await PasswordReset.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } });
  await PasswordReset.create({ userId: user._id, tokenHash: sha256(token), expiresAt, removeAt: new Date(expiresAt.getTime() + 24 * 60 * 60 * 1000) });

  // The token is in the #fragment: browsers never send it to a server or put it in a Referer header.
  const link = `${appUrl()}/#reset=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Saathi: naya password set karo',
    text: [
      `Namaste ${user.name},`,
      '',
      'Saathi account ka naya password set karne ke liye yeh link kholo. Yeh 30 minute tak aur sirf ek baar chalega:',
      link,
      '',
      'Agar tumne yeh nahi maanga tha, toh is email ko ignore karo. Tumhara password nahi badlega.',
      '',
      'Saathi',
    ].join('\n'),
    html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6;color:#1b2240;max-width:520px">
      <p>Namaste ${escapeHtml(user.name)},</p>
      <p>Saathi account ka naya password set karne ke liye neeche wala button dabao. Yeh link 30 minute tak aur sirf ek baar chalega.</p>
      <p><a href="${link}" style="display:inline-block;background:#f2a541;color:#0b0d14;padding:12px 22px;border-radius:999px;font-weight:600;text-decoration:none">Naya password set karo</a></p>
      <p style="color:#6b6f80;font-size:14px">Agar tumne yeh nahi maanga tha, toh is email ko ignore karo. Tumhara password nahi badlega.</p>
    </div>`,
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BAD_LINK = 'Yeh link ab kaam nahi karta: ya toh 30 minute se purana hai, ya pehle use ho chuka hai. Login page se naya link maango.';

/** For the reset page: is this link still usable? (Shows a clear message before the form.) */
export async function checkToken({ token }) {
  const found = await PasswordReset.exists({ tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } });
  return { valid: Boolean(found) };
}

/** Step 3. Uses the link (once), sets the new password and logs out every session. */
export async function resetPassword({ token, password }, { ip = 'unknown' } = {}) {
  await limitIp(`pwreset-try:${ip}`, RESET_IP_LIMIT, 'Bahut baar try ho gaya. 15 minute baad phir try karo.');
  const now = new Date();
  // Claim the link in one atomic update, so two clicks (or two tabs) cannot both use it.
  const claimed = await PasswordReset.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw new AppError(400, 'RESET_LINK_INVALID', BAD_LINK);

  const passwordHash = await hashPassword(password);
  const user = await User.findOneAndUpdate(
    { _id: claimed.userId },
    { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!user) throw new AppError(400, 'RESET_LINK_INVALID', BAD_LINK);

  // Any other link for this account is now useless too.
  await PasswordReset.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } });
  // The account may have been locked by failed logins; a reset unlocks it.
  await quota.reset(`login-fail:${user.email}`, { windowMs: 15 * 60 * 1000 }).catch(() => {});
  forgetCachedUser(user._id);
  log.info({ userId: String(user._id) }, 'password reset, all sessions logged out');
  return { message: 'Password badal gaya. Ab naye password se login karo.' };
}
