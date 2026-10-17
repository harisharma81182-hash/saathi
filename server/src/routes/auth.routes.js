import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { requireAuth, signToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { publicUser } from '../models/User.js';
import * as auth from '../services/auth.service.js';

export const authRouter = Router();

// First line of defence against password guessing: 20 login/signup attempts per IP per 15 minutes.
// This counter is kept in memory on each instance (cheap, no database work for blocked requests).
// The per-account limit in auth.service.js is shared across instances through MongoDB.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
    }),
});

authRouter.post('/signup', authLimiter, validate({ body: auth.signupSchema }), async (req, res) => {
  const user = await auth.signup(req.valid.body);
  setAuthCookie(res, signToken(user.id));
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', authLimiter, validate({ body: auth.loginSchema }), async (req, res) => {
  const user = await auth.login(req.valid.body);
  setAuthCookie(res, signToken(user.id));
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.patch('/me', requireAuth, validate({ body: auth.updateProfileSchema }), async (req, res) => {
  const user = await auth.updateProfile(req.userId, req.valid.body);
  res.json({ user: publicUser(user) });
});
