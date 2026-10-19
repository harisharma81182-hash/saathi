import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { TtlCache } from '../utils/ttlCache.js';

export const COOKIE_NAME = 'saathi_token';

/** A login token for this user; it is only valid while the user's sessionVersion stays the same. */
export function signToken(user) {
  return jwt.sign({ sub: String(user._id ?? user.id), sv: user.sessionVersion ?? 0 }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

// The token lives in an httpOnly cookie, so JavaScript in the page (and any injected script)
// cannot read it. sameSite=lax blocks it from being sent on cross-site form posts.
export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });
}

function readToken(req) {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  // Also accept "Authorization: Bearer <token>" so the API can be tested from Postman.
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Every authenticated request used to read the user from MongoDB. That is one database operation
// per request just to say "yes, this user exists" (and Atlas' free tier allows only 100 ops/sec).
// A short per-instance cache removes most of those reads. Trade-off: a renamed or deleted account
// can look unchanged on another instance for up to 30 seconds. The instance that made the change
// clears its own entry immediately.
const userCache = new TtlCache({ ttlMs: 30_000, maxEntries: 20_000 });

export function forgetCachedUser(userId) {
  userCache.delete(String(userId));
}

async function loadUser(id) {
  const cached = userCache.get(id);
  if (cached) return cached;
  const user = await User.findById(id).select('name email timezone createdAt sessionVersion').lean();
  if (user) userCache.set(id, user);
  return user;
}

// Rejects the request unless it carries a valid token for a user that still exists.
// On success, req.user is the logged-in user (a plain object) and req.userId its id.
export async function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(AppError.unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return next(AppError.unauthorized('Your session has expired. Log in again.'));
  }

  const user = await loadUser(String(payload.sub));
  if (!user) return next(AppError.unauthorized('This account no longer exists.'));
  // The password was reset after this token was issued: this session has been logged out.
  if ((payload.sv ?? 0) !== (user.sessionVersion ?? 0)) return next(AppError.unauthorized('Password badal gaya hai. Naye password se login karo.'));

  req.user = user;
  req.userId = String(user._id);
  next();
}
