import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { objectId } from '../utils/schemas.js';
import * as push from '../services/push.service.js';
import * as alerts from '../services/alerts.service.js';

// Notifications on the user's devices (Web Push). The app asks the browser for permission on the
// user's first tap, then registers the device here. The service worker calls /action when a
// button on a notification is pressed ("Ho gaya", "10 min baad").
export const pushRouter = Router();
pushRouter.use(requireAuth);

/** The public half of the VAPID key pair (null if push is not set up on this server). */
pushRouter.get('/key', (_req, res) => {
  res.json({ publicKey: push.pushConfigured() ? env.VAPID_PUBLIC_KEY : null });
});

pushRouter.post('/subscribe', validate({ body: push.subscribeSchema }), async (req, res) => {
  await push.subscribe(req.userId, req.valid.body);
  res.status(201).json({ ok: true });
});

pushRouter.post('/unsubscribe', validate({ body: z.object({ endpoint: z.string().url().max(1000) }) }), async (req, res) => {
  res.json({ removed: await push.unsubscribe(req.userId, req.valid.body.endpoint) });
});

const actionSchema = z.object({ notificationId: objectId, action: z.enum(['done', 'snooze', 'open']) });
pushRouter.post('/action', validate({ body: actionSchema }), async (req, res) => {
  res.json(await alerts.runAction(req.user, req.valid.body.notificationId, req.valid.body.action));
});
