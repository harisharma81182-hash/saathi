import crypto from 'node:crypto';
import { IdempotencyKey } from '../models/IdempotencyKey.js';

const TTL_MS = 24 * 60 * 60 * 1000;

// Makes "create" requests safe to send twice.
//
// The client sends a random Idempotency-Key header with each create action. If the same key comes
// again (double click, the network retried, the user pressed back and resubmitted), the first
// response is replayed and nothing is created twice. Requests without the header work as normal.
//
//   first request          -> runs, response stored
//   same key, same body    -> stored response replayed (header Idempotent-Replayed: true)
//   same key, still running-> 409, try again in a moment
//   same key, other body   -> 422, the key was reused by mistake
export function idempotent() {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key || !req.userId) return next();
    if (key.length > 100) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Idempotency-Key is too long.' } });
    }

    const id = `${req.userId}|${key}`;
    const requestHash = crypto
      .createHash('sha256')
      .update(`${req.method} ${req.baseUrl}${req.path} ${JSON.stringify(req.body ?? {})}`)
      .digest('hex');

    try {
      await IdempotencyKey.create({ _id: id, requestHash, expiresAt: new Date(Date.now() + TTL_MS) });
    } catch (err) {
      if (err?.code !== 11000) return next(err);
      const existing = await IdempotencyKey.findById(id).lean();
      if (!existing) return next(); // expired in between: just run it
      if (existing.requestHash !== requestHash) {
        return res.status(422).json({
          error: { code: 'IDEMPOTENCY_MISMATCH', message: 'This Idempotency-Key was already used for a different request.' },
        });
      }
      if (existing.status === 'processing') {
        res.set('Retry-After', '1');
        return res.status(409).json({ error: { code: 'IN_PROGRESS', message: 'This request is already being processed.' } });
      }
      res.set('Idempotent-Replayed', 'true');
      return res.status(existing.responseStatus).json(existing.responseBody);
    }

    // Capture the response so it can be replayed. Server errors are not stored, so a retry can succeed.
    // The response goes out only after the record is saved: otherwise a quick second request could
    // still find it "processing" and get a 409 even though the first one already finished.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const save =
        status < 500
          ? IdempotencyKey.updateOne({ _id: id }, { $set: { status: 'done', responseStatus: status, responseBody: body } })
          : IdempotencyKey.deleteOne({ _id: id });
      save
        .catch((err) => req.log?.warn({ err: err.message }, 'could not store idempotent response'))
        .finally(() => originalJson(body));
      return res;
    };
    res.on('close', () => {
      if (!res.writableFinished) IdempotencyKey.deleteOne({ _id: id, status: 'processing' }).catch(() => {});
    });
    next();
  };
}
