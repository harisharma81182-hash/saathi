import { hasTestDb, setupDb, teardownDb } from './helpers.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Opens /api/me/events like a browser would and collects the events as they arrive.
function openEvents(base, cookie) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const ready = fetch(`${base}/api/me/events`, { headers: { Cookie: cookie }, signal: controller.signal }).then(async (res) => {
    if (res.status !== 200) {
      events.push({ event: 'http', data: { status: res.status } });
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) events.push({ event, data: JSON.parse(data) });
          for (const w of [...waiters]) w();
        }
      }
    } catch {
      // aborted by the test
    }
  });
  /** Resolves with the first event matching `test`, or fails after timeoutMs. */
  const waitFor = (test, timeoutMs = 6000) =>
    new Promise((resolve, reject) => {
      const check = () => {
        const found = events.find(test);
        if (found) {
          waiters.splice(waiters.indexOf(check), 1);
          clearTimeout(timer);
          resolve(found);
        }
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(check), 1);
        reject(new Error(`no matching event within ${timeoutMs} ms; got ${JSON.stringify(events.map((e) => e.event))}`));
      }, timeoutMs);
      waiters.push(check);
      check();
    });
  return { events, waitFor, ready, close: () => controller.abort() };
}

describe('Step 4: live updates', { skip: !hasTestDb && 'MONGODB_URI_TEST not set' }, () => {
  let server;
  let base;
  const streams = [];

  async function signup(name) {
    const res = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: `${name.toLowerCase()}${Date.now()}${Math.random()}@example.com`, password: 'secret123', timezone: 'Asia/Kolkata' }),
    });
    assert.equal(res.status, 201);
    const user = (await res.json()).user;
    return { user, cookie: res.headers.get('set-cookie').split(';')[0] };
  }

  const open = (cookie) => {
    const s = openEvents(base, cookie);
    streams.push(s);
    return s;
  };

  before(async () => {
    await setupDb();
    const { createApp } = await import('../src/app.js');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const s of streams) s.close();
    (await import('../src/services/live.service.js')).getLiveHub().closeAll();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await teardownDb();
  });

  it('needs a login', async () => {
    const res = await fetch(`${base}/api/me/events`);
    assert.equal(res.status, 401);
  });

  it('pushes notifications (from this instance at once, from other instances by polling) only to their owner', async () => {
    const me = await signup('Himanshu');
    const other = await signup('Other');
    const mine = open(me.cookie);
    const theirs = open(other.cookie);
    await mine.waitFor((e) => e.event === 'ready');
    await theirs.waitFor((e) => e.event === 'ready');

    // Same instance: the reminder job ran here.
    const notifications = await import('../src/services/notification.service.js');
    await notifications.create({ userId: me.user.id, kind: 'reminder', title: 'Lab file submit karo' });
    const first = await mine.waitFor((e) => e.event === 'notification', 1000);
    assert.equal(first.data.notification.title, 'Lab file submit karo');

    // Another instance wrote it: only the database knows, so the poll has to find it.
    const { Notification } = await import('../src/models/Notification.js');
    await Notification.create({ userId: me.user.id, kind: 'nudge', title: 'Bhai, DBMS ka kya hua?' });
    const second = await mine.waitFor((e) => e.event === 'notification' && e.data.notification.kind === 'nudge');
    assert.equal(second.data.notification.title, 'Bhai, DBMS ka kya hua?');

    // Sent once each, and never to the other user.
    await new Promise((r) => setTimeout(r, 2500)); // one more poll, which sees both again
    assert.equal(mine.events.filter((e) => e.event === 'notification').length, 2);
    assert.equal(theirs.events.filter((e) => e.event === 'notification').length, 0);
  });

  it('tells every open tab when something changes, including an Undo', async () => {
    const me = await signup('Tabs');
    const tab1 = open(me.cookie);
    const tab2 = open(me.cookie);
    await tab1.waitFor((e) => e.event === 'ready');
    await tab2.waitFor((e) => e.event === 'ready');

    const created = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: me.cookie },
      body: JSON.stringify({ title: 'Read chapter 4' }),
    });
    assert.equal(created.status, 201);
    const change = await tab2.waitFor((e) => e.event === 'changed' && e.data.activity.action === 'task.created', 1000);
    assert.match(change.data.activity.summary, /Read chapter 4/);
    await tab1.waitFor((e) => e.event === 'changed');

    const undo = await fetch(`${base}/api/me/activity/${change.data.activity.id}/undo`, { method: 'POST', headers: { Cookie: me.cookie } });
    assert.equal(undo.status, 200);
    const undone = await tab1.waitFor((e) => e.event === 'changed' && e.data.activity.undoneAt, 1000);
    assert.equal(undone.data.activity.id, change.data.activity.id);
  });

  it('limits how many tabs one user can keep open', async () => {
    const { MAX_CONNECTIONS_PER_USER } = await import('../src/services/live.service.js');
    const me = await signup('Many');
    const tabs = [];
    for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
      tabs.push(open(me.cookie));
      await tabs.at(-1).waitFor((e) => e.event === 'ready');
    }
    const extra = open(me.cookie);
    const refused = await extra.waitFor((e) => e.event === 'error');
    assert.equal(refused.data.code, 'TOO_MANY_TABS');

    // Closing a tab frees its slot.
    tabs[0].close();
    await new Promise((r) => setTimeout(r, 200));
    const again = open(me.cookie);
    await again.waitFor((e) => e.event === 'ready');
  });
});
