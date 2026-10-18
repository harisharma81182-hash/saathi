import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Gemini adapter. The agent speaks one format (the Claude Messages format: system, messages with
// text / tool_use / tool_result blocks, tools with input_schema). This file translates that format
// to Gemini's generateContent and translates the answer back, so agent.service.js works with
// either provider without knowing which one is behind it.
//
//   provider.send(params, { signal, onText }) -> { content, stop_reason, usage, model }

const EFFORT_TO_THINKING = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

// The free tier answers 429 when its own limits are hit. A short wait (a few seconds) is worth a
// retry; a long one, or the daily limit, is not: tell the user plainly instead.
const MAX_RETRY_WAIT_S = 20;

export function createGeminiProvider({ apiKey = env.GEMINI_API_KEY, client } = {}) {
  const ai = client ?? new GoogleGenAI({ apiKey });
  return {
    async send(params, { signal, onText } = {}) {
      let stream;
      try {
        stream = await ai.models.generateContentStream(toGeminiRequest(params, signal));
      } catch (err) {
        throw normalizeError(err);
      }
      const parts = [];
      let finishReason;
      let blockReason;
      let usage;
      let modelVersion;
      try {
        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            parts.push(part);
            if (part.text && !part.thought) onText?.(part.text);
          }
          finishReason = candidate?.finishReason ?? finishReason;
          blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
          usage = chunk.usageMetadata ?? usage;
          modelVersion = chunk.modelVersion ?? modelVersion;
        }
      } catch (err) {
        throw normalizeError(err);
      }
      return toClaudeMessage({ parts, finishReason, blockReason, usage, model: modelVersion ?? params.model });
    },
  };
}

/** Claude-style request -> Gemini generateContent request. */
export function toGeminiRequest(params, signal) {
  const config = {
    maxOutputTokens: params.max_tokens,
    abortSignal: signal,
  };
  const system = typeof params.system === 'string' ? params.system : (params.system ?? []).map((b) => b.text).join('\n\n');
  if (system) config.systemInstruction = system;

  const level = EFFORT_TO_THINKING[params.output_config?.effort];
  if (level && /^gemini-3/.test(params.model)) config.thinkingConfig = { thinkingLevel: level };

  if (params.tools?.length) {
    config.tools = [
      {
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.input_schema,
        })),
      },
    ];
    // tool_choice none = "answer in words now" (the agent's last step).
    config.toolConfig = { functionCallingConfig: { mode: params.tool_choice?.type === 'none' ? 'NONE' : 'AUTO' } };
  }

  return { model: params.model, contents: toContents(params.messages), config };
}

function toContents(messages) {
  const toolNames = new Map(); // tool_use id -> tool name (Gemini's function responses need the name)
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      contents.push({ role, parts: [{ text: m.content }] });
      continue;
    }
    for (const b of m.content) if (b.type === 'tool_use') toolNames.set(b.id, b.name);

    // An answer that came from Gemini earlier in this turn: send its parts back exactly as they
    // were. Gemini 3 attaches "thought signatures" to them and rejects the request without them.
    const raw = m.content.find((b) => b.type === 'gemini_parts');
    if (raw) {
      contents.push({ role, parts: raw.parts });
      continue;
    }

    const parts = [];
    for (const b of m.content) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { id: b.id, name: b.name, args: b.input ?? {} } });
      else if (b.type === 'tool_result') {
        const output = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join('');
        parts.push({
          functionResponse: {
            id: b.tool_use_id,
            name: toolNames.get(b.tool_use_id) ?? 'unknown',
            response: b.is_error ? { error: output } : { output: parseJson(output) },
          },
        });
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Gemini answer -> Claude-style message. */
export function toClaudeMessage({ parts, finishReason, blockReason, usage, model }) {
  const content = [];
  let text = '';
  for (const part of parts) {
    if (part.text && !part.thought) text += part.text;
    if (part.functionCall) {
      content.push({
        type: 'tool_use',
        id: part.functionCall.id || `call_${randomUUID().slice(0, 12)}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    }
  }
  if (text) content.unshift({ type: 'text', text });

  const toolUses = content.filter((b) => b.type === 'tool_use');
  // Keep the original parts (with the ids we filled in) for the next request of this turn.
  let i = 0;
  const rawParts = parts.map((p) => (p.functionCall ? { ...p, functionCall: { ...p.functionCall, id: toolUses[i++].id } } : p));
  content.push({ type: 'gemini_parts', parts: rawParts });

  let stop_reason = 'end_turn';
  if (toolUses.length) stop_reason = 'tool_use';
  else if (blockReason || REFUSAL_REASONS.has(finishReason)) stop_reason = 'refusal';
  else if (finishReason === 'MAX_TOKENS') stop_reason = 'max_tokens';

  return {
    model,
    content,
    stop_reason,
    usage: {
      input_tokens: usage?.promptTokenCount ?? 0,
      output_tokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: usage?.cachedContentTokenCount ?? 0,
    },
  };
}

/**
 * Makes Gemini's errors fit the gateway: the HTTP status stays on `status` (so 5xx / network errors
 * are retried), and a rate-limit answer becomes either a short retry or a friendly message.
 */
export function normalizeError(err) {
  // A wrong or revoked key: retrying won't help, and the fix is in .env, so say exactly that.
  if ((err?.status === 400 && /API_KEY_INVALID|API key not valid/i.test(err.message)) || err?.status === 401 || err?.status === 403) {
    const out = new AppError(
      503,
      'AI_KEY_INVALID',
      "Saathi's brain can't log in: the GEMINI_API_KEY in server/.env is not valid. Tasks, notes and reminders still work.",
    );
    out.retryable = false;
    return out;
  }
  if (err?.status !== 429) return err;
  const message = String(err.message ?? '');
  const perDay = /PerDay/i.test(message);
  const wait = Number(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/.exec(message)?.[1]);
  if (!perDay && Number.isFinite(wait) && wait <= MAX_RETRY_WAIT_S) {
    err.retryAfterMs = Math.ceil(wait * 1000);
    return err;
  }
  const out = perDay
    ? new AppError(
        429,
        'AI_DAILY_LIMIT',
        'Aaj ke liye mera free AI quota khatam ho gaya 😅 Kal phir baat karte hain. Tab tak tasks, notes aur reminders normal chalte rahenge.',
      )
    : new AppError(429, 'AI_BUSY', 'Abhi mera AI thoda busy hai. Ek minute ruk ke phir try karo.');
  out.retryAfterSeconds = perDay ? 60 * 60 : Math.max(5, Math.ceil(wait) || 60);
  out.retryable = false; // waiting a few seconds won't help; and it is a limit, not an outage
  return out;
}
