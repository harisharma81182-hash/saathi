import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';

const TZ = 'Asia/Kolkata';
// A moment today in the user's timezone, e.g. at(15) = 3 PM today.
const at = (hour, minute = 0) => DateTime.now().setZone(TZ).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();

// A fake AI that writes the given lines, or fails.
function fakeAi(...lines) {
  const calls = [];
  return {
    calls,
    async send(params) {
      calls.push(params);
      const line = lines.shift();
      if (line instanceof Error || line === undefined) throw Object.assign(new Error('AI down'), { status: 500 });
      return { model: params.model, content: [{ type: 'text', text: line }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };
}

describe('Step 4: nudges and the evening recap', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let me;
  let user;
  let setAiForTests;
  let createAiGateway;
  let proactive;
  let Notification;
  let Message;

  const useAi = (...lines) => {
    const provider = fakeAi(...lines);
    setAiForTests({ provider, gateway: createAiGateway({ retries: 0, retryOptions: { baseMs: 1, maxMs: 2 } }) });
    return provider;
  };
  const addTask = async (body) => {
    const res = await me.agent.post('/api/tasks').send(body);
    assert.equal(res.status, 201);
    return res.body.task;
  };

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ setAiForTests } = await import('../src/ai/provider.js'));
    ({ createAiGateway } = await import('../src/ai/gateway.js'));
    proactive = await import('../src/services/proactive.service.js');
    ({ Notification } = await import('../src/models/Notification.js'));
    ({ Message } = await import('../src/models/Message.js'));
    me = await loggedInAgent(app, { name: 'Himanshu' });
    const { User } = await import('../src/models/User.js');
    user = await User.findById(me.user.id).lean();
  });
  beforeEach(() => setAiForTests());
  after(async () => {
    setAiForTests();
    await teardownDb();
  });

  it('queues one scan per 30-minute slot, however many instances ask', async () => {
    const { ensurePeriodicJobs, nextSlot } = await import('../src/jobs/periodic.js');
    const { Job } = await import('../src/models/Job.js');
    const now = new Date();
    await Promise.all([ensurePeriodicJobs(now), ensurePeriodicJobs(now), ensurePeriodicJobs(now)]);
    const jobs = await Job.find({ type: 'proactive.scan' }).lean();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].runAt.getTime(), nextSlot(30 * 60_000, now).getTime());
    assert.equal(jobs[0].runAt.getTime() % (30 * 60_000), 0, 'slots start on the hour and half hour');
  });

  it('nudges about overdue tasks in Saathi\'s words, once per task per day, at most twice a day', async () => {
    const lab = await addTask({ title: 'Lab file', dueAt: new Date(at(15).getTime() - 2 * 60 * 60_000).toISOString(), priority: 'high' });
    const provider = useAi('[face:concerned] Bhai, lab file ka kya hua? Abhi 20 min de de, ya kal subah ka reminder laga doon?');

    assert.equal(await proactive.nudge(user, at(15)), true);
    assert.match(provider.calls[0].messages[0].content, /Lab file/);
    const n = await Notification.findOne({ userId: user._id, kind: 'nudge' }).lean();
    assert.equal(n.body, 'Bhai, lab file ka kya hua? Abhi 20 min de de, ya kal subah ka reminder laga doon?');
    assert.equal(n.expression, 'concerned');
    assert.deepEqual(n.data.taskIds, [lab.id]);
    // Saathi's message also appears in the chat, as if a friend texted first.
    const msg = await Message.findOne({ userId: user._id, origin: 'nudge' }).lean();
    assert.equal(msg.role, 'assistant');

    // Same task, same day: no second nudge (and no AI call).
    assert.equal(await proactive.nudge(user, at(16)), false);
    assert.equal(provider.calls.length, 1);

    // A different overdue task: a second nudge is fine, a third one that day is not.
    await addTask({ title: 'DBMS assignment', dueAt: new Date(at(15).getTime() - 60 * 60_000).toISOString() });
    useAi('[face:thinking] DBMS assignment bhi pending hai yaar.');
    assert.equal(await proactive.nudge(user, at(17)), true);
    await addTask({ title: 'Email professor', dueAt: new Date(at(15).getTime() - 60 * 60_000).toISOString() });
    useAi('[face:happy] never sent');
    assert.equal(await proactive.nudge(user, at(18)), false);
  });

  it('never nudges at night, and gives the tasks back when the AI is down', async () => {
    const other = await loggedInAgent(app, { name: 'Night Owl' });
    await other.agent.post('/api/tasks').send({ title: 'Assignment', dueAt: new Date(at(12).getTime()).toISOString() });
    useAi('[face:happy] should not be sent');
    const scan = await proactive.runScan({ now: at(23, 30) });
    assert.equal(scan.nudges, 0);

    const { User } = await import('../src/models/User.js');
    const owl = await User.findById(other.user.id).lean();
    useAi(new Error('down'));
    await assert.rejects(proactive.nudge(owl, at(14)));
    const { Task } = await import('../src/models/Task.js');
    const task = await Task.findOne({ userId: owl._id, title: 'Assignment' }).lean();
    assert.equal(task.nudgedOn, null, 'a later scan can try again');
  });

  it('sends the evening recap once, only to users active today, and moves leftovers to tomorrow on request', async () => {
    const done = await addTask({ title: 'Read chapter 3', dueAt: at(10).toISOString() });
    await me.agent.post(`/api/tasks/${done.id}/complete`);
    const left = await addTask({ title: 'Solve 5 SQL questions', dueAt: at(19).toISOString() });
    const exam = await addTask({ title: 'OS exam', kind: 'deadline', dueAt: at(20).toISOString() });

    const provider = useAi('[face:proud] Aaj chapter 3 khatam, solid! SQL questions kal kar lena. Ab time pe so ja.');
    assert.equal(await proactive.recap(user, at(21, 15)), true);
    assert.match(provider.calls[0].messages[0].content, /Read chapter 3/);
    const n = await Notification.findOne({ userId: user._id, kind: 'recap' }).lean();
    assert.match(n.title, /1 done/);
    assert.ok(n.data.leftovers.includes(left.id));
    assert.ok(!n.data.leftovers.includes(exam.id), 'deadlines are not leftovers');
    assert.equal(await proactive.recap(user, at(22)), false, 'once a day');

    // Someone who did nothing today gets no recap.
    const quiet = await loggedInAgent(app, { name: 'Quiet' });
    const { User } = await import('../src/models/User.js');
    assert.equal(await proactive.recap(await User.findById(quiet.user.id).lean(), at(21, 15)), false);

    // The button: leftovers move to tomorrow at the same time; the exam stays; it can be undone.
    const moved = await me.agent.post('/api/me/leftovers/move-to-tomorrow');
    assert.equal(moved.status, 200);
    const sql = moved.body.moved.find((t) => t.id === left.id);
    assert.equal(new Date(sql.dueAt) - new Date(left.dueAt), 24 * 60 * 60_000);
    assert.ok(!moved.body.moved.some((t) => t.id === exam.id));
    const activity = (await me.agent.get('/api/me/activity')).body.activity;
    const move = activity.find((a) => a.entityId === left.id && a.action === 'task.updated');
    assert.equal((await me.agent.post(`/api/me/activity/${move.id}/undo`)).status, 200);
  });
});

