# Scaling Saathi

How the backend handles growth, what was measured, what was built, and when to add more.

## Decision

**No Kubernetes now.** Saathi runs as one stateless Docker image on a managed container platform (Render today; Google Cloud Run or Render paid plans when traffic needs autoscaling). The platform gives load balancing, health checks, rolling deploys and horizontal autoscaling. Kubernetes would give the same things for a single service, plus a cluster to run, upgrade, secure and pay for.

The code is written so the platform can be swapped without changes: the same image runs on Render, Cloud Run, Fly.io, AWS ECS or Kubernetes. Moving later is a config change, not a rewrite. The rule is **make the app scalable now, buy infrastructure only when measurements say so.**

## What was measured

Load-tested on a 2-core machine (the load generator shared the same cores, so absolute numbers are pessimistic; the before/after comparison is what matters). Script: `server/loadtest/run.js`.

| Scenario | Before | After |
|---|---|---|
| Health check, no load | 5,155 req/s, p99 33 ms | 7,078 req/s, p99 23 ms |
| `GET /api/auth/me` (auth + user lookup) | 737 req/s, p99 139 ms | 1,628 req/s, p99 67 ms |
| `POST /api/auth/login` | 2 req/s, p50 3.8 s | 5 req/s on 2 cores (see below) |
| **Health check while logins run** | **21 req/s, p99 3.35 s** | **5,135 req/s, p99 9 ms** |

### Bottlenecks found

1. **Password hashing froze the whole server.** `bcryptjs` is pure JavaScript, so each hash ran for about 340 ms on the event loop. While anyone was logging in, every other request on that instance waited (p99 3.35 s for a health check). Fixed by switching to Node's built-in `scrypt`, which runs on libuv's thread pool, with at most (CPU cores - 1) hashes at once so hashing threads never starve the event loop. Other requests are now almost unaffected by logins.
2. **One database read on every authenticated request** just to confirm the user exists. Atlas' free tier allows 100 operations per second in total, so this alone would cap the app at about 100 requests per second. Fixed with a 30-second per-instance user cache.
3. **Connection pool sized for one server.** Mongoose's default pool is 100 connections per process. Five instances would need 500, which is Atlas M0's entire limit. Now `MONGO_MAX_POOL` (default 10).
4. **State that only works with one instance.** An in-process scheduler (e.g. `node-cron`) would fire every reminder once per instance, and in-memory rate limits multiply by the number of instances. Fixed with a MongoDB job queue and MongoDB-backed quotas (below).
5. **Shutdown dropped requests.** The old handler disconnected the database while requests were still running, so every deploy or scale-down could fail requests. Fixed with a graceful drain.
6. **No way to see problems.** Plain `console.log` with no request ids. Now structured JSON logs with a request id on every line and response.

Login stays CPU-bound by design. Slow hashing is what makes stolen password hashes hard to crack. Each login costs about 230 ms of CPU on a hashing thread, so login capacity is roughly (cores - 1) x 4 per second per instance: about 4 to 5 on a 2-core instance, and more instances add more. Logins happen once per week per device (the session lasts 7 days), so this is far above real demand.

## Where the real limits are

"Thousands of concurrent users" is not the same as thousands of requests per second. In a chat or assistant app, an active user sends roughly one request every 10 to 30 seconds. So 1,000 requests per second is about 10,000 to 30,000 people using the app at the same moment.

The limits, in the order Saathi will hit them:

| # | Limit | Approximate ceiling | What raises it |
|---|---|---|---|
| 1 | **AI provider rate limits and cost** | Set by the Anthropic account's usage tier (requests and tokens per minute), and by budget | Per-user quotas (built), higher usage tier, prompt caching, smaller model for simple turns |
| 2 | **Atlas M0 free tier** | 100 ops/sec, 500 connections, 0.5 GB | Atlas M10 or higher (dedicated, no ops cap) |
| 3 | **Single free web instance** | ~1,000+ simple req/s, but it sleeps after 15 min idle | Paid instance with 2+ instances and autoscaling |
| 4 | Live notification connections (SSE, step 4) | Thousands per instance | More instances; Redis pub/sub past ~10 instances |

The Node process is not the first bottleneck. The AI provider and the free database tier are.

## Platform options

| Option | Horizontal autoscaling | Ops effort | Cost at small scale | Verdict |
|---|---|---|---|---|
| Single VM + Docker | No (manual) | Medium: patching, TLS, restarts | Low | No automatic recovery or scaling |
| **Render (Docker)** | Yes, on paid plans | **Very low** | **Free tier now**, paid per instance | **Now.** Simplest path from Git to a running app |
| **Google Cloud Run** | Yes, by concurrent requests, scales to zero | Very low | Pay per use, free monthly allowance | **Next step** when traffic is spiky or grows |
| Fly.io / Railway | Yes | Low | Low | Fine alternatives |
| AWS ECS Fargate | Yes | Medium: VPC, ALB, IAM | Medium; load balancer has a fixed monthly cost | When already on AWS |
| Kubernetes (GKE Autopilot / EKS) | Yes (HPA) | **High**: cluster upgrades, networking, RBAC, ingress | Highest; control plane and idle node capacity | Only when the triggers below are met |

