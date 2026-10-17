import mongoose from 'mongoose';

// One chat thread between a user and Saathi. Most users have one long, ongoing conversation,
// like a chat with a friend.
//
// Old messages do not all fit in every request to the model (cost and speed), so the older part
// of the conversation is kept as a rolling summary, written by a background job
// (jobs/handlers/summarize.js). The model always sees: summary + the most recent messages.
const conversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '', maxlength: 120 },
    summary: { type: String, default: '', maxlength: 6000 },
    // Messages created at or before this time are covered by the summary.
    summarizedThrough: { type: Date, default: null },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

conversationSchema.index({ userId: 1, lastMessageAt: -1 });

export function publicConversation(c) {
  return {
    id: String(c._id),
    title: c.title,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
  };
}

export const Conversation = mongoose.model('Conversation', conversationSchema);