describe('Step 4: quick add', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let me;
  let setAiForTests;
  let createAiGateway;

  const useAi = (...lines) => {
    const provider = fakeAi(...lines);
    setAiForTests({ provider, gateway: createAiGateway({ retries: 0, retryOptions: { baseMs: 1, maxMs: 2 }, perUserPerMinute: 1000, perUserPerDay: 1000 }) });
    return provider;
  };
  const parse = (text) => me.agent.post('/api/tasks/quick-parse').send({ text });

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ setAiForTests } = await import('../src/ai/provider.js'));
    ({ createAiGateway } = await import('../src/ai/gateway.js'));
    me = await loggedInAgent(app, { name: 'Himanshu' });
  });
  after(async () => {
    setAiForTests();
    await teardownDb();
  });

  it('turns a sentence into a task draft to preview, checked like a normal task', async () => {
    const tomorrow5pm = DateTime.now().setZone(TZ).plus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    const provider = useAi(
      '```json\n' + JSON.stringify({ title: 'DBMS assignment', dueAt: tomorrow5pm.toISO(), priority: 'high', kind: 'deadline', tags: ['dbms'], repeat: null }) + '\n```',
    );
    const res = await parse('kal 5 baje DBMS assignment, important');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'ai');
    assert.equal(res.body.draft.title, 'DBMS assignment');
    assert.equal(new Date(res.body.draft.dueAt).getTime(), tomorrow5pm.toMillis());
    assert.match(res.body.draft.dueAt, /\+05:30$/, 'shown in the user\'s time');
    assert.equal(res.body.draft.priority, 'high');
    assert.deepEqual(res.body.warnings, []);
    assert.match(provider.calls[0].system, /Asia\/Kolkata/, 'the model knows "now" and the timezone');
    // Nothing was saved: that happens only when the user confirms the preview.
    assert.equal((await me.agent.get('/api/tasks?q=DBMS')).body.tasks.length, 0);
  });

  it('falls back to a plain draft when the AI answers nonsense, is down, or is not connected', async () => {
    useAi('Sure! I would love to help you with that.');
    let res = await parse('gym jaana');
    assert.equal(res.body.source, 'plain');
    assert.equal(res.body.draft.title, 'gym jaana');
    assert.equal(res.body.warnings.length, 1);

    useAi(JSON.stringify({ title: '', dueAt: 'tomorrow' }));
    res = await parse('kuch bhi');
    assert.equal(res.body.source, 'plain', 'an invalid draft is not passed on');

    useAi(new Error('down'));
    res = await parse('notes likhna');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'plain');

    setAiForTests();
    res = await parse('notes likhna');
    assert.equal(res.body.source, 'plain');
  });

  it('rejects an empty sentence', async () => {
    const res = await parse('   ');
    assert.equal(res.status, 400);
  });
});
