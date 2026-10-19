import mongoose from 'mongoose';

// One "Password bhool gaye?" link. The link carries a random token; only its SHA-256 hash is
// stored here, so someone who reads the database still cannot use a link.
const passwordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    // Set when the link is used (or replaced by a newer one): a link works only once.
    usedAt: { type: Date, default: null },
    // MongoDB deletes the record a day after it expires (kept that long for support questions).
    removeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ userId: 1, usedAt: 1 });
passwordResetSchema.index({ removeAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
