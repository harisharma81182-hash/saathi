import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { createAiGateway } from './gateway.js';

// The "provider" is the one place that talks to Claude. Everything else asks it for a message:
//
//   provider.send(params, { signal, onText }) -> the complete Claude message
//
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
  return Boolean(provider) || Boolean(env.ANTHROPIC_API_KEY);
}

export function getProvider() {
  if (!aiConfigured()) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      "Saathi's brain isn't connected yet (the Claude API key is missing). Tasks, notes and reminders still work.",
    );
  }
  provider ??= createAnthropicProvider();
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