### When Kubernetes becomes worth it

Move to Kubernetes when **several** of these are true, not just one:

- Many services (roughly 5 or more) that need shared networking, service discovery and consistent policies
- Needs a managed platform cannot meet: GPUs, sidecars, custom networking, specific compliance controls
- Spending enough on compute that bin-packing workloads onto shared nodes saves real money
- A team member who can own the cluster

Saathi has one service and one worker. None of these apply.

## Architecture by stage

### Stage 0: now (free, demo, first users)

```
Browser ──HTTPS──> Render (free, 1 instance, PROCESS_ROLE=all)
                    ├─ web: Express API (stateless)
                    └─ worker: job queue poller
                          │
                          ├──> MongoDB Atlas M0 (data, job queue, quotas)
                          └──> Claude API (through the AI gateway)
```

The free instance sleeps after 15 minutes without traffic, and reminders due while it sleeps fire late, when it wakes. The job queue catches up on everything overdue, so nothing is lost, only delayed.

### Stage 1: real users (paid, from roughly 100 daily users or when reminders must be on time)

```
                 ┌─> web instance 1 ─┐
Browser ─> LB ──>├─> web instance 2 ─┼──> Atlas M10 (Singapore, same region)
  (Cloudflare    └─> web instance N ─┘         ▲
   CDN in front                                │
   for static     worker instance(s) ──────────┘──> Claude API
   files)
```

- `PROCESS_ROLE=web` on 2 or more instances (two means a deploy or crash never causes downtime), autoscaling on CPU or concurrency
- `PROCESS_ROLE=worker` as a separate service, so slow background work never competes with user requests
- Atlas M10: dedicated cluster with no ops-per-second cap, backups, and metrics
- Pool budget: (web instances + workers) x `MONGO_MAX_POOL` stays well under the cluster's connection limit

### Stage 2: growth (add only when the metric says so)

| Add | When (measured trigger) | Why |
|---|---|---|
| Redis (e.g. Upstash, pay per request) | More than ~10 web instances, or notification latency under 1 s needed | Pub/sub for live notifications across instances; shared IP rate limits |
| BullMQ on Redis instead of the Mongo queue | Sustained over ~50 jobs/second, or job polling visible in Atlas metrics | Push-based queue with lower latency and load on the database |
| Atlas read replicas or a bigger tier | Atlas CPU over 70% sustained, or slow-query alerts | More database capacity |
| Response caching for read-heavy endpoints | Same data read many times per second | Fewer database reads |
| Second region | Users on several continents, or an uptime SLA | Lower latency, regional failover |

## What is implemented

| Requirement | Implementation | File |
|---|---|---|
| Stateless instances | No in-memory sessions (JWT cookie); jobs, quotas and data in MongoDB | `middleware/auth.js` |
| Separate web and worker scaling | `PROCESS_ROLE=web\|worker\|all` from one image | `src/index.js` |
| Background job queue | Durable Mongo queue: atomic claim (no double processing across instances), per-claim lock tokens, lock heartbeat for long jobs, retries with backoff, dead-lettering, crash recovery via lock expiry, dedupe keys | `src/jobs/` |
| Connection pooling | `MONGO_MAX_POOL` per instance, idle connections released | `db/connect.js` |
| Indexes | Declared on every model; `npm run db:indexes` | `models/`, `scripts/` |
| Caching | 30 s per-instance user cache on the hot auth path | `middleware/auth.js` |
| Non-blocking CPU work | scrypt on the thread pool, at most (cores - 1) at once, bounded queue | `security/password.js` |
| Traffic spike protection | Event-loop-lag load shedding (503 + Retry-After); bounded queues everywhere; per-IP and per-account login limits | `middleware/overload.js` |
| AI rate limiting and reliability | AI gateway: per-user quotas shared across instances, concurrency limit, bounded queue, timeouts, retry with jittered backoff honouring Retry-After, fallback model, circuit breaker | `src/ai/gateway.js` |
| Health checks | `/api/health/live` (process) and `/api/health/ready` (database + not shutting down) | `routes/health.routes.js` |
| Graceful shutdown | Not-ready, drain in-flight requests, `Connection: close`, stop the worker, close the DB, forced exit after a timeout | `src/index.js` |
| Logging | JSON logs with request ids, secrets redacted | `lib/logger.js`, `app.js` |
| Secrets | Environment variables only, validated at startup; `sync: false` in `render.yaml` | `config/env.js` |
| Container | Small Alpine image, production dependencies only, non-root user, healthcheck, direct `node` for signals | `Dockerfile` |

## AI provider scaling (Claude)

Every model call goes through `createAiGateway().run({ userId, call })`. In order:

