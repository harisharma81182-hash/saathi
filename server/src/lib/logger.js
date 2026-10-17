import pino from 'pino';
import { env, isProd, isTest } from '../config/env.js';

// Structured JSON logs in production (one line per event, easy to search on any log platform).
// Readable colored logs in development. Silent during tests unless LOG_LEVEL is set.
export const logger = pino({
  level: isTest && !process.env.LOG_LEVEL ? 'silent' : env.LOG_LEVEL,
  base: { role: env.PROCESS_ROLE },
  // Never write secrets to logs, even by accident.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(!isProd &&
    !isTest && {
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,role' } },
    }),
});
