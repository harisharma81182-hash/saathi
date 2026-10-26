import { z } from 'zod';
import { EventEmitter } from 'node:events';
import { Notification, publicNotification } from '../models/Notification.js';
import { AppError } from '../utils/AppError.js';
import { pagination } from '../utils/schemas.js';
import { enqueue } from '../jobs/queue.js';

// In-process event bus: fires when this instance creates a notification.
// Step 4 (live updates) listens to it and to the database, so users connected to any instance
// receive their notifications.
export const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0);

export const listNotificationsSchema = z.object({
  unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...pagination,
});

/**
 * Creates a notification once. Calling again with the same dedupeKey returns the existing one.
 * The app shows it live; a background job then sends it as a push and, if needed, an email
 * (services/delivery.service.js).
 */
export async function create({ userId, kind, title, body = '', expression = null, data = null, refType = null, refId = null, dedupeKey }) {
  try {
    const n = await Notification.create({ userId, kind, title, body, expression, data, refType, refId, ...(dedupeKey && { dedupeKey }) });
    notificationEvents.emit('created', n);
    await enqueue('notification.deliver', { notificationId: String(n._id) }, { maxAttempts: 3, dedupeKey: `deliver:${n._id}` });
    return { notification: n, created: true };
  } catch (err) {
    if (err?.code === 11000 && dedupeKey) {
      const existing = await Notification.findOne({ dedupeKey });
      // A retry after a crash between saving and queueing: make sure it still goes out (once).
      if (existing && !existing.delivery) {
        await enqueue('notification.deliver', { notificationId: String(existing._id) }, { maxAttempts: 3, dedupeKey: `deliver:${existing._id}` });
      }
      return { notification: existing, created: false };
    }
    throw err;
  }
}

export async function list(userId, query) {
  const match = { userId };
  if (query.unread) match.readAt = null;
  const [rows, unreadCount] = await Promise.all([
    Notification.find(match)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Notification.countDocuments({ userId, readAt: null }),
  ]);
  return { notifications: rows.map(publicNotification), unreadCount };
}

export async function markRead(userId, id) {
  const n = await Notification.findOne({ _id: id, userId });
  if (!n) throw AppError.notFound('Notification not found.');
  if (!n.readAt) {
    n.readAt = new Date();
    await n.save();
  }
  return n;
}

export async function markAllRead(userId) {
  const res = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
