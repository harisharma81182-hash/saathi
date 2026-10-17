import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { logger } from '../lib/logger.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

function isDatabaseUnavailable(err) {
  const name = err?.name ?? '';
  return (
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoNotConnectedError' ||
    (name === 'MongooseError' && /initial connection|buffering|bufferCommands/i.test(err.message))
  );
}

// Every error in the app ends up here and leaves as the same JSON shape:
// { error: { code, message, details? } }
// Unexpected errors are logged in full (with the request id) but the user only sees a generic
// message, so stack traces and database details never leak out.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const log = req.log ?? logger;

  if (err instanceof AppError) {
    if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
    if (err.status >= 500) log.warn({ code: err.code, internal: err.internal }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Malformed JSON in the request body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'The request is too large.' } });
  }

  // An id like /api/tasks/abc that is not a valid MongoDB ObjectId
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  // Unique index violation, e.g. two accounts with the same email
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'That already exists.' } });
  }

  // Database briefly unreachable: tell the client to retry instead of reporting a bug.
  if (isDatabaseUnavailable(err)) {
    log.error({ err: err.message }, 'database unavailable');
    res.set('Retry-After', '5');
    return res
      .status(503)
      .json({ error: { code: 'DB_UNAVAILABLE', message: "We can't reach the database right now. Try again in a few seconds." } });
  }

  log.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again in a moment.' },
  });
}
