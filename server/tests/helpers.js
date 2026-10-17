// Shared setup for the integration tests.
// They need a real MongoDB. Set MONGODB_URI_TEST to a *separate* test database
// (the tests delete everything in it), for example:
//   MONGODB_URI_TEST=mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/saathi_test
// If it is not set, the integration tests are skipped.
import 'dotenv/config';

export const TEST_DB_URI = process.env.MONGODB_URI_TEST;
export const hasTestDb = Boolean(TEST_DB_URI);

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_DB_URI ?? 'mongodb://unused';
process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-longer-than-32-chars';
// Tests never call the real Claude API (no cost, no flakiness): they use a fake provider instead.
process.env.ANTHROPIC_API_KEY = '';

export async function setupDb() {
  const { connectDB } = await import('../src/db/connect.js');
  const mongoose = (await import('mongoose')).default;
  await connectDB(TEST_DB_URI);
  await mongoose.connection.db.dropDatabase();
  await buildIndexes();
}

// Builds every model's indexes (unique email, job dedupe...) before tests run.
// Some MongoDB-compatible test databases (e.g. FerretDB) do not support every index option,
// such as TTL; those indexes are skipped here. MongoDB Atlas supports them all.
export async function buildIndexes() {
  const mongoose = (await import('mongoose')).default;
  await Promise.all(
    ['User', 'RateCounter', 'Job', 'Task', 'Note', 'Reminder', 'Notification', 'Activity', 'IdempotencyKey', 'Conversation', 'Message', 'Memory', 'PendingAction', 'DayPlan'].map((name) => import(`../src/models/${name}.js`)),
  );
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => {});
    for (const [fields, options] of model.schema.indexes()) {
      try {
        await model.collection.createIndex(fields, { background: true, ...options });
      } catch (err) {
        if (err?.code !== 238 && !/not implemented/i.test(err?.message ?? '')) throw err;
      }
    }
  }
}

// True when the test database is a real MongoDB server (Atlas or local mongod).
// Tests that check MongoDB's single-document atomicity guarantee only make sense there.
export async function isRealMongo() {
  const mongoose = (await import('mongoose')).default;
  const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  return !info.ferretdbVersion;
}

export async function teardownDb() {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

// Signs up a fresh user and returns a supertest agent that keeps the login cookie.
export async function loggedInAgent(app, overrides = {}) {
  const request = (await import('supertest')).default;
  const agent = request.agent(app);
  const email = overrides.email ?? `user${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await agent
    .post('/api/auth/signup')
    .send({ name: 'Test User', email, password: 'secret123', timezone: 'Asia/Kolkata', ...overrides });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user };
}