1. **Per-user quota** (default 10 per minute, 200 per day), counted in MongoDB so it holds across all instances. Protects the budget from one runaway user or script.
2. **Circuit breaker.** After 5 provider failures in a row, calls fail instantly for 30 s with a friendly message, instead of every user waiting for a timeout.
3. **Concurrency limit** per instance (`AI_MAX_CONCURRENCY`), with a **bounded queue** (`AI_MAX_QUEUE`, `AI_QUEUE_TIMEOUT_MS`). Overflow gets a fast 503 instead of piling up memory.
4. **Timeout** per call (`AI_REQUEST_TIMEOUT_MS`).
5. **Retries** on 429, 5xx, 529 (overloaded) and network errors, with exponential backoff and jitter, honouring `Retry-After`. Client errors (400) are not retried.
6. **Fallback model.** If the primary model is overloaded, the retry uses `ANTHROPIC_FALLBACK_MODEL`.

The Anthropic SDK's own retries should be turned off (`maxRetries: 0`) when it is wired in (step 3), so the gateway is the only place retries happen.

**Sizing:** the account-wide provider limit is shared by all instances. Keep `AI_MAX_CONCURRENCY x web instances` within what the account's usage tier allows. The per-user quotas decide how many users that serves.

**Interactive versus background:** chat turns stay on the request path, because the user is waiting and streaming the answer feels fast. Work nobody waits for (reminder messages, daily summaries) goes through the job queue, where it can retry patiently without holding a request open.

## Security and operations

- **Secrets:** only in environment variables (Render dashboard or a platform secret manager), never in Git. `.env` is gitignored. Startup fails loudly if a required secret is missing.
- **Logs:** JSON to stdout, collected by the platform. Cookies, auth headers and passwords are redacted.
- **Monitoring (Stage 0):** Render metrics (CPU, memory, restarts), Atlas metrics and alerts (ops/sec, connections, storage), and a free uptime monitor on `/api/health/ready`.
- **Monitoring (Stage 1):** add error tracking (e.g. Sentry's free tier) and alerts on p99 latency, 5xx rate, `Job` documents with `status: failed`, and AI gateway 503s.
- **Resource limits:** set by the platform's instance size. Node 20+ reads the container's memory limit when sizing its heap.

## Load-testing strategy

**Tool:** `autocannon` (Node, runs on Windows, macOS and Linux). Scenarios in `server/loadtest/run.js`:

| Scenario | Measures |
|---|---|
| `health` | Raw ceiling of one instance (no database) |
| `me` | The common authenticated read path |
| `login` | The CPU-heavy path |
| `login+health` | Whether heavy work slows everyone else down (event-loop blocking) |

AI calls are load-tested with a fake provider (as in `tests/resilience.test.js`), never against the real API. That would only measure the provider's limits and spend money.

**How to run**

```bash
# terminal 1: a server pointed at a THROWAWAY database
cd server
set MONGODB_URI=<a test database>     # macOS/Linux: export MONGODB_URI=...
set NODE_ENV=test                      # disables the per-IP login limiter for the test
npm start

# terminal 2
cd server
npm run loadtest -- http://localhost:4000
# options: LT_DURATION=30 LT_CONNECTIONS=100, or name scenarios: ... http://localhost:4000 me login
```

**Process**

1. **Find one instance's capacity.** Raise `LT_CONNECTIONS` until p99 latency passes the target (e.g. 300 ms) or errors appear. The request rate just before that is the instance's capacity.
2. **Find what broke first.** Instance CPU near 100% means add instances. Atlas ops/sec or CPU high means a bigger tier or better indexes/caching. 503 `OVERLOADED` means shedding is working; add instances.
3. **Size the fleet.** Instances needed = peak req/s divided by (capacity per instance x 0.6). The 0.6 leaves headroom for spikes and for one instance being down during a deploy.
4. **Prove horizontal scaling.** Run the same test against 1, then 2, then 4 instances behind the platform's load balancer. Throughput should grow almost linearly. If it does not, the bottleneck is shared (database or AI provider), not the instances.
5. **Repeat after each major feature** (agent chat, notifications), with a scenario for it.

**Targets for Stage 1:** p99 under 300 ms for non-AI endpoints, under 1% 5xx, AI first token under 3 s at p90.

## Known trade-offs

- **The user cache** can show a renamed or deleted account as unchanged on another instance for up to 30 s.
- **The per-IP login limit** is per instance (approximate with many instances). The **per-account** limit is shared and exact.
- **The per-account login limit** counts every attempt when it starts (a success gives its slot back), so parallel guesses cannot slip past it. It could be abused to lock someone out for 15 minutes. That is acceptable at this stage. A later fix is CAPTCHA after a few failures instead of a hard lock.
- **The Mongo job queue** polls once or twice a second per worker: fine for thousands of jobs per hour, not for high-throughput streaming. The swap to BullMQ is isolated to `src/jobs/`.
- **Atomicity tests** (no double-claimed jobs, exact quota counts) depend on MongoDB's single-document atomicity. They skip on MongoDB-compatible test servers that lack it, and must be run against Atlas.
- **Independent code review:** a separate review of the concurrency code found 7 issues (a circuit breaker that could stay stuck, a job bookkeeping error that could crash the process, cancelled requests tripping the breaker, a shutdown race, long jobs running twice, a parallel-login bypass, and a timing leak). All are fixed and covered by regression tests.
- **Not verified in this environment:** the Docker image build (no Docker daemon available) and multi-instance behaviour behind a real load balancer. Both are covered by the deploy checklist.
