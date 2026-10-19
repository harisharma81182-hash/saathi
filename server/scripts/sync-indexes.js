// Builds every index declared in the models. Safe to run any number of times.
//   npm run db:indexes
import { env } from '../src/config/env.js';
import { connectDB, syncAllIndexes, disconnectDB } from '../src/db/connect.js';
import '../src/models/User.js';
import '../src/models/RateCounter.js';
import '../src/models/Job.js';
import '../src/models/Task.js';
import '../src/models/Note.js';
import '../src/models/Reminder.js';
import '../src/models/Notification.js';
import '../src/models/Activity.js';
import '../src/models/IdempotencyKey.js';
import '../src/models/Conversation.js';
import '../src/models/Message.js';
import '../src/models/Memory.js';
import '../src/models/PendingAction.js';
import '../src/models/DayPlan.js';
import '../src/models/PasswordReset.js';

await connectDB(env.MONGODB_URI, { maxPoolSize: 2, autoIndex: false });
await syncAllIndexes();
console.log('indexes are up to date');
await disconnectDB();
