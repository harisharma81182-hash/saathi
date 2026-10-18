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

  // Which AI powers Saathi. gemini = Google's free tier (default for now); anthropic = Claude.
  AI_PROVIDER: z.enum(['gemini', 'anthropic'], { error: 'must be "gemini" or "anthropic".' }).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_FALLBACK_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
  ANTHROPIC_FALLBACK_MODEL: z.string().default('claude-sonnet-5-5'),
  // Per-instance limits for calls to the AI provider (see src/ai/gateway.js)
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  AI_MAX_QUEUE: z.coerce.number().int().min(0).default(50),
  AI_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  // One attempt is aborted after AI_REQUEST_TIMEOUT_MS; one AI call, retries included, never takes
  // longer than AI_TOTAL_TIMEOUT_MS. Chat needs an answer quickly or a clear error, not a long wait.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  AI_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(28_000),
  // Per-user chat messages, shared across all instances through MongoDB. Generous: only spam hits them.
  AI_USER_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  AI_USER_PER_DAY: z.coerce.number().int().min(1).default(300),
  // AI requests for the whole app (all users together), kept a bit below the provider's own project
  // limit so Saathi says so politely instead of failing. 0 = no limit. Defaults depend on the provider.
  AI_GLOBAL_PER_MINUTE: z.coerce.number().int().min(0).optional(),
  AI_GLOBAL_PER_DAY: z.coerce.number().int().min(0).optional(),

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

// Gemini's free tier for gemini-3.8-flash allows 20 requests per day per project (seen in its 429
// answer on 18 Oct 2026); stop at 18. Claude is paid per use, so no app-wide cap by default.
const AI_GLOBAL_DEFAULTS = { gemini: { perMinute: 8, perDay: 18 }, anthropic: { perMinute: 0, perDay: 0 } };
env.AI_GLOBAL_PER_MINUTE ??= AI_GLOBAL_DEFAULTS[env.AI_PROVIDER].perMinute;
env.AI_GLOBAL_PER_DAY ??= AI_GLOBAL_DEFAULTS[env.AI_PROVIDER].perDay;

/** The selected provider's API key and models (main first, then the fallback for overload). */
export const ai =
  env.AI_PROVIDER === 'gemini'
    ? { provider: 'gemini', apiKey: env.GEMINI_API_KEY, keyName: 'GEMINI_API_KEY', models: [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean) }
    : { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, keyName: 'ANTHROPIC_API_KEY', models: [env.ANTHROPIC_MODEL, env.ANTHROPIC_FALLBACK_MODEL].filter(Boolean) };
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const runsWeb = env.PROCESS_ROLE === 'web' || env.PROCESS_ROLE === 'all';
export const runsWorker = env.PROCESS_ROLE === 'worker' || env.PROCESS_ROLE === 'all';
