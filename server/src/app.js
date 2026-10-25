import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { lifecycle } from './lib/lifecycle.js';
import { healthRouter } from './routes/health.routes.js';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { notesRouter } from './routes/notes.routes.js';
import { remindersRouter } from './routes/reminders.routes.js';
import { meRouter } from './routes/me.routes.js';
import { agentRouter } from './routes/agent.routes.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { createOverloadGuard } from './middleware/overload.js';

// The built frontend (client/dist). In production one server sends both the app and the API from
// the same address, so the login cookie and requests just work (no CORS, no third-party cookies).
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApp({
  overloadGuard = createOverloadGuard({ maxLagMs: env.OVERLOAD_MAX_LAG_MS }),
  clientDist = env.NODE_ENV === 'test' ? null : CLIENT_DIST,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Behind a load balancer (Render, Cloud Run...), so rate limiting and logs see the real client IP.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  // While shutting down, ask keep-alive clients to reconnect, so the load balancer
  // sends their next request to a healthy instance instead of this one.
  app.use((_req, res, next) => {
    if (lifecycle.shuttingDown) res.set('Connection', 'close');
    next();
  });

  // Health checks go first: no logging noise, no overload shedding, no body parsing.
  app.use('/api/health', healthRouter);

  // One log line per request with a request id. If the load balancer already sent an id,
  // reuse it so a request can be followed across services; it is also returned to the client.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(overloadGuard.middleware);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // General ceiling per IP, so one misbehaving client or script cannot hog an instance.
  // Generous enough that normal use (including typing hints) never comes close.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => env.NODE_ENV === 'test',
      handler: (_req, res) =>
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down for a minute.' } }),
    }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/me', meRouter);
  app.use('/api/agent', agentRouter);

  app.use('/api', notFound);

  if (clientDist && fs.existsSync(`${clientDist}index.html`)) {
    // Files with a content hash in the name (assets/app-3f9c.js) never change: cache them for a year.
    // index.html is always checked again, so a new deploy shows up on the next page load.
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, file) => {
          if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(`${clientDist}index.html`);
    });
  }

  app.use(errorHandler);

  return app;
}
