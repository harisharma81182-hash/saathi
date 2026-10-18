import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { DateTime } from 'luxon';

const { nextDueAt } = await import('../src/services/habit.service.js');
const TZ = 'Asia/Kolkata';

describe('habit schedule', () => {
  it('daily: the same time on the next day that is still ahead, skipping missed days', () => {
    const due = new Date('2026-10-18T12:30:00Z'); // Sun 18 Oct, 6:00 PM IST
    // Done early (same morning): tomorrow at 6 PM.
    assert.equal(nextDueAt({ every: 'day' }, due, TZ, new Date('2026-10-18T03:00:00Z')).toISOString(), '2026-10-19T12:30:00.000Z');
    // Done 3 days late, at 8 PM on the 21st: the 21st's 6 PM has passed, so the 22nd.
    assert.equal(nextDueAt({ every: 'day' }, due, TZ, new Date('2026-10-21T14:30:00Z')).toISOString(), '2026-10-22T12:30:00.000Z');
  });

  it('weekly: only on the chosen weekdays, or the weekday of the first due date', () => {
    const sunday = new Date('2026-10-18T12:30:00Z');
    const early = new Date('2026-10-18T03:00:00Z');
    // Mon and Thu: next is Mon 19th, then Thu 22nd.
    const mon = nextDueAt({ every: 'week', days: ['mon', 'thu'] }, sunday, TZ, early);
    assert.equal(mon.toISOString(), '2026-10-19T12:30:00.000Z');
    assert.equal(nextDueAt({ every: 'week', days: ['mon', 'thu'] }, mon, TZ, early).toISOString(), '2026-10-22T12:30:00.000Z');
    // No days given: every Sunday.
    assert.equal(nextDueAt({ every: 'week' }, sunday, TZ, early).toISOString(), '2026-10-25T12:30:00.000Z');
  });
});

describe('Step 4: habits (repeating tasks)', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let me;
  const inHours = (h) => new Date(Date.now() + h * 60 * 60_000).toISOString();

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    app = createApp();
    me = await loggedInAgent(app, { name: 'Himanshu' });
  });
  after(teardownDb);

  it('a repeating task needs a first due time', async () => {
    const res = await me.agent.post('/api/tasks').send({ title: 'Gym', repeat: { every: 'day' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /due time/);
  });

  it('completing a habit creates the next occurrence once; undo removes it again', async () => {
    const created = await me.agent.post('/api/tasks').send({ title: 'Gym', dueAt: inHours(1), repeat: { every: 'day' } });
    assert.equal(created.status, 201);
    const gym = created.body.task;
    assert.deepEqual(gym.repeat, { every: 'day' });
    assert.equal(gym.seriesId, gym.id);

    const done = await me.agent.post(`/api/tasks/${gym.id}/complete`);
    assert.equal(done.status, 200);
    const next = done.body.next;
    assert.equal(next.title, 'Gym');
    assert.equal(new Date(next.dueAt) - new Date(gym.dueAt), 24 * 60 * 60_000, 'same time tomorrow');
    assert.equal(next.seriesId, gym.id);

    // Completing again (double click) changes nothing.
    await me.agent.post(`/api/tasks/${gym.id}/complete`);
    let open = (await me.agent.get('/api/tasks?q=Gym')).body.tasks;
    assert.deepEqual(open.map((t) => t.id), [next.id]);

    // Undo the completion: the habit is open again and the untouched next occurrence is gone.
    const activity = (await me.agent.get('/api/me/activity')).body.activity;
    const completion = activity.find((a) => a.action === 'task.completed' && a.entityId === gym.id);
    assert.equal((await me.agent.post(`/api/me/activity/${completion.id}/undo`)).status, 200);
    open = (await me.agent.get('/api/tasks?q=Gym')).body.tasks;
    assert.deepEqual(open.map((t) => t.id), [gym.id]);

    // Completing it once more brings the same next occurrence back.
    const again = await me.agent.post(`/api/tasks/${gym.id}/complete`);
    assert.equal(again.body.next.id, next.id);
    open = (await me.agent.get('/api/tasks?q=Gym')).body.tasks;
    assert.deepEqual(open.map((t) => t.id), [next.id]);
  });

  it('two completions at the same moment still create only one next occurrence', async () => {
    const task = (await me.agent.post('/api/tasks').send({ title: 'Paani 3 litre', dueAt: inHours(2), repeat: { every: 'day' } })).body.task;
    const results = await Promise.all([1, 2, 3].map(() => me.agent.post(`/api/tasks/${task.id}/complete`)));
    assert.ok(results.every((r) => r.status === 200));
    const open = (await me.agent.get('/api/tasks?q=Paani')).body.tasks;
    assert.equal(open.length, 1);
    assert.notEqual(open[0].id, task.id);
  });

  it('shows habits with a streak of scheduled days done in a row', async () => {
    const { Task } = await import('../src/models/Task.js');
    const { User } = await import('../src/models/User.js');
    const user = await User.findById(me.user.id).lean();
    // Due today (in the user's timezone), whatever time the test runs.
    const todayAt = DateTime.now().setZone(TZ).startOf('day').plus({ minutes: 1 }).toISO();
    const today = (await me.agent.post('/api/tasks').send({ title: 'DSA practice', dueAt: todayAt, repeat: { every: 'day' } })).body.task;
    // Done yesterday and the day before (written directly: the tests cannot wait for days to pass).
    for (const daysAgo of [1, 2]) {
      await Task.create({
        userId: user._id,
        title: 'DSA practice',
        repeat: { every: 'day' },
        seriesId: today.id,
        dueAt: new Date(new Date(today.dueAt).getTime() - daysAgo * 24 * 60 * 60_000),
        status: 'done',
        completedAt: new Date(),
      });
    }
    let habit = (await me.agent.get('/api/tasks/habits')).body.habits.find((h) => h.title === 'DSA practice');
    assert.equal(habit.streak, 2, 'not doing it yet today does not break the streak');

    await me.agent.post(`/api/tasks/${today.id}/complete`);
    habit = (await me.agent.get('/api/tasks/habits')).body.habits.find((h) => h.title === 'DSA practice');
    assert.equal(habit.streak, 3);
    assert.notEqual(habit.id, today.id, 'the list shows the next open occurrence');

    const panel = (await me.agent.get('/api/me/today')).body;
    assert.ok(panel.habits.some((h) => h.title === 'DSA practice' && h.streak === 3));
  });
});
