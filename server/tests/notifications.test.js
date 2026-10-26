// Notifications on every device: push subscriptions, delivery (push, email fallback, quiet hours),
// the new alerts (due soon / due now, morning plan, countdowns, achievements) and notification buttons.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { hasTestDb, setupDb, teardownDb, loggedInAgent } from './helpers.js';

describe('notifications everywhere', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let app;
  let User, Notification, PushSubscription, Task, Reminder;
  let notifications, delivery, alerts, push, mail;
  const pushed = []; // what the fake push service received
  const gone = new Set(); // endpoints the fake push service reports as expired (410)
  const outbox = [];

  const device = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BPk3w8yS-fake-p256dh-key-value', auth: 'fake-auth-secret' } });
  // 12:00 and 23:30 in India on a fixed day (the users below are on Asia/Kolkata).
  const noonIst = DateTime.fromISO('2026-11-10T12:00', { zone: 'Asia/Kolkata' }).toJSDate();
  const lateIst = DateTime.fromISO('2026-11-10T23:30', { zone: 'Asia/Kolkata' }).toJSDate();

  async function newUser(name = 'Hari') {
    const me = await loggedInAgent(app, { name });
    return { ...me, doc: await User.findById(me.user.id).lean() };
  }
  const note = (user, kind, extra = {}) => notifications.create({ userId: user._id, kind, title: `A ${kind}`, body: 'Chal jaldi nipta de!', ...extra });

  before(async () => {
    await setupDb();
    app = (await import('../src/app.js')).createApp();
    ({ User } = await import('../src/models/User.js'));
    ({ Notification } = await import('../src/models/Notification.js'));
    ({ PushSubscription } = await import('../src/models/PushSubscription.js'));
    ({ Task } = await import('../src/models/Task.js'));
    ({ Reminder } = await import('../src/models/Reminder.js'));
    notifications = await import('../src/services/notification.service.js');
    delivery = await import('../src/services/delivery.service.js');
    alerts = await import('../src/services/alerts.service.js');
    push = await import('../src/services/push.service.js');
    mail = await import('../src/services/mail.service.js');
    push.setPushSenderForTests(async (sub, payload) => {
      if (gone.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
    mail.setOutboxForTests(outbox);
  });
  beforeEach(() => {
    pushed.length = 0;
    outbox.length = 0;
    gone.clear();
  });
  after(async () => {
    push.setPushSenderForTests(null);
    mail.setOutboxForTests(null);
    await teardownDb();
  });

  it('saves each device once, refuses bad input, and removes only your own', async () => {
    const me = await newUser();
    const other = await newUser('Other');
    assert.match((await me.agent.get('/api/push/key')).body.publicKey, /.+/);
    assert.equal((await me.agent.post('/api/push/subscribe').send(device('a'))).status, 201);
    assert.equal((await me.agent.post('/api/push/subscribe').send(device('a'))).status, 201, 'the same device again is fine');
    assert.equal((await me.agent.post('/api/push/subscribe').send(device('b'))).status, 201);
    assert.equal(await PushSubscription.countDocuments({ userId: me.doc._id }), 2);

    const bad = await me.agent.post('/api/push/subscribe').send({ endpoint: 'not a url', keys: {} });
    assert.equal(bad.status, 400);
    assert.equal((await other.agent.post('/api/push/unsubscribe').send({ endpoint: device('a').endpoint })).body.removed, 0, "someone else's device stays");
    assert.equal((await me.agent.post('/api/push/unsubscribe').send({ endpoint: device('a').endpoint })).body.removed, 1);
    const anon = (await import('supertest')).default(app);
    assert.equal((await anon.post('/api/push/subscribe').send(device('x'))).status, 401);
  });

  it('a reminder goes to every device with its emoji, page and buttons; an expired device is removed', async () => {
    const me = await newUser();
    await push.subscribe(me.doc._id, device('phone'));
    await push.subscribe(me.doc._id, device('laptop'));
    gone.add(device('laptop').endpoint);
    const { notification } = await note(me.doc, 'reminder', { title: 'Lab file submit', refType: 'reminder', data: { taskId: '6500000000000000000000aa' } });

    const result = await delivery.deliver(notification._id, { now: noonIst });
    assert.equal(result.push, 1);
    assert.equal(result.removedDevices, 1);
    assert.equal(await PushSubscription.countDocuments({ userId: me.doc._id }), 1, 'the expired device is gone');
    const p = pushed[0].payload;
    assert.equal(p.title, '⏰ Lab file submit');
    assert.equal(p.url, '/#/reminders');
    assert.deepEqual(p.actions.map((a) => a.action), ['done', 'snooze']);
    assert.equal(p.requireInteraction, true);
    assert.match(p.image, /^\/bg\/.+\.webp$/);
    assert.equal(outbox.length, 0, 'no email when push reached a device');

    assert.deepEqual(await delivery.deliver(notification._id, { now: noonIst }), { skipped: 'already delivered' });
    assert.equal(pushed.length, 1, 'never delivered twice');
  });

  it('with no device and the app closed, important ones come by email (styled), the rest only in the app', async () => {
    const me = await newUser();
    const r = await note(me.doc, 'reminder', { title: 'Lab file submit <now>' });
    assert.equal((await delivery.deliver(r.notification._id, { now: noonIst })).email, true);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, me.user.email);
    assert.equal(outbox[0].subject, '⏰ Lab file submit <now>');
    assert.match(outbox[0].html, /Saathi kholo/);
    assert.match(outbox[0].html, /Lab file submit &lt;now&gt;/, 'user text is escaped in the email');

    const a = await note(me.doc, 'achievement');
    assert.equal((await delivery.deliver(a.notification._id, { now: noonIst })).email, false, 'achievements are never emailed');
    assert.equal(outbox.length, 1);
  });

  it('no email while Saathi is open; quiet hours hold back everything except reminders', async () => {
    const me = await newUser();
    await User.updateOne({ _id: me.doc._id }, { $set: { onlineUntil: new Date(noonIst.getTime() + 60_000) } });
    const r = await note(me.doc, 'reminder');
    assert.equal((await delivery.deliver(r.notification._id, { now: noonIst })).email, false, 'the app is showing it already');

    const other = await newUser('Night owl');
    await push.subscribe(other.doc._id, device('night'));
    const nudge = await note(other.doc, 'nudge');
    const quiet = await delivery.deliver(nudge.notification._id, { now: lateIst });
    assert.equal(quiet.quiet, true);
    assert.equal(quiet.push, 0);
    const reminder = await note(other.doc, 'reminder');
    assert.equal((await delivery.deliver(reminder.notification._id, { now: lateIst })).push, 1, 'a reminder still rings at night');
  });

  it('tasks due in an hour and due now: grouped, sent once, none for a task whose own reminder rings', async () => {
    const me = await newUser();
    const now = new Date(Date.now() + 2 * 3600_000); // tasks below were created more than 10 minutes "ago"
    const at = (min) => new Date(now.getTime() + min * 60_000).toISOString();
    const mk = (title, dueAt) => me.agent.post('/api/tasks').send({ title, dueAt }).then((r) => r.body.task);
    await mk('OS assignment', at(50));
    await mk('DBMS notes', at(60));
    const late = await mk('Gym', at(-5));
    const covered = await mk('Lab file', at(-3));
    await me.agent.post('/api/reminders').send({ text: 'Lab file', remindAt: at(-3), taskId: covered.id });

    await alerts.dueScan({ now });
    const mine = await Notification.find({ userId: me.doc._id, kind: { $in: ['due_soon', 'due_now'] } }).lean();
    const soon = mine.filter((n) => n.kind === 'due_soon');
    const due = mine.filter((n) => n.kind === 'due_now');
    assert.equal(soon.length, 1, 'two tasks due in an hour -> one notification');
    assert.equal(soon[0].data.taskIds.length, 2);
    assert.match(soon[0].title, /2 kaam/);
    assert.equal(due.length, 1);
    assert.deepEqual(due[0].data.taskIds, [late.id], 'the task with its own reminder at the due time is skipped');

    await alerts.dueScan({ now: new Date(now.getTime() + 60_000) });
    assert.equal(await Notification.countDocuments({ userId: me.doc._id, kind: { $in: ['due_soon', 'due_now'] } }), 2, 'each alert only once');

    // Moving the due time gives the task a fresh alert for the new time.
    await me.agent.patch(`/api/tasks/${late.id}`).send({ dueAt: at(40) });
    assert.equal((await Task.findById(late.id).lean()).alertedDueAt, null);
  });

  it('morning plan and deadline countdowns once a day, in plain text when the AI is off', async () => {
    const me = await newUser();
    const day = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).startOf('day');
    const morningAt = day.set({ hour: 8 }).toJSDate();
    await me.agent.post('/api/tasks').send({ title: 'Read OS chapter 4', dueAt: day.set({ hour: 18 }).toISO() });
    await me.agent.post('/api/tasks').send({ title: 'DBMS exam', kind: 'deadline', dueAt: day.plus({ days: 3 }).set({ hour: 10 }).toISO() });

    assert.equal(await alerts.morning(me.doc, morningAt), true);
    assert.equal(await alerts.morning(me.doc, morningAt), false, 'once a day');
    const m = await Notification.findOne({ userId: me.doc._id, kind: 'morning' }).lean();
    assert.match(m.title, /Aaj ka din: 1 kaam/);
    assert.match(m.body, /Read OS chapter 4/);

    assert.equal(await alerts.countdown(me.doc, morningAt), true);
    const c = await Notification.findOne({ userId: me.doc._id, kind: 'countdown' }).lean();
    assert.equal(c.title, 'DBMS exam: 3 din mein');
    assert.equal(await alerts.countdown(me.doc, day.plus({ days: 1 }).set({ hour: 8 }).toJSDate()), false, '2 days left: no message');
  });

  it('a weekly milestone is celebrated once', async () => {
    const me = await newUser();
    for (let i = 0; i < 5; i++) {
      const t = (await me.agent.post('/api/tasks').send({ title: `Practice set ${i}` })).body.task;
      await me.agent.post(`/api/tasks/${t.id}/complete`);
    }
    assert.equal((await alerts.checkAchievement(me.doc._id)).milestone, 'Is hafte 5 kaam done!');
    assert.equal((await alerts.checkAchievement(me.doc._id)).milestone, null, 'not twice');
  });

  it('notification buttons: "Ho gaya" completes the task, "10 min baad" snoozes; nobody else can press them', async () => {
    const me = await newUser();
    const other = await newUser('Other');
    const at = new Date(Date.now() + 3600_000).toISOString();
    const task = (await me.agent.post('/api/tasks').send({ title: 'Lab file', dueAt: at })).body.task;
    const rem = (await me.agent.post('/api/reminders').send({ text: 'Lab file', remindAt: at, taskId: task.id })).body.reminder;
    const { notification } = await note(me.doc, 'reminder', { refType: 'reminder', refId: rem.id, data: { taskId: task.id } });
    const id = String(notification._id);

    assert.equal((await other.agent.post('/api/push/action').send({ notificationId: id, action: 'done' })).status, 404);
    const snooze = await me.agent.post('/api/push/action').send({ notificationId: id, action: 'snooze' });
    assert.equal(snooze.status, 200);
    assert.ok(new Date((await Reminder.findById(rem.id).lean()).remindAt) < new Date(at), 'moved to 10 minutes from now');
    const done = await me.agent.post('/api/push/action').send({ notificationId: id, action: 'done' });
    assert.equal(done.body.message, 'Ho gaya, shabash!');
    assert.equal((await Task.findById(task.id).lean()).status, 'done');
    assert.ok((await Notification.findById(id).lean()).readAt);
    assert.equal((await me.agent.post('/api/push/action').send({ notificationId: id, action: 'explode' })).status, 400);
  });
});
