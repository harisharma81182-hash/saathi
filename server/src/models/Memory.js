import mongoose from 'mongoose';

// Long-term facts Saathi remembers about the user ("classes 9 to 4 on weekdays", "hates mornings",
// "DBMS is the hardest subject"). They are added to every conversation so Saathi feels like it
// knows you. The user can see and delete them in Settings.
export const MEMORY_KINDS = ['fact', 'preference', 'routine', 'goal', 'person'];

const memorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
    kind: { type: String, enum: MEMORY_KINDS, default: 'fact' },
    // Lower-cased text without punctuation, to avoid saving the same fact twice.
    key: { type: String, required: true },
    sourceMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    source: { type: String, enum: ['user', 'agent'], default: 'agent' },
  },
  { timestamps: true },
);

memorySchema.index({ userId: 1, key: 1 }, { unique: true });
memorySchema.index({ userId: 1, updatedAt: -1 });

export function publicMemory(m) {
  return {
    id: String(m._id),
    text: m.text,
    kind: m.kind,
    source: m.source,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export const Memory = mongoose.model('Memory', memorySchema);
