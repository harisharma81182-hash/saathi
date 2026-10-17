import 'dotenv/config';
import { z } from 'zod';

// Every setting the server needs, validated once at startup.
// If something required is missing, the server refuses to start and says exactly what is wrong.
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // web    = only serve HTTP requests (scale these horizontally)
  // worker = only run background jobs (reminders, slow AI work)
  // all    = both in one process (cheapest; fine for a single small instance)
  PROCESS_ROLE: z.enum(['web', 'worker', 'all']).default('all'),

  MONGODB_URI: z
    .string({ error: 'missing. Paste your MongoDB Atlas connection string here.' })
    .min(1, 'missing. Paste your MongoDB Atlas connection string here.'),
  // Connections per instance. Total = instances x this, and must stay under the cluster's limit
  // (Atlas free tier: 500). 10 is plenty for a Node process because queries are async.
  MONGO_MAX_POOL: z.coerce.number().int().min(1).max(200).default(10),

  JWT_SECRET: z
    .string({ error: 'missing. Set it to a long random string (at least 32 characters).' })
    .min(32, 'must be at least 32 characters long.'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  // How long a stopping instance waits for in-flight requests before closing them.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  // Event-loop delay above which the instance answers 503 instead of queueing more work.
  OVERLOAD_MAX_LAG_MS: z.coerce.number().int().min(10).default(200),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
  ANTHROPIC_FALLBACK_MODEL: z.string().default('claude-sonnet-5-5'),
  // Per-instance limits for calls to the AI provider (see src/ai/gateway.js)
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  AI_MAX_QUEUE: z.coerce.number().int().min(0).default(50),
  AI_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  // Per-user limits, shared across all instances through MongoDB
  AI_USER_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  AI_USER_PER_DAY: z.coerce.number().int().min(1).default(200),

  TRUST_PROXY: bool.default('true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\nSaathi cannot start because the configuration is invalid:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy server/.env.example to server/.env and fill in the values.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const runsWeb = env.PROCESS_ROLE === 'web' || env.PROCESS_ROLE === 'all';
export const runsWorker = env.PROCESS_ROLE === 'worker' || env.PROCESS_ROLE === 'all';
