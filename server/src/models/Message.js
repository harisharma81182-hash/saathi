import mongoose from 'mongoose';

// One chat message. For Saathi's replies we also keep what it did (tool calls and their results),
// the face expression, the model used and token usage (for cost tracking).
const toolCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    ok: { type: Boolean, required: true },
    // Short text of what happened ("Created task ...") or the error message.
    summary: { type: String, default: '', maxlength: 1000 },
    activityIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, default: '', maxlength: 20_000 },
    expression: { type: String, default: null },
    toolCalls: { type: [toolCallSchema], default: [] },
    // ok = normal reply; failed = the AI could not answer (shown to the user, not sent back to the model)
    status: { type: String, enum: ['ok', 'failed'], default: 'ok' },
    // A message Saathi started by itself (not a reply): nudge or recap. null for normal chat.
    origin: { type: String, enum: ['nudge', 'recap', null], default: null },
    model: { type: String, default: null },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      cacheReadTokens: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ userId: 1, createdAt: -1 });

export function publicMessage(m) {
  return {
    id: String(m._id),
    conversationId: String(m.conversationId),
    role: m.role,
    text: m.text,
    expression: m.expression,
    status: m.status,
    origin: m.origin ?? null,
    toolCalls: (m.toolCalls ?? []).map((t) => ({
      name: t.name,
      ok: t.ok,
      summary: t.summary,
      activityIds: (t.activityIds ?? []).map(String),
    })),
    createdAt: m.createdAt,
  };
}

export const Message = mongoose.model('Message', messageSchema);
