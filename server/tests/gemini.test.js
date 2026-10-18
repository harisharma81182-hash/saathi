import './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider, toGeminiRequest, normalizeError } from '../src/ai/gemini.js';
import { createAiGateway, isRetryableAiError } from '../src/ai/gateway.js';
import { TOOL_DEFINITIONS } from '../src/ai/tools.js';

// A fake Gemini client: records requests and streams back the chunks we give it.
function fakeClient(...answers) {
  const requests = [];
  return {
    requests,
    models: {
      async generateContentStream(req) {
        requests.push(req);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return (async function* () {
          yield* answer;
        })();
      },
    },
  };
}

const chunk = (parts, extra = {}) => ({ candidates: [{ content: { role: 'model', parts }, ...extra }] });

describe('gemini adapter', () => {
  test('translates system, history, tools and effort into a Gemini request', () => {
    const req = toGeminiRequest({
      model: 'gemini-3.8-flash',
      max_tokens: 4096,
      system: [{ type: 'text', text: 'persona' }, { type: 'text', text: 'context' }],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '[face:happy] hello' },
        { role: 'user', content: 'add a task' },
      ],
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'none' },
      output_config: { effort: 'low' },
    });
    assert.equal(req.config.systemInstruction, 'persona\n\ncontext');
    assert.deepEqual(req.contents.map((c) => c.role), ['user', 'model', 'user']);
    assert.equal(req.config.tools[0].functionDeclarations.length, TOOL_DEFINITIONS.length);
    assert.ok(req.config.tools[0].functionDeclarations[0].parametersJsonSchema);
    assert.equal(req.config.toolConfig.functionCallingConfig.mode, 'NONE');
    assert.equal(req.config.thinkingConfig.thinkingLevel, 'LOW');
    assert.equal(req.config.maxOutputTokens, 4096);
  });

  test('streams text and returns tool calls in the Claude format, then replays them with their signatures', async () => {
    const client = fakeClient(
      [
        chunk([{ text: '[face:happy] Theek ', thoughtSignature: 'sig-a' }]),
        chunk([{ functionCall: { name: 'create_task', args: { title: 'Lab file' } }, thoughtSignature: 'sig-b' }], { finishReason: 'STOP' }),
      ],
      [{ ...chunk([{ text: 'ho gaya!' }], { finishReason: 'STOP' }), usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, thoughtsTokenCount: 3 } }],
    );
    const provider = createGeminiProvider({ client });
    const deltas = [];
    const first = await provider.send({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'lab file' }] }, { onText: (d) => deltas.push(d) });

    assert.deepEqual(deltas, ['[face:happy] Theek ']);
    assert.equal(first.stop_reason, 'tool_use');
    const call = first.content.find((b) => b.type === 'tool_use');
    assert.equal(call.name, 'create_task');
    assert.deepEqual(call.input, { title: 'Lab file' });
    assert.ok(call.id, 'a missing call id is filled in');

    // The agent sends the whole answer back, plus the tool result.
    const second = await provider.send({
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'user', content: 'lab file' },
        { role: 'assistant', content: first.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: '{"id":"t1"}' }] },
      ],
    });
    const [, model, result] = client.requests[1].contents;
    assert.equal(model.role, 'model');
    assert.deepEqual(model.parts.map((p) => p.thoughtSignature), ['sig-a', 'sig-b'], 'thought signatures are sent back unchanged');
    assert.equal(model.parts[1].functionCall.id, call.id);
    assert.deepEqual(result.parts[0].functionResponse, { id: call.id, name: 'create_task', response: { output: { id: 't1' } } });

    assert.equal(second.stop_reason, 'end_turn');
    assert.deepEqual(second.usage, { input_tokens: 50, output_tokens: 8, cache_read_input_tokens: 0 });
  });

  test('tool errors and blocked answers map to is_error and refusal', async () => {
    const client = fakeClient([{ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }]);
    const res = await createGeminiProvider({ client }).send({
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'list_tasks', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: 'Invalid input.' }] },
      ],
    });
    assert.equal(res.stop_reason, 'refusal');
    assert.deepEqual(client.requests[0].contents[2].parts[0].functionResponse.response, { error: 'Invalid input.' });
  });

  test('provider errors: a short rate-limit wait is retried; the daily limit and a bad key are not', () => {
    const short = normalizeError(Object.assign(new Error('{"error":{"code":429,"details":[{"retryDelay":"7s"}]}}'), { status: 429 }));
    assert.equal(short.retryAfterMs, 7000);
    assert.ok(isRetryableAiError(short));

    const daily = normalizeError(Object.assign(new Error('quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier'), { status: 429 }));
    assert.equal(daily.code, 'AI_DAILY_LIMIT');
    assert.equal(daily.status, 429);
    assert.match(daily.message, /Kal phir/);
    assert.equal(isRetryableAiError(daily), false);

    const badKey = normalizeError(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 }));
    assert.equal(badKey.code, 'AI_KEY_INVALID');
    assert.equal(isRetryableAiError(badKey), false);

    const serverError = Object.assign(new Error('boom'), { status: 503 });
    assert.equal(normalizeError(serverError), serverError);
  });

  test('the gateway passes the daily-limit message through without retrying or opening the breaker', async () => {
    const gateway = createAiGateway({ models: ['gemini-3.8-flash'] });
    let calls = 0;
    const daily = () => normalizeError(Object.assign(new Error('PerDay'), { status: 429 }));
    for (let i = 0; i < 6; i++) {
      await assert.rejects(
        gateway.run({ call: async () => { calls++; throw daily(); } }),
        (err) => err.code === 'AI_DAILY_LIMIT',
      );
    }
    assert.equal(calls, 6, 'no retries');
    assert.equal(gateway.stats().breaker, 'closed');
  });
});
