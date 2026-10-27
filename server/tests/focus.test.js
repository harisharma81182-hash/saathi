// The custom focus timer: any length, one at a time, pause/resume/+5/finish/cancel, the server-side
// "time up" job with its notification and buttons, focus minutes, the activity timeline, and Saathi's tool.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

describe('focus timer', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app, User, Notification, FocusSession, Task, focus, alerts, TOOLS_BY_NAME;

  async function newUser(name = 'Hari') {
    const me = await loggedInAgent(app, { name });
    return { ...me, doc: await User.findById(me.user.id).lean() };
  }

  before(async () => {
    await setupDb();
    app = (await import('../src/app.js')).createApp();
    ({ User } = await import('../src/models/User.js'));
    ({ Notification } = await import('../src/models/Notification.js'));
    ({ FocusSession } = await import('../src/models/FocusSession.js'));
    ({ Task } = await import('../src/models/Task.js'));
    focus = await import('../src/services/focus.service.js');
    alerts = await import('../src/services/alerts.service.js');
    ({ TOOLS_BY_NAME } = await import('../src/ai/tools.js'));
  });
  after(teardownDb);

  it('"+5 min" can never take a timer past 12 hours in total', async () => {
    const me = await newUser();
    const f = (await me.agent.post('/api/focus').send({ minutes: 715, label: 'Long study' })).body.focus;
    const ok = await me.agent.post(`/api/focus/${f.id}/extend`).send({ minutes: 5 });
    assert.equal(ok.status, 200);
    const tooLong = await me.agent.post(`/api/focus/${f.id}/extend`).send({ minutes: 5 });
    assert.equal(tooLong.status, 400);
    await me.agent.post(`/api/focus/${f.id}/cancel`);
  });

  it('"Ho gaya" on a notification skips a task deleted since, and still completes the others', async () => {
    const me = await newUser();
    const a = (await me.agent.post('/api/tasks').send({ title: 'Task A' })).body.task;
    const b = (await me.agent.post('/api/tasks').send({ title: 'Task B' })).body.task;
    await me.agent.delete(`/api/tasks/${a.id}`);
    const both = await Notification.create({ userId: me.doc._id, kind: 'due_now', title: 'Do kaam', data: { taskIds: [a.id, b.id] } });
    const res = await me.agent.post('/api/push/action').send({ notificationId: String(both._id), action: 'done' });
    assert.equal(res.status, 200);
    assert.equal((await Task.findById(b.id).lean()).status, 'done');
    const onlyGone = await Notification.create({ userId: me.doc._id, kind: 'due_now', title: 'Ek kaam', data: { taskIds: [a.id] } });
    const gone = await me.agent.post('/api/push/action').send({ notificationId: String(onlyGone._id), action: 'done' });
    assert.equal(gone.status, 404);
  });

  it('runs a custom-length timer on a task: one at a time, pause, resume, +5 min, then done', async () => {
    const me = await newUser();
    const task = (await me.agent.post('/api/tasks').send({ title: 'DBMS assignment' })).body.task;

    assert.equal((await me.agent.post('/api/focus').send({ minutes: 0, label: 'x' })).status, 400);
    assert.equal((await me.agent.post('/api/focus').send({ minutes: 721, label: 'x' })).status, 400, 'at most 12 hours');
    assert.equal((await me.agent.post('/api/focus').send({ minutes: 30 })).status, 400, 'needs a task or a label');

    const started = await me.agent.post('/api/focus').send({ minutes: 150, taskId: task.id });
    assert.equal(started.status, 201);
    const f = started.body.focus;
    assert.equal(f.label, 'DBMS assignment', 'the label comes from the task');
    assert.ok(f.remainingMs > 149 * 60_000 && f.remainingMs <= 150 * 60_000);
    assert.equal((await me.agent.post('/api/focus').send({ minutes: 10, label: 'Another' })).status, 409, 'one timer at a time');
    assert.equal((await me.agent.get('/api/focus/current')).body.focus.id, f.id, 'survives a refresh');

    const paused = (await me.agent.post(`/api/focus/${f.id}/pause`)).body.focus;
    assert.equal(paused.status, 'paused');
    assert.equal(paused.endsAt, null);
    assert.equal((await me.agent.post(`/api/focus/${f.id}/pause`)).status, 409);
    const resumed = (await me.agent.post(`/api/focus/${f.id}/resume`)).body.focus;
    assert.equal(resumed.status, 'running');
    const extended = (await me.agent.post(`/api/focus/${f.id}/extend`).send({ minutes: 5 })).body.focus;
    assert.ok(extended.remainingMs > resumed.remainingMs + 4 * 60_000, '+5 minutes');
    assert.equal(extended.plannedMs, 155 * 60_000);

    const other = await newUser('Other');
    assert.equal((await other.agent.post(`/api/focus/${f.id}/pause`)).status, 404, "nobody else's timer");

    const done = await me.agent.post(`/api/focus/${f.id}/finish`).send({ done: true });
    assert.equal(done.status, 200);
    assert.equal(done.body.focus.status, 'completed');
    assert.equal(done.body.message, null, 'no AI in tests: the app shows its own celebration line');
    assert.equal((await Task.findById(task.id).lean()).status, 'done', 'Khatam also completes the task');
    assert.equal((await me.agent.get('/api/focus/current')).body.focus, null);
    assert.equal((await me.agent.post(`/api/focus/${f.id}/finish`).send({})).status, 409, 'already ended');
  });

  it('time up: the job notifies with buttons; "10 min aur" restarts it, "Ho gaya" finishes it', async () => {
    const me = await newUser();
    const past = new Date(Date.now() - 31 * 60_000);
    const f = await focus.start(me.doc, { minutes: 30, label: 'OS revision' }, { now: past });
    const s = await FocusSession.findById(f.id).lean();

    assert.deepEqual(await focus.timeUp({ sessionId: f.id, endsAt: new Date(0).toISOString() }), { skipped: 'changed' }, 'an old job for another end time does nothing');
    assert.deepEqual(await focus.timeUp({ sessionId: f.id, endsAt: s.endsAt.toISOString() }), { timeUp: true });
    const after = await FocusSession.findById(f.id).lean();
    assert.equal(after.status, 'timeup');
    assert.equal(after.focusedMs, 30 * 60_000, 'counted up to the end time, not until now');

    const n = await Notification.findOne({ userId: me.doc._id, kind: 'timer' }).lean();
    assert.equal(n.title, 'Time pura: OS revision');
    assert.equal(n.data.sessionId, f.id);

    const more = await me.agent.post('/api/push/action').send({ notificationId: String(n._id), action: 'more' });
    assert.equal(more.status, 200);
    const running = (await me.agent.get('/api/focus/current')).body.focus;
    assert.equal(running.status, 'running');
    assert.ok(running.remainingMs > 9 * 60_000 && running.remainingMs <= 10 * 60_000);

    const done = await me.agent.post('/api/push/action').send({ notificationId: String(n._id), action: 'done' });
    assert.equal(done.body.message, 'Kamaal kar diya, ho gaya!');
    assert.equal((await FocusSession.findById(f.id).lean()).status, 'completed');
  });

  it('counts focus minutes for today and shows finished sessions in the activity timeline (no Undo)', async () => {
    const me = await newUser();
    const f = await focus.start(me.doc, { minutes: 60, label: 'Maths practice' }, { now: new Date(Date.now() - 20 * 60_000) });
    await focus.finish(me.doc, f.id, { done: true });

    const today = (await me.agent.get('/api/me/today')).body;
    assert.equal(today.focus.todayMinutes, 20);
    assert.equal((await me.agent.get('/api/me/progress')).body.focus.weekMinutes, 20);

    const act = (await me.agent.get('/api/me/activity?limit=5')).body.activity.find((a) => a.entityType === 'focus');
    assert.match(act.summary, /Focused 20 min on "Maths practice"/);
    assert.equal(act.canUndo, false);
    assert.equal((await me.agent.post(`/api/me/activity/${act.id}/undo`)).status, 400);
  });

  it('Saathi can start one from chat ("2 ghante 30 minute"), replacing a running timer only when asked', async () => {
    const me = await newUser();
    const tool = TOOLS_BY_NAME.get('start_focus_timer');
    const first = await tool.run({ user: me.doc }, { minutes: 150, label: 'Project report' });
    assert.equal(first.summary, 'Focus timer: 2h 30m for "Project report"');
    await assert.rejects(tool.run({ user: me.doc }, { minutes: 25, label: 'Reading' }), /already running/);
    const second = await tool.run({ user: me.doc }, { minutes: 25, label: 'Reading', replace: true });
    assert.equal(second.data.label, 'Reading');
    assert.equal(await FocusSession.countDocuments({ userId: me.doc._id, status: 'cancelled' }), 1);
    assert.equal((await FocusSession.findOne({ userId: me.doc._id, status: 'running' }).lean()).source, 'agent');
  });
});
