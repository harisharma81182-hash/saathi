import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '', trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 20_000 },
    tags: { type: [String], default: [] },
    pinned: { type: Boolean, default: false },
    source: { type: String, enum: ['user', 'agent'], default: 'user' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

noteSchema.index({ userId: 1, deletedAt: 1, pinned: -1, updatedAt: -1 });

export const NOTE_FIELDS = ['title', 'body', 'tags', 'pinned'];

export function publicNote(n) {
  return {
    id: String(n._id),
    title: n.title,
    body: n.body,
    tags: n.tags,
    pinned: n.pinned,
    source: n.source,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export const Note = mongoose.model('Note', noteSchema);
