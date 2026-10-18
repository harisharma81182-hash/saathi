// Tests for Step 3: the agent. A fake provider plays Claude with scripted replies, so these tests
// check our side of the loop (tools, receipts, confirmations, memory, failures) without any real
// API calls.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

const { ExpressionFilter, splitExpression } = await import('../src/ai/expression.js');
const { sessionLabels } = await import('../src/services/planner.service.js');
const { TOOL_DEFINITIONS } = await import('../src/ai/tools.js');

const daysFromNow = (d, hour = 10) => {
  const t = new Date(Date.now() + d * 24 * 60 * 60_000);
  t.setUTCHours(hour - 5, 30, 0, 0); // hour:00 IST
  return t.toISOString().replace('.000Z', 'Z');
};

// ---- fake Claude ---------------------------------------------------------------------------

let toolIds = 0;
const say = (text) => ({ content: [{ type: 'text', text }] });
const use = (name, input) => ({ content: [{ type: 'tool_use', id: `toolu_${++toolIds}`, name, input }] });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** steps: one entry per model call; a function gets the request and returns a reply (or an Error to throw). */
function fakeProvider(steps) {
  const calls = [];
  return {
    calls,
    async send(params, { onText } = {}) {
      calls.push(JSON.parse(JSON.stringify(params)));
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      const reply = typeof step === 'function' ? await step(params, calls.length) : step;
      if (reply instanceof Error) throw reply;
      // Stream text in small pieces, like the real API, so split face tags are exercised.
      for (const block of reply.content) {
        if (block.type === 'text' && onText) for (let i = 0; i < block.text.length; i += 4) onText(block.text.slice(i, i + 4));
      }
      return {
        model: params.model,
        stop_reason: reply.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
        ...reply,
      };
    },
  };
}

// The tool results the model received in a given call.
const toolResults = (params) => params.messages.at(-1).content;
const lastResult = (params) => JSON.parse(toolResults(params)[0].content);

function parseSse(text) {
  return text
    .split('\n\n')
    .map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: /^data: (.*)$/m.exec(block)?.[1] }))
    .filter((e) => e.event)
    .map((e) => ({ event: e.event, data: JSON.parse(e.data) }));
}

const events = (res, name) => parseSse(res.text).filter((e) => e.event === name).map((e) => e.data);
const replyText = (res) => events(res, 'text').map((d) => d.delta).join('');

// ---- unit tests (no database) -----------------------------------------------------------------

describe('face expression tags', () => {
  it('removes a tag split across stream chunks and reports the expression', () => {
    const seen = [];
    const f = new ExpressionFilter({ onExpression: (e) => seen.push(e) });
    const out = ['[fa', 'ce:pro', 'ud]', ' Wah', ' bhai!'].map((c) => f.push(c)).join('') + f.flush();
    assert.equal(out, 'Wah bhai!');
    assert.deepEqual(seen, ['proud']);
  });

  it('keeps normal brackets and ignores unknown expressions', () => {
    assert.deepEqual(splitExpression('[face:angry] Notes [2] ready'), { text: 'Notes [2] ready', expression: 'happy' });
    const f = new ExpressionFilter();
    assert.equal(f.push('Option [a') + f.push(']') + f.flush(), 'Option [a]');
  });
});

describe('study plan sessions', () => {
  it('spreads topics over the days and keeps the last day for revision', () => {
    assert.deepEqual(sessionLabels(['ER model', 'SQL', 'Normalization', 'Transactions'], 3), ['ER model, SQL', 'Normalization, Transactions', 'Revision and practice questions']);
    assert.deepEqual(sessionLabels(['SQL'], 3), ['SQL', 'SQL (continued)', 'Revision and practice questions']);
    assert.deepEqual(sessionLabels([], 1), ['Revision and practice questions']);
  });
});

