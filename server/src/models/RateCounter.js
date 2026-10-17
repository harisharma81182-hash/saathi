import mongoose from 'mongoose';

// One document per (key, time window), e.g. "ai:user:<id>:m" for the current minute.
// Lives in MongoDB so every instance sees the same count: limits stay correct no matter how many
// instances are running. A TTL index deletes old windows automatically.
const rateCounterSchema = new mongoose.Schema(
  {
    _id: String, // `${key}|${windowStart}`
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateCounter = mongoose.model('RateCounter', rateCounterSchema);
