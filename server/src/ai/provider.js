import Anthropic from '@anthropic-ai/sdk';
import { env, ai } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { createAiGateway } from './gateway.js';
import { createGeminiProvider } from './gemini.js';

// The "provider" is the one place that talks to the AI model. Everything else asks it for a message:
//
//   provider.send(params, { signal, onText }) -> the complete message
//
// Requests and answers use the Claude Messages format. AI_PROVIDER picks who answers: Gemini
// (src/ai/gemini.js translates to and from Google's format) or Claude (used as is).
// onText receives the reply word by word while it is being written (streaming), so the chat can
// show it live. Tests swap in a fake provider with setAiForTests(), so they never call the real API.

export function createAnthropicProvider({ apiKey = env.ANTHROPIC_API_KEY } = {}) {
  // maxRetries: 0 because our gateway already retries (with backoff, fallback model and breaker).
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async send(params, { signal, onText } = {}) {
      const stream = client.messages.stream(params, { signal });
      if (onText) stream.on('text', (delta) => onText(delta));
      return stream.finalMessage();
    },
  };
}

let provider = null;
let gateway = null;

export function aiConfigured() {
  return Boolean(provider) || Boolean(ai.apiKey);
}

export function getProvider() {
  if (!aiConfigured()) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      `Saathi's brain isn't connected yet (${ai.keyName} is missing). Tasks, notes and reminders still work.`,
    );
  }
  provider ??= ai.provider === 'gemini' ? createGeminiProvider() : createAnthropicProvider();
  return provider;
}

// One gateway per instance, shared by chat, greetings and background summaries, so the
// concurrency limit and circuit breaker see all AI traffic together.
export function getGateway() {
  gateway ??= createAiGateway();
  return gateway;
}

export function setAiForTests({ provider: p = null, gateway: g = null } = {}) {
  provider = p;
  gateway = g;
}
