// Live tests (scripts/live-chat.js) sign up throwaway accounts named live.<number>@example.com in the
// real database. This removes those accounts and everything that belongs to them.
//
//   npm run live:cleanup      delete every leftover live.* test account
import mongoose from 'mongoose';

export const TEST_EMAIL = /^live\.\d+@example\.com$/;
export const testEmail = () => `live.${Date.now()}@example.com`;

/**
 * Deletes the given users and all their data: every collection with a userId field, their queued
 * reminder jobs, and their rate-limit counters. Only ever called with live.* test accounts.
 */
export async function deleteTestAccounts({ emails } = {}) {
  const db = mongoose.connection.db;
  const filter = emails ? { email: { $in: emails } } : { email: TEST_EMAIL };
  const users = await db.collection('users').find(filter, { projection: { email: 1 } }).toArray();
  if (users.some((u) => !TEST_EMAIL.test(u.email))) throw new Error('refusing to delete a non-test account');
  if (users.length === 0) return { users: 0, deleted: {} };

  const ids = users.map((u) => u._id);
  const idStrings = ids.map(String);
  const deleted = {};

  // Reminder jobs point at reminders, not users: find them before the reminders are deleted.
  const reminderIds = (await db.collection('reminders').find({ userId: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((r) => String(r._id));
  deleted.jobs = (await db.collection('jobs').deleteMany({ 'payload.reminderId': { $in: reminderIds } })).deletedCount;

  for (const { name } of await db.listCollections().toArray()) {
    if (name === 'users' || name === 'jobs' || name.startsWith('system.')) continue;
    const { deletedCount } = await db.collection(name).deleteMany({ userId: { $in: ids } });
    if (deletedCount) deleted[name] = deletedCount;
  }
  // Rate-limit counters are keyed like "ai:<userId>:min|<window>".
  const keyPattern = new RegExp(`(${idStrings.join('|')})`);
  deleted.ratecounters = (await db.collection('ratecounters').deleteMany({ _id: { $regex: keyPattern } })).deletedCount;
  deleted.users = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
  return { users: users.length, emails: users.map((u) => u.email), deleted };
}

// Run directly: delete every leftover test account.
if (process.argv[1]?.endsWith('live-accounts.js')) {
  const { env } = await import('../src/config/env.js');
  const { connectDB, disconnectDB } = await import('../src/db/connect.js');
  await connectDB(env.MONGODB_URI, { maxPoolSize: 2, autoIndex: false });
  try {
    console.log(JSON.stringify(await deleteTestAccounts(), null, 2));
  } finally {
    await disconnectDB();
  }
}
