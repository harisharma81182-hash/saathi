// Load-test scenarios for the Saathi API.
//
//   node loadtest/run.js [baseUrl] [scenario...]
//   e.g. node loadtest/run.js http://localhost:4000            (all scenarios)
//        node loadtest/run.js http://localhost:4000 me login   (only these)
//
// Run it against a server that uses a THROWAWAY database: it creates test accounts.
// Each scenario prints requests/sec, latency percentiles, and error counts.
import autocannon from 'autocannon';

const base = process.argv[2] ?? 'http://localhost:4000';
const only = process.argv.slice(3);
const DURATION = Number(process.env.LT_DURATION ?? 10);
const CONNECTIONS = Number(process.env.LT_CONNECTIONS ?? 50);
const HEALTH = process.env.LT_HEALTH_PATH ?? '/api/health/live';

async function api(path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return res;
}

async function makeUser() {
  const email = `lt${Date.now()}${Math.floor(Math.random() * 1e9)}@example.com`;
  const password = 'loadtest123';
  const res = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name: 'Load Test', email, password }),
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { email, password, cookie };
}

async function loginRequests(accounts = 20) {
  const users = await Promise.all(Array.from({ length: accounts }, makeUser));
  let i = 0;
  return {
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    requests: [
      {
        setupRequest: (req) => {
          const u = users[i++ % users.length];
          return { ...req, body: JSON.stringify({ email: u.email, password: u.password }) };
        },
      },
    ],
  };
}

function run(title, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      // autocannon needs the full URL; a separate "path" option is ignored.
      { duration: DURATION, connections: CONNECTIONS, ...opts, url: base + opts.path },
      (err, result) => (err ? reject(err) : resolve({ title, result })),
    );
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

function summarize({ title, result }) {
  const l = result.latency;
  const non2xx = result.non2xx;
  return {
    scenario: title,
    'req/s (avg)': Math.round(result.requests.average),
    'p50 ms': l.p50,
    'p90 ms': l.p90,
    'p99 ms': l.p99,
    'max ms': l.max,
    requests: result.requests.total,
    'non-2xx': non2xx,
    errors: result.errors + result.timeouts,
  };
}

const scenarios = {
  // Baseline: no database, no auth. Shows the raw ceiling of one Node process.
  health: async () => run('GET /api/health/live', { path: HEALTH }),

  // The most common authenticated read: token check + user lookup.
  me: async () => {
    const u = await makeUser();
    return run('GET /api/auth/me', { path: '/api/auth/me', headers: { cookie: u.cookie } });
  },

  // CPU-heavy path: password hashing on every request.
  // Spread over 20 accounts, like real traffic (each account allows only a few attempts at once).
  login: async () => run('POST /api/auth/login', { ...(await loginRequests()), connections: Math.min(CONNECTIONS, 20) }),

  // Does heavy login traffic slow down everyone else? Runs logins and health checks at the same time
  // and reports health latency. If hashing blocks the event loop, health p99 explodes.
  'login+health': async () => {
    const logins = await loginRequests();
    const [, health] = await Promise.all([
      run('(background) login', { ...logins, connections: 20 }),
      run('GET /api/health/live while logins run', { path: HEALTH, connections: 10 }),
    ]);
    return health;
  },
};

const selected = only.length ? only : Object.keys(scenarios);
const rows = [];
for (const name of selected) {
  if (!scenarios[name]) {
    console.error(`unknown scenario "${name}". Options: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }
  process.stderr.write(`running ${name} for ${DURATION}s...\n`);
  rows.push(summarize(await scenarios[name]()));
}
console.table(rows);
