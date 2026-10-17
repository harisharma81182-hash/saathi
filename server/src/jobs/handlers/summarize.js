import { aiConfigured } from '../../ai/provider.js';
import { PermanentJobError } from '../worker.js';
import { summarizeConversation } from '../../services/agent.service.js';

// Folds older chat messages into the conversation's rolling summary (see agent.service.js).
// If the AI is briefly down the job fails and the queue retries it later with backoff.
export async function summarize({ conversationId }) {
  if (!aiConfigured()) throw new PermanentJobError('AI is not configured (no ANTHROPIC_API_KEY)');
  return summarizeConversation(conversationId);
}
