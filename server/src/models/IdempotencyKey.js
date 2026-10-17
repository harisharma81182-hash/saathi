import mongoose from 'mongoose';

// Remembers the response to a request that carried an Idempotency-Key header, for 24 hours.
// If the same request arrives again (double click, flaky network retry), the stored response is
// returned instead of doing the work twice.
const idempotencyKeySchema = new mongoose.Schema(
  {
    _id: String, // `${userId}|${key}`
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['processing', 'done'], default: 'processing' },
    responseStatus: { type: Number, default: null },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
