import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { isValidTimezone } from '../utils/timezone.js';
import { logger } from '../lib/logger.js';

// "Continue with Google". The browser gets an ID token (a JWT signed by Google) from Google's own
// button and sends it here. We check Google's signature, that the token was made for OUR client id
// and has not expired, and that Google has verified the email. Then:
//   1. a Saathi account already linked to this Google account -> log in
//   2. an account with the same email (made with a password)   -> link Google to it, log in
//   3. nobody yet                                              -> create the account, log in
// Google's password never reaches Saathi; we only see the signed token.

const log = logger.child({ component: 'google' });
let client = null;

async function realVerify(credential) {
  client ??= new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}
// Tests replace the verifier: (credential) => payload, or throw for a bad token.
let verify = realVerify;
export function setGoogleVerifierForTests(fn) {
  verify = fn ?? realVerify;
}

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID);

export const googleSchema = z.object({
  credential: z.string().min(20, 'Google sign-in failed. Try again.').max(5000),
  // The random value the browser sent to Google; Google signs it into the token (blocks replays).
  nonce: z.string().min(16).max(200).optional(),
  timezone: z
    .string()
    .optional()
    .refine((tz) => tz === undefined || isValidTimezone(tz), 'Unknown timezone.'),
});

const LINKED_ELSEWHERE = 'This email is already linked to a different Google account. Log in with your email and password.';

/** Returns { user, created } for a valid Google ID token. */
export async function signInWithGoogle({ credential, nonce, timezone }) {
  if (!googleConfigured()) throw new AppError(404, 'GOOGLE_DISABLED', 'Google sign-in is not set up on this server. Use email and password.');

  let p;
  try {
    p = await verify(credential);
  } catch (err) {
    log.warn({ err: err.message }, 'google token rejected');
    throw AppError.unauthorized('Google sign-in failed. Try again.');
  }
  if (!p?.sub || !p.email) throw AppError.unauthorized('Google sign-in failed. Try again.');
  // A token from our own sign-in trip must carry the nonce this browser sent (a copied token cannot).
  if (nonce !== undefined && p.nonce !== nonce) throw AppError.unauthorized('Google sign-in failed. Try again.');
  // Only an email that Google itself has verified may open (or join) a Saathi account.
  if (p.email_verified !== true) throw AppError.unauthorized('This Google account has no verified email. Use email and password instead.');

  const googleId = String(p.sub);
  const email = p.email.trim().toLowerCase();

  const linked = await User.findOne({ googleId });
  if (linked) return { user: linked, created: false };

  // Same email, never linked to Google: join them (one atomic update, so two tabs can't link twice).
  const joined = await User.findOneAndUpdate({ email, googleId: { $exists: false } }, { $set: { googleId } }, { returnDocument: 'after' });
  if (joined) {
    log.info({ userId: String(joined._id) }, 'google linked to existing account');
    return { user: joined, created: false };
  }
  if (await User.exists({ email })) throw AppError.conflict(LINKED_ELSEWHERE);

  const name = (p.name || p.given_name || email.split('@')[0]).trim().slice(0, 60) || 'Dost';
  try {
    const user = await User.create({ name, email, googleId, ...(timezone && { timezone }) });
    return { user, created: true };
  } catch (err) {
    // The same person signing in from two tabs at once: the unique index stops the second create.
    if (err?.code === 11000) {
      const user = await User.findOne({ googleId });
      if (user) return { user, created: false };
      throw AppError.conflict(LINKED_ELSEWHERE);
    }
    throw err;
  }
}
