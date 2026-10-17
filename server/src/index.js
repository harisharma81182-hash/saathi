import { env, runsWeb, runsWorker } from './config/env.js';
import { logger } from './lib/logger.js';
import { lifecycle } from './lib/lifecycle.js';
import { connectDB, disconnectDB } from './db/connect.js';
import { createApp } from './app.js';
import { startWorker } from './jobs/worker.js';

// One codebase, three ways to run it (PROCESS_ROLE):
//   web    -> serves HTTP. Stateless, so any number of copies can run behind a load balancer.
//   worker -> runs background jobs. Scale separately from web traffic.
//   all    -> both in one process. Cheapest option for a single small instance.

async function main() {
  await connectDB(env.MONGODB_URI, { maxPoolSize: env.MONGO_MAX_POOL });

  let server = null;
  if (runsWeb) {
    const app = createApp();
    server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, `Saathi API listening on http://localhost:${env.PORT}`));

    // Keep idle connections open longer than typical load balancers (60 s), otherwise the server can
    // close a connection at the same moment the balancer reuses it, which shows up as random 502s.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
  }

  const worker = runsWorker ? startWorker({ concurrency: 4 }) : null;

  // Graceful shutdown. Platforms send SIGTERM before stopping an instance (deploys, scale-down).
  //  1. Mark not ready -> readiness returns 503, load balancer stops sending new requests
  //  2. Stop accepting connections; let in-flight requests finish (up to SHUTDOWN_TIMEOUT_MS)
  //  3. Let running jobs finish; unfinished ones are retried by another worker when their lock expires
  //  4. Close the database connection and exit
  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    lifecycle.shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown took too long, forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS + 5000);
    forceExit.unref();

    await Promise.all([
      server &&
        new Promise((resolve) => {
          server.close(resolve);
          server.closeIdleConnections();
          setTimeout(() => {
            server.closeAllConnections();
            resolve();
          }, env.SHUTDOWN_TIMEOUT_MS).unref();
        }),
      worker?.stop(env.SHUTDOWN_TIMEOUT_MS),
    ]);

    await disconnectDB().catch(() => {});
    logger.info('shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// A bug that escapes every handler leaves the process in an unknown state. Log it and exit;
// the platform starts a fresh instance, and the other instances keep serving meanwhile.
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err: err?.message }, 'failed to start');
  process.exit(1);
});
