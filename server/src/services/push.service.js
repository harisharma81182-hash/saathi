import { z } from 'zod';
import webpush from 'web-push';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { PushSubscription } from '../models/PushSubscription.js';

// Web Push: the browser (or installed app on a phone) gives us a subscription (an endpoint at its
// push service plus two keys); we send encrypted messages to it with our VAPID key pair, and the
// service worker (client/public/sw.js) shows them, even when Saathi's tab is closed.

const log = logger.child({ component: 'push' });

export const pushConfigured = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let configured = false;
function ensureVapid() {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

function realSender(subscription, payload, options) {
  ensureVapid();
  return webpush.sendNotification(subscription, payload, options);
}
// Tests replace the real sender: (subscription, payload, options) => Promise.
let sender = realSender;
export function setPushSenderForTests(fn) {
  sender = fn ?? realSender;
}

export const subscribeSchema = z.object({
  endpoint: z.string().url('That is not a valid push endpoint.').max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  device: z.string().trim().max(120).optional(),
});

/** Saves this device for the user. The same device again just refreshes it (one row per endpoint). */
export async function subscribe(userId, { endpoint, keys, device = '' }) {
  return PushSubscription.findOneAndUpdate(
    { endpoint },
    { $set: { userId, keys, device, failures: 0 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

/** Forgets one of the user's devices (only their own). */
export async function unsubscribe(userId, endpoint) {
  const res = await PushSubscription.deleteOne({ userId, endpoint });
  return res.deletedCount;
}

const GONE = new Set([404, 410]);

/**
 * Sends one payload to every device of the user. Devices the push service says are gone are
 * deleted. Returns how many devices accepted it and how many were removed.
 */
export async function sendToUser(userId, payload, { ttlSeconds = 3600, urgency = 'normal', topic } = {}) {
  if (!pushConfigured()) return { sent: 0, removed: 0, devices: 0, skipped: 'not configured' };
  const subs = await PushSubscription.find({ userId }).lean();
  let sent = 0;
  let removed = 0;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: ttlSeconds, urgency, ...(topic && { topic }) });
        sent++;
        await PushSubscription.updateOne({ _id: s._id }, { $set: { lastSuccessAt: new Date(), failures: 0 } });
      } catch (err) {
        if (GONE.has(err.statusCode)) {
          removed++;
          await PushSubscription.deleteOne({ _id: s._id });
        } else {
          log.warn({ userId: String(userId), status: err.statusCode, err: err.message }, 'push failed');
          // A device that keeps failing for other reasons is dropped after a while too.
          const updated = await PushSubscription.findOneAndUpdate({ _id: s._id }, { $inc: { failures: 1 } }, { returnDocument: 'after' }).lean();
          if (updated?.failures >= 10) {
            removed++;
            await PushSubscription.deleteOne({ _id: s._id });
          }
        }
      }
    }),
  );
  return { sent, removed, devices: subs.length };
}
