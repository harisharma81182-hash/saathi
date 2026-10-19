import { z } from 'zod';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { isValidTimezone } from '../utils/timezone.js';
import { hashPassword, verifyPassword, needsRehash, burnPasswordCheck } from '../security/password.js';
import { forgetCachedUser } from '../middleware/auth.js';
import * as quota from './quota.service.js';
import { logger } from '../lib/logger.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

export const emailSchema = email;

// The same password rules for signup and for a password reset.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password can be at most 72 characters.')
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number.');

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(60, 'Name can be at most 60 characters.'),
  email,
  password: passwordSchema,
  timezone: z
    .string()
    .optional()
    .refine((tz) => tz === undefined || isValidTimezone(tz), 'Unknown timezone.'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(72),
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    timezone: z.string().refine(isValidTimezone, 'Unknown timezone.').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

// Per-account limit on failed logins, stored in MongoDB so it holds across all instances.
// (The per-IP limit in auth.routes.js is per instance; this one is the real guard against
// someone guessing one account's password from many machines.)
const FAILED_LOGIN_LIMIT = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function signup({ name, email, password, timezone }) {
  const existing = await User.exists({ email });
  if (existing) throw AppError.conflict('An account with this email already exists. Log in instead.');

  const passwordHash = await hashPassword(password);
  try {
    return await User.create({ name, email, passwordHash, ...(timezone && { timezone }) });
  } catch (err) {
    // Two signups with the same email at the same moment: the unique index catches the second one.
    if (err?.code === 11000) throw AppError.conflict('An account with this email already exists. Log in instead.');
    throw err;
  }
}

export async function login({ email, password }) {
  // Count the attempt BEFORE checking the password. If we only counted after a failure,
  // many parallel guesses could all pass the check before any of them was counted.
  const lockKey = `login-fail:${email}`;
  const window = { limit: FAILED_LOGIN_LIMIT, windowMs: FAILED_LOGIN_WINDOW_MS };
  const attempt = await quota.hit(lockKey, window);
  if (!attempt.allowed) {
    const err = new AppError(429, 'RATE_LIMITED', 'Too many failed attempts for this account. Try again in 15 minutes.');
    err.retryAfterSeconds = Math.ceil((attempt.resetAt.getTime() - Date.now()) / 1000);
    throw err;
  }

  const user = await User.findOne({ email }).select('+passwordHash');
  // Same work and same message for "no such email" and "wrong password", so accounts cannot be discovered.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await burnPasswordCheck(password);
  if (!user || !ok) throw AppError.unauthorized('Email or password is incorrect.');

  // A successful login does not use up one of the allowed failures.
  await quota.undo(lockKey, window).catch(() => {});

  // Upgrade hashes made with older parameters the next time the user logs in.
  if (needsRehash(user.passwordHash)) {
    hashPassword(password)
      .then((passwordHash) => User.updateOne({ _id: user._id }, { $set: { passwordHash } }))
      .catch((err) => logger.warn({ err }, 'password rehash failed'));
  }

  return user;
}

export async function updateProfile(userId, changes) {
  const { matchedCount } = await User.updateOne({ _id: userId }, { $set: changes }, { runValidators: true });
  if (!matchedCount) throw AppError.notFound('Account not found.');
  const user = await User.findById(userId).select('name email timezone createdAt').lean();
  forgetCachedUser(userId);
  return user;
}
