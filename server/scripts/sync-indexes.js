// Builds every index declared in the models. Safe to run any number of times.
//   npm run db:indexes
import { env } from '../src/config/env.js';
import { connectDB, syncAllIndexes, disconnectDB } from '../src/db/connect.js';
import '../src/models/User.js';
import '../src/models/RateCounter.js';
import '../src/models/Job.js';

await connectDB(env.MONGODB_URI, { maxPoolSize: 2, autoIndex: false });
await syncAllIndexes();
console.log('indexes are up to date');
await disconnectDB();
