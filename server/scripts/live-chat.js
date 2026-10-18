// Live test against a running server and the REAL AI provider (costs quota; tests use a fake one).
// Signs up a throwaway account, gets a greeting, sends each message, shows what was saved,
// then deletes the account and all its data, even if something failed.
//
//   npm run dev                                   (in one terminal)
//   npm run live:chat -- "kal 9 baje lab file submit karni hai, yaad dila dena" "aur kuch?"
//   npm run live:chat -- --no-greeting "..."      (skip the greeting, saves one AI request)
import { env } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/db/connect.js';
import { deleteTestAccounts, testEmail } from './live-accounts.js';

const BASE = process.env.LIVE_BASE_URL ?? `http://localhost:${env.PORT}/api`;
const args = process.argv.slice(2);
const withGreeting = !args.includes('--no-greeting');
const messages = args.filter((a) => a !== '--no-greeting');
const email = testEmail();
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
}

const seconds = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const ist = (iso) => iso && new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function chat(message) {
  console.log('\nYOU:', message);
  const t0 = Date.now();
  const res = await call('POST', '/agent/chat', { message });
  if (res.status !== 200) return console.log(`  status ${res.status}:`, await res.text());
  let reply = '';
  for (const block of (await res.text()).split('\n\n')) {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (!event || !data) continue;
    const d = JSON.parse(data);
    if (event === 'text') reply += d.delta;
    else if (event === 'expression') console.log('  [face]', d.expression);
    else if (event === 'tool' && d.status !== 'running') console.log('  [tool]', d.name, d.status, d.message ?? '');
    else if (event === 'receipt') console.log('  [receipt]', d.summary.slice(0, 300));
    else if (event === 'confirm') console.log('  [confirm]', d.summary);
    else if (event === 'error') console.log('  [error]', d.code, d.message);
  }
  console.log(`SAATHI (${seconds(t0)}):`, reply);
}

await connectDB(env.MONGODB_URI, { maxPoolSize: 2, autoIndex: false });
try {
  const signup = await call('POST', '/auth/signup', { name: 'Himanshu', email, password: 'live-test-password-123', timezone: 'Asia/Kolkata' });
  if (signup.status !== 201) throw new Error(`signup failed (${signup.status}). Is the server running on ${BASE}?`);

  if (withGreeting) {
    const t0 = Date.now();
    const res = await call('GET', '/agent/greeting');
    console.log(`GREETING (${seconds(t0)}):`, JSON.stringify(await res.json()));
  }
  for (const m of messages) await chat(m);

  const tasks = (await (await call('GET', '/tasks?status=open&sort=due&limit=50')).json()).tasks ?? [];
  const reminders = (await (await call('GET', '/reminders?limit=50')).json()).reminders ?? [];
  console.log(`\nTASKS SAVED (${tasks.length}):`);
  for (const t of tasks) console.log(`  - ${ist(t.dueAt) ?? 'no date'} | ${t.title}${t.tags?.length ? ` | ${t.tags.join(', ')}` : ''}`);
  console.log(`REMINDERS SAVED (${reminders.length}):`);
  for (const r of reminders) console.log(`  - ${ist(r.remindAt)} | ${r.text}`);
} finally {
  const { deleted } = await deleteTestAccounts({ emails: [email] });
  console.log('\ncleanup: test account and its data deleted', JSON.stringify(deleted));
  await disconnectDB();
}