describe('tool definitions', () => {
  it('every tool has a name, description and an object input schema', () => {
    assert.ok(TOOL_DEFINITIONS.length >= 17);
    for (const t of TOOL_DEFINITIONS) {
      assert.match(t.name, /^[a-z_]+$/);
      assert.ok(t.description.length > 20, `${t.name} needs a useful description`);
      assert.equal(t.input_schema.type, 'object');
      assert.equal(t.input_schema.$schema, undefined);
    }
  });
});

// ---- integration tests ------------------------------------------------------------------------

describe('Step 3: agent', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let me;
  let other;
  let setAiForTests;
  let createAiGateway;
  let MAX_STEPS;

  // Fresh fake Claude for each test; fast retries and a high quota so tests are quick.
  function useProvider(steps) {
    const provider = fakeProvider(steps);
    setAiForTests({ provider, gateway: createAiGateway({ retryOptions: { baseMs: 1, maxMs: 2 }, perUserPerMinute: 10_000, perUserPerDay: 10_000 }) });
    return provider;
  }

  const chat = (who, message, extra = {}) => who.agent.post('/api/agent/chat').send({ message, ...extra });

  before(async () => {
    await setupDb();
    ({ createApp: app } = await import('../src/app.js'));
    app = app();
    ({ setAiForTests } = await import('../src/ai/provider.js'));
    ({ createAiGateway } = await import('../src/ai/gateway.js'));
    ({ MAX_STEPS } = await import('../src/services/agent.service.js'));
    me = await loggedInAgent(app, { name: 'Himanshu' });
    other = await loggedInAgent(app, { name: 'Someone Else' });
  });

  beforeEach(() => setAiForTests());
  after(async () => {
    setAiForTests();
    await teardownDb();
  });

  it('without an API key, chat answers with a clear 503 and the rest of the app still works', async () => {
    const res = await chat(me, 'hi');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'AI_NOT_CONFIGURED');
    assert.equal((await me.agent.get('/api/tasks')).status, 200);
  });

  it('rejects an empty message before calling the model', async () => {
    const provider = useProvider([say('[face:happy] hi')]);
    const res = await chat(me, '   ');
    assert.equal(res.status, 400);
    assert.equal(provider.calls.length, 0);
  });

  it('creates a task and a linked reminder through tools, with streamed text, face and receipts', async () => {
    const remindAt = daysFromNow(1, 9);
    const provider = useProvider([
      use('create_task', { title: 'Submit DBMS lab file', dueAt: remindAt, priority: 'high' }),
      (params) => use('set_reminder', { text: 'DBMS lab file submit karna', remindAt, taskId: lastResult(params).task.id }),
      say('[face:proud] Ho gaya! Kal 9 baje yaad dila dunga.'),
    ]);

    const res = await chat(me, 'kal 9 baje lab file submit karne ka reminder lagao');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);

    assert.equal(replyText(res), 'Ho gaya! Kal 9 baje yaad dila dunga.', 'face tag is not shown as text');
    assert.deepEqual(events(res, 'expression'), [{ expression: 'proud' }]);

    const receipts = events(res, 'receipt');
    assert.equal(receipts.length, 2);
    assert.match(receipts[0].summary, /Created task "Submit DBMS lab file"/);
    assert.equal(receipts[1].activities[0].action, 'reminder.created');

    // The model got real results back, and the context told it the user's name and local time.
    assert.equal(provider.calls.length, 3);
    assert.match(provider.calls[0].system[1].text, /User: Himanshu/);
    assert.match(provider.calls[0].system[1].text, /\+05:30/);
    assert.equal(provider.calls[0].system[0].cache_control.type, 'ephemeral', 'the fixed persona is cached');

    // The changes are real, made by the agent, and undoable from the receipt.
    const tasks = (await me.agent.get('/api/tasks?q=DBMS lab')).body.tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, 'agent');
    const reminders = (await me.agent.get('/api/reminders')).body.reminders;
    assert.equal(reminders.find((r) => r.text === 'DBMS lab file submit karna').taskId, tasks[0].id);

    const undo = await me.agent.post(`/api/me/activity/${receipts[1].activities[0].id}/undo`);
    assert.equal(undo.status, 200);
    assert.equal(undo.body.reminder.status, 'cancelled');

    // The reply is saved with what it did.
    const done = events(res, 'done')[0].message;
    assert.equal(done.expression, 'proud');
    assert.deepEqual(done.toolCalls.map((t) => t.name), ['create_task', 'set_reminder']);
  });

  it('warns about a similar open task instead of creating a duplicate', async () => {
    let seen;
    useProvider([
      use('create_task', { title: 'DBMS lab file' }),
      (params) => {
        seen = lastResult(params);
        return say('[face:thinking] Ye pehle se hai, phir se add karun?');
      },
    ]);
    const res = await chat(me, 'DBMS lab file ka task bana do');
    assert.equal(seen.created, false);
    assert.equal(seen.reason, 'similar_open_tasks');
    assert.ok(seen.similar.some((t) => t.title === 'Submit DBMS lab file'));
    assert.equal(events(res, 'receipt').length, 0, 'nothing changed, so no receipt');
  });

  it('sends invalid tool input back as an instructive error, and the loop continues', async () => {
    let result;
    useProvider([
      use('set_reminder', { text: 'Gym', remindAt: 'tomorrow 7am' }),
      (params) => {
        result = toolResults(params)[0];
        return say('[face:sorry] Time samajh nahi aaya, kitne baje?');
      },
    ]);
    const res = await chat(me, 'gym ka reminder');
    assert.equal(result.is_error, true);
    assert.match(result.content, /remindAt: Use a full date and time with a timezone/);
    assert.deepEqual(events(res, 'tool').at(-1), { id: events(res, 'tool')[0].id, name: 'set_reminder', status: 'failed', message: result.content });
    assert.equal(replyText(res), 'Time samajh nahi aaya, kitne baje?');
  });

  it('turns service errors (e.g. a time in the past) into tool errors the model can explain', async () => {
    let result;
    useProvider([
      use('set_reminder', { text: 'Old', remindAt: '2020-01-01T09:00:00+05:30' }),
      (params) => {
        result = toolResults(params)[0];
        return say('[face:surprised] Wo time toh nikal gaya!');
      },
    ]);
    await chat(me, 'reminder for 2020');
    assert.equal(result.is_error, true);
    assert.match(result.content, /already passed/);
  });

  it('only deletes a task after the user confirms', async () => {
    const task = (await me.agent.post('/api/tasks').send({ title: 'Old club form' })).body.task;
    useProvider([use('delete_task', { taskId: task.id }), say('[face:thinking] Confirm daba do, phir delete kar dunga.')]);

    const res = await chat(me, 'club form wala task hata do');
    const [confirm] = events(res, 'confirm');
    assert.equal(confirm.summary, 'Delete task "Old club form"');
    assert.equal((await me.agent.get(`/api/tasks/${task.id}`)).status, 200, 'not deleted yet');

    assert.equal((await other.agent.post(`/api/agent/actions/${confirm.id}/confirm`)).status, 404, "another user can't confirm it");

    const ok = await me.agent.post(`/api/agent/actions/${confirm.id}/confirm`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.activities[0].action, 'task.deleted');
    assert.equal((await me.agent.get(`/api/tasks/${task.id}`)).status, 404);

    const again = await me.agent.post(`/api/agent/actions/${confirm.id}/confirm`);
    assert.equal(again.status, 409, 'a double click does not delete twice');

    // Undo brings it back.
    assert.equal((await me.agent.post(`/api/me/activity/${ok.body.activities[0].id}/undo`)).status, 200);
    assert.equal((await me.agent.get(`/api/tasks/${task.id}`)).status, 200);
  });

  it('cancel leaves the task alone', async () => {
    const task = (await me.agent.post('/api/tasks').send({ title: 'Keep me' })).body.task;
    useProvider([use('delete_task', { taskId: task.id }), say('[face:thinking] Confirm karo.')]);
    const [confirm] = events(await chat(me, 'delete keep me'), 'confirm');
    assert.equal((await me.agent.post(`/api/agent/actions/${confirm.id}/cancel`)).body.action.status, 'cancelled');
    assert.equal((await me.agent.post(`/api/agent/actions/${confirm.id}/confirm`)).status, 409);
    assert.equal((await me.agent.get(`/api/tasks/${task.id}`)).status, 200);
  });

  it("can't touch another user's task, even if the model is given its id", async () => {
    const theirs = (await other.agent.post('/api/tasks').send({ title: 'Private task' })).body.task;
    let result;
    useProvider([
      use('complete_task', { taskId: theirs.id }),
      (params) => {
        result = toolResults(params)[0];
        return say('[face:sorry] Wo task mila nahi.');
      },
    ]);
    await chat(me, 'complete it');
    assert.equal(result.is_error, true);
    assert.match(result.content, /not found/i);
    assert.equal((await other.agent.get(`/api/tasks/${theirs.id}`)).body.task.status, 'open');
  });

  it('makes a study plan with sessions and reminders, and refuses a duplicate plan', async () => {
    const examAt = daysFromNow(5);
    useProvider([
      use('make_study_plan', { subject: 'DBMS', examAt, topics: ['ER model', 'SQL', 'Normalization', 'Transactions'], studyTime: '18:00' }),
      say('[face:excited] Plan ready!'),
    ]);
    const res = await chat(me, '5 din baad DBMS exam hai, plan bana do');
    const [receipt] = events(res, 'receipt');
    assert.match(receipt.summary, /Study plan for DBMS: \d sessions/);
    const sessions = receipt.activities.filter((a) => a.action === 'task.created').length - 1; // minus the exam itself
    assert.ok(sessions >= 3 && sessions <= 5);
    assert.equal(receipt.activities.filter((a) => a.action === 'reminder.created').length, sessions);

    const exam = (await me.agent.get('/api/tasks?kind=deadline&q=DBMS exam')).body.tasks;
    assert.equal(exam.length, 1);
    const plan = (await me.agent.get('/api/tasks?tag=study-plan')).body.tasks;
    assert.equal(plan.at(-1).title, 'DBMS: Revision and practice questions');

    let second;
    useProvider([
      use('make_study_plan', { subject: 'DBMS', examAt }),
      (params) => {
        second = toolResults(params)[0];
        return say('[face:thinking] Plan pehle se hai.');
      },
    ]);
    await chat(me, 'DBMS plan bana do');
    assert.equal(second.is_error, true);
    assert.match(second.content, /already exists/);
    assert.match(second.content, /replace: true/, 'the error tells the model how to change the plan');
  });

  it('changing a study plan replaces its upcoming sessions and reminders instead of adding a second plan', async () => {
    const examAt = daysFromNow(6);
    useProvider([use('make_study_plan', { subject: 'OS', examAt, topics: ['Processes', 'Scheduling'], studyTime: '18:00' }), say('[face:happy] Ban gaya.')]);
    await chat(me, 'OS exam ka plan bana do');
    const before = (await me.agent.get('/api/tasks?tag=study-plan&q=OS:')).body.tasks;
    assert.ok(before.length >= 4);

    useProvider([
      use('make_study_plan', { subject: 'OS', examAt, topics: ['Deadlocks', 'Memory', 'Paging'], studyTime: '19:00', replace: true }),
      say('[face:happy] Plan update ho gaya.'),
    ]);
    const res = await chat(me, 'topics badal do: deadlocks, memory, paging. roz 7 baje');
    const [receipt] = events(res, 'receipt');
    assert.match(receipt.summary, new RegExp(`updated: \\d+ new sessions with reminders \\(replaced ${before.length} old ones\\)`));
    assert.equal(receipt.activities.filter((a) => a.action === 'task.deleted').length, before.length);
    assert.equal(receipt.activities.filter((a) => a.action === 'reminder.cancelled').length, before.length);

    // Only the new plan is left: one session a day, all at 7 PM, and the old reminders are cancelled.
    const after = (await me.agent.get('/api/tasks?tag=study-plan&q=OS:')).body.tasks;
    assert.equal(after.length, receipt.activities.filter((a) => a.action === 'task.created').length, 'only the new sessions (the exam is reused)');
    const istMinutes = (iso) => (new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes() + 330) % 1440;
    assert.ok(after.every((t) => istMinutes(t.dueAt) === 19 * 60), 'all sessions at 19:00 IST');
    assert.equal(after.filter((t) => t.title.includes('Processes')).length, 0);
    const reminders = (await me.agent.get('/api/reminders?limit=100')).body.reminders.filter((r) => r.text.startsWith('OS study time'));
    assert.equal(reminders.filter((r) => r.status === 'scheduled').length, after.length);
    assert.equal((await me.agent.get('/api/tasks?kind=deadline&q=OS exam')).body.tasks.length, 1, 'the exam deadline is reused');
  });

  it('saves a day plan that shows on the Today panel, and rejects overlapping slots', async () => {
    let bad;
    useProvider([
      use('plan_my_day', { slots: [{ start: '10:00', end: '11:00', label: 'DBMS' }, { start: '10:30', end: '12:00', label: 'Gym' }] }),
      (params) => {
        bad = toolResults(params)[0];
        return use('plan_my_day', { slots: [{ start: '17:00', end: '18:00', label: 'DBMS revision' }, { start: '18:30', end: '19:00', label: 'Gym' }] });
      },
      say('[face:happy] Din set hai.'),
    ]);
    await chat(me, 'aaj ka din plan karo');
    assert.equal(bad.is_error, true);
    assert.match(bad.content, /overlap/);
    const today = (await me.agent.get('/api/me/today')).body;
    assert.deepEqual(today.dayPlan.slots.map((s) => s.label), ['DBMS revision', 'Gym']);
  });

  it('remembers facts and uses them in later turns; the user can list and delete memories', async () => {
    useProvider([use('remember_fact', { text: 'Classes are 9 AM to 4 PM on weekdays.', kind: 'routine' }), say('[face:happy] Yaad rahega!')]);
    const res = await chat(me, 'meri classes 9 se 4 hoti hain weekdays');
    assert.match(events(res, 'receipt')[0].summary, /Remembered/);

    const provider = useProvider([say('[face:happy] Haan yaad hai.')]);
    await chat(me, 'meri classes kab hoti hain?');
    const context = provider.calls[0].system[1].text;
    assert.match(context, /Classes are 9 AM to 4 PM on weekdays\./);

    // Earlier turns come back as plain history, with what the agent did.
    const history = provider.calls[0].messages;
    assert.equal(history[0].role, 'user');
    assert.ok(history.some((m) => m.role === 'assistant' && /<actions>Remembered: Classes/.test(m.content)));
    assert.equal(history.at(-1).content, 'meri classes kab hoti hain?');

    const memories = (await me.agent.get('/api/agent/memories')).body.memories;
    const memory = memories.find((m) => m.kind === 'routine');
    assert.equal((await other.agent.delete(`/api/agent/memories/${memory.id}`)).status, 404);
    assert.equal((await me.agent.delete(`/api/agent/memories/${memory.id}`)).status, 204);
  });

  it('undo_last_action reverts the latest change', async () => {
    const task = (await me.agent.post('/api/tasks').send({ title: 'Wrong task' })).body.task;
    useProvider([use('undo_last_action', {}), say('[face:sorry] Hata diya.')]);
    const res = await chat(me, 'galti ho gayi, undo karo');
    assert.match(events(res, 'receipt')[0].summary, /Undid: Created task "Wrong task"/);
    assert.equal((await me.agent.get(`/api/tasks/${task.id}`)).status, 404);
  });

  it('stops after the step limit: the last call may not use tools, so the turn always ends', async () => {
    const provider = useProvider([
      (params) => (params.tool_choice?.type === 'none' ? say('[face:thinking] Bas, itna kaafi hai.') : use('get_today', {})),
    ]);
    const res = await chat(me, 'kuch bhi');
    assert.equal(provider.calls.length, MAX_STEPS);
    assert.equal(provider.calls.at(-1).tool_choice.type, 'none');
    assert.equal(replyText(res), 'Bas, itna kaafi hai.');
  });

  it('retries a failed stream and tells the client to drop the half-written text', async () => {
    let attempt = 0;
    const provider = useProvider([]);
    provider.send = async (params, { onText }) => {
      attempt++;
      if (attempt === 1) {
        onText('[face:happy] Half writ');
        throw httpError(529);
      }
      onText('[face:happy] Full answer.');
      return { model: params.model, stop_reason: 'end_turn', content: [{ type: 'text', text: '[face:happy] Full answer.' }], usage: {} };
    };
    const res = await chat(me, 'hello');
    assert.deepEqual(events(res, 'reset'), [{ text: '' }]);
    assert.equal(events(res, 'done')[0].message.text, 'Full answer.');
  });

  it('when the AI is down, the user gets a friendly error event and the app keeps working', async () => {
    useProvider([httpError(500)]);
    const res = await chat(me, 'hello?');
    assert.equal(res.status, 200);
    const [error] = events(res, 'error');
    assert.equal(error.code, 'AI_UNAVAILABLE');
    assert.ok(error.message.length > 10);
    const done = events(res, 'done')[0].message;
    assert.equal(done.status, 'failed');
    assert.equal(done.expression, 'sorry');
    assert.equal((await me.agent.get('/api/me/today')).status, 200);

    // Failed replies are not sent back to the model as history: the two user messages are joined.
    const provider = useProvider([say('[face:happy] Wapas aa gaya!')]);
    await chat(me, 'ab?');
    assert.equal(provider.calls[0].messages.at(-1).content, 'hello?\n\nab?');
  });

  it('when every model is at its app-wide limit, new messages get a friendly Hinglish message; a started message still finishes', async () => {
    const { RateCounter } = await import('../src/models/RateCounter.js');
    await RateCounter.deleteMany({ _id: /^ai:model:only-model:/ });
    const provider = fakeProvider([use('list_tasks', {}), say('[face:happy] Sab clear hai!'), say('[face:happy] never sent')]);
    const limits = { perUserPerMinute: 10_000, perUserPerDay: 10_000, models: ['only-model'], modelLimits: { 'only-model': { perMinute: 0, perDay: 1 } } };
    setAiForTests({ provider, gateway: createAiGateway({ retryOptions: { baseMs: 1, maxMs: 2 }, ...limits }) });

    const first = await chat(other, 'aaj kya hai?');
    assert.equal(replyText(first), 'Sab clear hai!', 'the second request of a message that already started still runs');

    const second = await chat(other, 'aur kuch?');
    const [error] = events(second, 'error');
    assert.equal(error.code, 'AI_DAILY_LIMIT');
    assert.match(error.message, /Kal phir baat karte hain/);
    assert.equal(provider.calls.length, 2, 'nothing more was sent to the provider');
    assert.equal((await other.agent.post('/api/tasks').send({ title: 'Works without AI' })).status, 201);
  });

  it('a firing reminder gets a line written by Saathi; without the AI it still fires with the plain text', async () => {
    const { fireReminder } = await import('../src/jobs/handlers/reminder.js');
    const { Job } = await import('../src/models/Job.js');
    const { Notification } = await import('../src/models/Notification.js');
    const makeDueReminder = async (text) => {
      const at = new Date(Date.now() + 60 * 60_000).toISOString();
      const res = await me.agent.post('/api/reminders').send({ text, remindAt: at });
      assert.equal(res.status, 201);
      return Job.findOne({ type: 'reminder.fire', 'payload.reminderId': res.body.reminder.id }).lean();
    };

    const provider = useProvider([say('[face:excited] Himanshu! Lab file ka time ho gaya, bas 10 minute mein khatam kar!')]);
    const job = await makeDueReminder('Lab file submit karna');
    assert.deepEqual(await fireReminder(job.payload), { fired: true, aiLine: true });
    const n = await Notification.findOne({ refId: job.payload.reminderId }).lean();
    assert.equal(n.title, 'Lab file submit karna', 'the title stays the user\'s own words');
    assert.equal(n.body, 'Himanshu! Lab file ka time ho gaya, bas 10 minute mein khatam kar!');
    assert.equal(n.expression, 'excited');
    assert.match(provider.calls[0].messages[0].content, /Lab file submit karna/);
    assert.equal(provider.calls[0].tools, undefined, 'no tools for a reminder line');

    // The AI is down: the reminder is not lost or late, it goes out as plain text.
    useProvider([httpError(500), httpError(500), httpError(500)]);
    const job2 = await makeDueReminder('Paani peena');
    assert.deepEqual(await fireReminder(job2.payload), { fired: true, aiLine: false });
    const plain = await Notification.findOne({ refId: job2.payload.reminderId }).lean();
    assert.equal(plain.title, 'Paani peena');
    assert.equal(plain.body, '');
  });

  it('keeps conversations private', async () => {
    useProvider([say('[face:happy] hi')]);
    const mine = (await me.agent.get('/api/agent/conversations')).body.conversations[0];
    assert.equal((await other.agent.get(`/api/agent/conversations/${mine.id}/messages`)).status, 404);
    assert.equal((await chat(other, 'hi', { conversationId: mine.id })).status, 404);
    const msgs = (await me.agent.get(`/api/agent/conversations/${mine.id}/messages?limit=5`)).body.messages;
    assert.equal(msgs.length, 5);
  });

  it('greets with a generated line and caches it for a few minutes', async () => {
    const provider = useProvider([say('[face:sleepy] Itni raat ko jaag rahe ho, Himanshu?')]);
    const first = await other.agent.get('/api/agent/greeting');
    assert.deepEqual({ text: first.body.text, expression: first.body.expression }, { text: 'Itni raat ko jaag rahe ho, Himanshu?', expression: 'sleepy' });
    await other.agent.get('/api/agent/greeting');
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].tools, undefined, 'the greeting does not use tools');
  });

  it('summarises older messages in the background and sends the summary instead', async () => {
    const { Conversation } = await import('../src/models/Conversation.js');
    const { Message } = await import('../src/models/Message.js');
    const { summarizeConversation } = await import('../src/services/agent.service.js');
    const fresh = await loggedInAgent(app, { name: 'Long Talker' });
    useProvider([say('[face:happy] ok')]);
    await chat(fresh, 'first');
    const conv = (await fresh.agent.get('/api/agent/conversations')).body.conversations[0];
    const base = Date.now() - 60 * 60_000;
    await Message.insertMany(
      Array.from({ length: 40 }, (_, i) => ({ userId: fresh.user.id, conversationId: conv.id, role: i % 2 ? 'assistant' : 'user', text: `old message ${i}`, createdAt: new Date(base + i * 1000) })),
      { timestamps: false },
    );

    useProvider([say('He is preparing for DBMS and likes evening study.')]);
    const out = await summarizeConversation(conv.id);
    assert.equal(out.saved, true);
    const saved = await Conversation.findById(conv.id).lean();
    assert.match(saved.summary, /DBMS/);

    const provider = useProvider([say('[face:happy] haan')]);
    await chat(fresh, 'yaad hai?');
    assert.match(provider.calls[0].system[1].text, /Earlier in your conversation \(summary\)\nHe is preparing for DBMS/);
    assert.ok(provider.calls[0].messages.length <= 21);
  });
});
