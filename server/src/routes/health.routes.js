import { Router } from 'express';
import { pingDb } from '../db/connect.js';
import { lifecycle } from '../lib/lifecycle.js';

export const healthRouter = Router();

// Liveness: "is the process alive and the event loop responding?"
// Touches nothing external, so a database outage does not make the platform restart every instance
// (restarting would not fix the database and would only add a reconnect storm).
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: "should the load balancer send traffic here?"
// Not ready while shutting down (so traffic drains away first) or when the database is unreachable.
async function ready(_req, res) {
  if (lifecycle.shuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  const dbUp = await pingDb();
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', database: dbUp ? 'up' : 'down' });
}

healthRouter.get('/ready', ready);
healthRouter.get('/', ready); // kept for backwards compatibility: /api/health
