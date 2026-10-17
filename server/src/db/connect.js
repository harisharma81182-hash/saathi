import dns from 'node:dns';
import mongoose from 'mongoose';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'db' });

export async function connectDB(uri, { maxPoolSize = 10, autoIndex = true } = {}) {
  mongoose.set('strictQuery', true);

  // Fail fast instead of silently queueing queries while the database is unreachable.
  // The request gets a clear 503 right away and the readiness check takes the instance out of rotation.
  mongoose.set('bufferCommands', false);

  // Mongoose creates missing indexes on startup. Creating an index that already exists is a no-op,
  // so this is safe with many instances. Turn it off if indexes are ever managed by migrations
  // (`npm run db:indexes` builds them on demand).
  mongoose.set('autoIndex', autoIndex);

  mongoose.connection.on('disconnected', () => log.warn('disconnected'));
  mongoose.connection.on('reconnected', () => log.info('reconnected'));

  const options = {
    maxPoolSize, // connections per instance; instances x pool must stay under the cluster limit
    minPoolSize: 0,
    maxIdleTimeMS: 60_000, // release idle connections so scaled-down periods use fewer
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  };

  try {
    try {
      await mongoose.connect(uri, options);
    } catch (err) {
      // Atlas addresses (mongodb+srv://) need a DNS "SRV" lookup. Some home and mobile internet
      // providers' DNS servers answer those badly (querySrv EBADRESP / ECONNREFUSED / ETIMEOUT).
      // In that case, retry once using public DNS servers for this app's own lookups only.
      if (!isSrvLookupFailure(err)) throw err;
      log.warn({ err: err.message }, 'DNS lookup for MongoDB failed, retrying with public DNS (1.1.1.1, 8.8.8.8)');
      dns.setServers(['1.1.1.1', '8.8.8.8']);
      dns.promises.setServers(['1.1.1.1', '8.8.8.8']);
      await mongoose.connect(uri, options);
    }
    log.info({ maxPoolSize }, 'connected');
  } catch (err) {
    log.error(
      { err: err.message },
      'Could not connect to MongoDB. Check MONGODB_URI in server/.env, your Atlas password, and that Network Access in Atlas allows your IP (or 0.0.0.0/0).',
    );
    throw err;
  }
}

function isSrvLookupFailure(err) {
  return /querySrv|queryTxt/i.test(err?.message ?? '') || ['EBADRESP', 'ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL'].includes(err?.code);
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// A real round trip, used by the readiness check. Times out quickly so health checks stay fast.
export async function pingDb(timeoutMs = 2000) {
  if (!isDbConnected()) return false;
  let timer;
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function syncAllIndexes() {
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
