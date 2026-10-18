import { Notification, publicNotification } from '../models/Notification.js';
import { Activity, publicActivity } from '../models/Activity.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../utils/AppError.js';
import { TtlCache } from '../utils/ttlCache.js';
import { notificationEvents } from './notification.service.js';
import { activityEvents, UNDO_WINDOW_MS } from './activity.service.js';

// Live updates: the browser keeps one Server-Sent Events connection open (/api/me/events) and the
// server pushes what happened, so the Today panel and the notification bell update by themselves.
//
//   notification  { notification }   a reminder fired, Saathi sent a nudge or a recap
//   changed       { activity }       a task, note or reminder changed (by you, Saathi, or Undo)
//
// With several instances, a reminder may fire on instance B while the user's tab is connected to
// instance A. So each instance polls MongoDB every POLL_MS for new notifications and changes of the
// users connected to IT (one query per collection, for all of them at once). Things that happen on
// the same instance are pushed at once through the in-process event buses. A short "already sent"
// cache stops the same item from being pushed twice by both paths. No Redis needed at this size.

const log = logger.child({ component: 'live' });

export const POLL_MS = 2000;
// Writes become visible a little after their createdAt (it is set before the insert), so each poll
// looks back a bit further than the previous one; the sent-cache removes the duplicates.
const OVERLAP_MS = 10_000;
export const MAX_CONNECTIONS_PER_USER = 5;

export function createLiveHub({ pollMs = POLL_MS, maxPerUser = MAX_CONNECTIONS_PER_USER, maxTotal = 5000 } = {}) {
  const connections = new Map(); // userId -> Set of { send, close }
  const sent = new TtlCache({ ttlMs: 2 * OVERLAP_MS + 60_000, maxEntries: 50_000 });
  let total = 0;
  let cursor = new Date();
  let timer = null;
  let polling = false;

  function deliver(userId, event, key, data) {
    const subs = connections.get(String(userId));
    if (!subs) return;
    const id = `${String(userId)}:${key}`;
    if (sent.get(id)) return;
    sent.set(id, true);
    for (const c of subs) c.send(event, data);
  }

  const onNotification = (n) => deliver(n.userId, 'notification', `n:${n._id}`, { notification: publicNotification(n) });
  const changeKey = (a) => `a:${a._id}:${a.undoneAt ? 'undo' : 'do'}`;
  const onActivity = (a) => deliver(a.userId, 'changed', changeKey(a), { activity: publicActivity(a, { undoWindowMs: UNDO_WINDOW_MS }) });

  async function poll() {
    if (polling || connections.size === 0) return;
    polling = true;
    const userIds = [...connections.keys()];
    const from = new Date(cursor.getTime() - OVERLAP_MS);
    const now = new Date();
    try {
      const [notifications, activities] = await Promise.all([
        Notification.find({ userId: { $in: userIds }, createdAt: { $gt: from } }).sort({ createdAt: 1 }).limit(500).lean(),
        Activity.find({ userId: { $in: userIds }, $or: [{ createdAt: { $gt: from } }, { undoneAt: { $gt: from } }] })
          .sort({ createdAt: 1 })
          .limit(500)
          .lean(),
      ]);
      for (const n of notifications) onNotification(n);
      for (const a of activities) onActivity(a);
      cursor = now;
    } catch (err) {
      // The database blipped: keep the old cursor so nothing is missed, and try again next time.
      log.warn({ err: err.message }, 'live poll failed');
    } finally {
      polling = false;
    }
  }

  function start() {
    if (timer) return;
    cursor = new Date();
    notificationEvents.on('created', onNotification);
    activityEvents.on('changed', onActivity);
    timer = setInterval(poll, pollMs);
    timer.unref();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    notificationEvents.off('created', onNotification);
    activityEvents.off('changed', onActivity);
  }

  /** Registers one open connection ({ send, close }). Returns a function that removes it again. */
  function connect(userId, conn) {
    const key = String(userId);
    const subs = connections.get(key) ?? new Set();
    if (subs.size >= maxPerUser) {
      throw new AppError(429, 'TOO_MANY_TABS', `Saathi is already open in ${maxPerUser} tabs. Close one and reload this page.`);
    }
    if (total >= maxTotal) throw new AppError(503, 'BUSY', 'Live updates are busy right now. The page still works; reload in a minute.');
    subs.add(conn);
    connections.set(key, subs);
    total++;
    start();
    return () => {
      if (!subs.delete(conn)) return;
      total--;
      if (subs.size === 0) connections.delete(key);
    };
  }

  /** Shutting down: end every stream, so browsers reconnect (to a healthy instance) right away. */
  function closeAll() {
    for (const subs of connections.values()) for (const c of subs) c.close();
    stop();
  }

  return { connect, poll, stop, closeAll, stats: () => ({ users: connections.size, connections: total }) };
}

let hub = null;
export function getLiveHub() {
  hub ??= createLiveHub();
  return hub;
}
