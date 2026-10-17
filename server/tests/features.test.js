// Integration tests for Step 2: tasks, notes, reminders, notifications, Today panel, Undo.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 60 * 60_000).toISOString();

describe('Step 2 features', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let me; // { agent, user }
  let other;
  let Job;
  let fireReminder;

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    app = createApp();
    me = await loggedInAgent(app, { name: 'Himanshu' });
    other = await loggedInAgent(app, { name: 'Someone Else' });
    ({ Job } = await import('../src/models/Job.js'));
    ({ fireReminder } = await import('../src/jobs/handlers/reminder.js'));
  });

  after(teardownDb);

  describe('tasks', () => {
    it('creates, lists, updates, completes and deletes a task', async () => {
      const created = await me.agent.post('/api/tasks').send({ title: 'Submit DBMS lab file', dueAt: inMinutes(120), priority: 'high', tags: ['College', 'college'] });
      assert.equal(created.status, 201);
      const t = created.body.task;
      assert.deepEqual(t.tags, ['college'], 'tags are normalised and de-duplicated');

      const listed = await me.agent.get('/api/tasks');
      assert.ok(listed.body.tasks.some((x) => x.id === t.id));

      const updated = await me.agent.patch(`/api/tasks/${t.id}`).send({ title: 'Submit DBMS lab file (final)' });
      assert.equal(updated.body.task.title, 'Submit DBMS lab file (final)');

      const done = await me.agent.post(`/api/tasks/${t.id}/complete`);
      assert.equal(done.body.task.status, 'done');
      assert.ok(done.body.task.completedAt);

      const again = await me.agent.post(`/api/tasks/${t.id}/complete`);
      assert.equal(again.status, 200, 'completing twice is harmless');

      assert.equal((await me.agent.delete(`/api/tasks/${t.id}`)).status, 204);
      assert.equal((await me.agent.get(`/api/tasks/${t.id}`)).status, 404);
    });

    it('validates input with field-level messages', async () => {
      const res = await me.agent.post('/api/tasks').send({ title: '', priority: 'urgent', dueAt: '2026-10-18 09:00' });
      assert.equal(res.status, 400);
      const fields = res.body.error.details.map((d) => d.field);
      assert.ok(fields.includes('title'));
      assert.ok(fields.includes('priority'));
      assert.ok(fields.includes('dueAt'), 'dates without a timezone are rejected');
    });

    it("never shows or changes another user's tasks", async () => {
      const mine = (await me.agent.post('/api/tasks').send({ title: 'Private task' })).body.task;
      assert.equal((await other.agent.get(`/api/tasks/${mine.id}`)).status, 404);
      assert.equal((await other.agent.patch(`/api/tasks/${mine.id}`).send({ title: 'hacked' })).status, 404);
      assert.equal((await other.agent.delete(`/api/tasks/${mine.id}`)).status, 404);
      const theirs = await other.agent.get('/api/tasks');
      assert.ok(!theirs.body.tasks.some((x) => x.id === mine.id));
    });

    it('returns 404, not 500, for malformed ids', async () => {
      assert.equal((await me.agent.get('/api/tasks/not-an-id')).status, 400);
      assert.equal((await me.agent.get('/api/tasks/0123456789abcdef01234567')).status, 404);
    });

    it('filters by due date and search, and sorts tasks without a due date last', async () => {
      const a = (await me.agent.post('/api/tasks').send({ title: 'Overdue essay', dueAt: inMinutes(-60 * 30) })).body.task;
      const b = (await me.agent.post('/api/tasks').send({ title: 'No date chores' })).body.task;
      const c = (await me.agent.post('/api/tasks').send({ title: 'Future project', dueAt: daysFromNow(5) })).body.task;

      const overdue = await me.agent.get('/api/tasks?due=overdue');
      assert.ok(overdue.body.tasks.some((x) => x.id === a.id));
      assert.ok(!overdue.body.tasks.some((x) => x.id === c.id));

      const search = await me.agent.get('/api/tasks?q=essay');
      assert.deepEqual(search.body.tasks.map((x) => x.id), [a.id]);

      const sorted = (await me.agent.get('/api/tasks?sort=due')).body.tasks.map((x) => x.id);
      assert.ok(sorted.indexOf(a.id) < sorted.indexOf(c.id));
      assert.ok(sorted.indexOf(c.id) < sorted.indexOf(b.id), 'tasks without a due date come last');
    });

    it('Idempotency-Key makes a double-submitted create happen once', async () => {
      const send = () => me.agent.post('/api/tasks').set('Idempotency-Key', 'tap-123').send({ title: 'Buy notebook' });
      const first = await send();
      const second = await send();
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal(second.headers['idempotent-replayed'], 'true');
      assert.equal(second.body.task.id, first.body.task.id);
      const all = await me.agent.get('/api/tasks?q=Buy%20notebook');
      assert.equal(all.body.total, 1);

      const reused = await me.agent.post('/api/tasks').set('Idempotency-Key', 'tap-123').send({ title: 'Something else' });
      assert.equal(reused.status, 422);
    });
  });

  describe('undo', () => {
    const lastActivity = async () => (await me.agent.get('/api/me/activity?limit=1')).body.activity[0];

    it('undoes a create, a delete, an edit and a completion', async () => {
      const t = (await me.agent.post('/api/tasks').send({ title: 'Undo me' })).body.task;
      let act = await lastActivity();
      assert.equal(act.action, 'task.created');
      assert.equal(act.canUndo, true);
      assert.equal((await me.agent.post(`/api/me/activity/${act.id}/undo`)).status, 200);
      assert.equal((await me.agent.get(`/api/tasks/${t.id}`)).status, 404, 'undoing a create hides it');

      const t2 = (await me.agent.post('/api/tasks').send({ title: 'Keep me' })).body.task;
      await me.agent.delete(`/api/tasks/${t2.id}`);
      act = await lastActivity();
      await me.agent.post(`/api/me/activity/${act.id}/undo`);
      assert.equal((await me.agent.get(`/api/tasks/${t2.id}`)).status, 200, 'undoing a delete brings it back');

      await me.agent.patch(`/api/tasks/${t2.id}`).send({ title: 'Renamed' });
      act = await lastActivity();
      const undone = await me.agent.post(`/api/me/activity/${act.id}/undo`);
      assert.equal(undone.body.task.title, 'Keep me');

      await me.agent.post(`/api/tasks/${t2.id}/complete`);
      act = await lastActivity();
      const reopened = await me.agent.post(`/api/me/activity/${act.id}/undo`);
      assert.equal(reopened.body.task.status, 'open');
      assert.equal(reopened.body.task.completedAt, null);
    });

    it('refuses to undo twice, or after the item changed again', async () => {
      const t = (await me.agent.post('/api/tasks').send({ title: 'Version check' })).body.task;
      await me.agent.patch(`/api/tasks/${t.id}`).send({ title: 'v2' });
      const v2 = await lastActivity();
      await me.agent.patch(`/api/tasks/${t.id}`).send({ title: 'v3' });

      const stale = await me.agent.post(`/api/me/activity/${v2.id}/undo`);
      assert.equal(stale.status, 409, 'v3 came after, so undoing v2 would lose v3');

      const v3 = await lastActivity();
      assert.equal((await me.agent.post(`/api/me/activity/${v3.id}/undo`)).status, 200);
      assert.equal((await me.agent.post(`/api/me/activity/${v3.id}/undo`)).status, 409);
    });

    it("cannot undo another user's change", async () => {
      await me.agent.post('/api/tasks').send({ title: 'Mine to undo' });
      const act = await lastActivity();
      assert.equal((await other.agent.post(`/api/me/activity/${act.id}/undo`)).status, 404);
    });
  });

  describe('notes', () => {
    it('creates, searches, pins and deletes notes', async () => {
      const n = (await me.agent.post('/api/notes').send({ body: 'Normalization: 1NF, 2NF, 3NF, BCNF', tags: ['dbms'] })).body.note;
      await me.agent.post('/api/notes').send({ title: 'Groceries', body: 'milk, eggs' });
      const found = await me.agent.get('/api/notes?q=bcnf');
      assert.deepEqual(found.body.notes.map((x) => x.id), [n.id]);

      await me.agent.patch(`/api/notes/${n.id}`).send({ pinned: true });
      const list = await me.agent.get('/api/notes');
      assert.equal(list.body.notes[0].id, n.id, 'pinned notes come first');

      assert.equal((await me.agent.post('/api/notes').send({ body: '   ' })).status, 400);
      assert.equal((await other.agent.get(`/api/notes/${n.id}`)).status, 404);
      assert.equal((await me.agent.delete(`/api/notes/${n.id}`)).status, 204);
    });
  });

  describe('reminders', () => {
    it('rejects times in the past or too far ahead', async () => {
      assert.equal((await me.agent.post('/api/reminders').send({ text: 'Too late', remindAt: inMinutes(-10) })).status, 400);
      assert.equal((await me.agent.post('/api/reminders').send({ text: 'Too far', remindAt: daysFromNow(400) })).status, 400);
    });

    it('schedules a job, and a duplicate reminder is not created twice', async () => {
      const at = inMinutes(30);
      const a = await me.agent.post('/api/reminders').send({ text: 'Call didi', remindAt: at });
      const b = await me.agent.post('/api/reminders').send({ text: 'Call didi', remindAt: at });
      assert.equal(a.status, 201);
      assert.equal(b.status, 200);
      assert.equal(b.body.duplicate, true);
      assert.equal(b.body.reminder.id, a.body.reminder.id);
      const jobs = await Job.countDocuments({ type: 'reminder.fire', 'payload.reminderId': a.body.reminder.id });
      assert.equal(jobs, 1);
    });

    it('fires exactly once and creates one notification, even if the job runs twice', async () => {
      const r = (await me.agent.post('/api/reminders').send({ text: 'Drink water', remindAt: inMinutes(1) })).body.reminder;
      const job = await Job.findOne({ 'payload.reminderId': r.id }).lean();

      assert.deepEqual(await fireReminder(job.payload), { fired: true });
      assert.deepEqual(await fireReminder(job.payload), { skipped: 'sent' });

      const n = await me.agent.get('/api/me/notifications?unread=true');
      assert.equal(n.body.notifications.filter((x) => x.refId === r.id).length, 1);
      assert.equal((await me.agent.get(`/api/reminders/${r.id}`)).body.reminder.status, 'sent');
    });

    it('snooze moves the reminder and makes the old job a no-op', async () => {
      const r = (await me.agent.post('/api/reminders').send({ text: 'Study OS', remindAt: inMinutes(2) })).body.reminder;
      const oldJob = await Job.findOne({ 'payload.reminderId': r.id }).lean();

      const snoozed = await me.agent.post(`/api/reminders/${r.id}/snooze`).send({ minutes: 10 });
      assert.equal(snoozed.status, 200);
      assert.equal(snoozed.body.reminder.snoozeCount, 1);
      assert.ok(new Date(snoozed.body.reminder.remindAt) > new Date(r.remindAt));

      assert.deepEqual(await fireReminder(oldJob.payload), { skipped: 'rescheduled' });
      assert.equal(await Job.countDocuments({ 'payload.reminderId': r.id }), 2, 'a new job for the new time');

      assert.equal((await me.agent.post(`/api/reminders/${r.id}/snooze`).send({ minutes: 5, until: inMinutes(60) })).status, 400);
    });

    it('a cancelled reminder never fires, and undo brings it back on schedule', async () => {
      const r = (await me.agent.post('/api/reminders').send({ text: 'Gym', remindAt: inMinutes(45) })).body.reminder;
      const job = await Job.findOne({ 'payload.reminderId': r.id }).lean();
      assert.equal((await me.agent.delete(`/api/reminders/${r.id}`)).status, 204);
      assert.deepEqual(await fireReminder(job.payload), { skipped: 'cancelled' });

      const act = (await me.agent.get('/api/me/activity?limit=1')).body.activity[0];
      assert.equal(act.action, 'reminder.cancelled');
      const restored = await me.agent.post(`/api/me/activity/${act.id}/undo`);
      assert.equal(restored.body.reminder.status, 'scheduled');
      assert.deepEqual(await fireReminder(job.payload), { fired: true });
    });

    it('marks notifications read', async () => {
      const list = await me.agent.get('/api/me/notifications');
      const id = list.body.notifications[0].id;
      const read = await me.agent.post(`/api/me/notifications/${id}/read`);
      assert.ok(read.body.notification.readAt);
      await me.agent.post('/api/me/notifications/read-all');
      assert.equal((await me.agent.get('/api/me/notifications')).body.unreadCount, 0);
      assert.equal((await other.agent.post(`/api/me/notifications/${id}/read`)).status, 404);
    });
  });

  describe('my day', () => {
    it('Today panel shows due, overdue, reminders and deadline countdowns', async () => {
      const exam = (await me.agent.post('/api/tasks').send({ title: 'DBMS exam', kind: 'deadline', dueAt: daysFromNow(3) })).body.task;
      const today = await me.agent.get('/api/me/today');
      assert.equal(today.status, 200);
      assert.equal(today.body.user.name, 'Himanshu');
      assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(today.body.partOfDay));
      const countdown = today.body.countdowns.find((c) => c.id === exam.id);
      assert.ok(countdown, 'deadline appears as a countdown');
      assert.ok(countdown.daysLeft === 3 || countdown.daysLeft === 2, 'about 3 days left');
      assert.ok(today.body.counts.overdue >= 1);
      assert.ok(today.body.upcomingReminders.length >= 1);
    });

    it('weekly progress counts completions per day and the streak', async () => {
      const t = (await me.agent.post('/api/tasks').send({ title: 'Quick win' })).body.task;
      await me.agent.post(`/api/tasks/${t.id}/complete`);
      const p = await me.agent.get('/api/me/progress');
      assert.equal(p.body.series.length, 14);
      assert.ok(p.body.series.at(-1).completed >= 1);
      assert.ok(p.body.thisWeek >= 1);
      assert.ok(p.body.streak >= 1);
    });

    it('typing hints find related open tasks without calling the AI', async () => {
      await me.agent.post('/api/tasks').send({ title: 'Lab file for networks' });
      await me.agent.post('/api/tasks').send({ title: 'Print lab file cover' });
      const h = await me.agent.get('/api/me/hints').query({ q: 'kal lab file submit karna hai' });
      assert.ok(h.body.total >= 2);
      assert.ok(h.body.words.includes('lab'));
      const none = await me.agent.get('/api/me/hints').query({ q: 'ok' });
      assert.equal(none.body.total, 0);
    });
  });
});
