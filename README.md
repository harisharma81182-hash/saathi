# Saathi

A personal AI agent that does the work instead of only answering. Tell Saathi, by typing or by voice, "remind me to submit the lab file tomorrow at 9", and it creates the task and the reminder in your account, then notifies you when the time comes.

> This README is being filled in as the project is built. Sections marked _(coming)_ are not built yet.

## Problem statement

Students juggle assignments, lab submissions, exams and small personal errands across chat messages, notebooks and memory. Normal to-do apps make you stop, open a form, pick a date and type everything in, so things never get written down. Chatbots can talk about your tasks, but they cannot keep, change or remind you of them.

## Target users

College students (and anyone with a busy schedule) who would rather say what they need in plain language, in English, Hindi or Hinglish, than fill in forms.

## Solution

Saathi is a chat and voice assistant connected to your own data. Claude reads your request and decides which actions to take: create a task, set a reminder, save or search a note. The server validates every action, carries it out against your account, and shows it as a receipt in the chat. A background scheduler fires reminders on time.

## Key features

- Account signup and login with secure, httpOnly cookie sessions, per-IP and per-account brute-force limits
- Built to scale horizontally: stateless instances, MongoDB job queue, shared quotas, health checks and graceful shutdown ([docs/SCALING.md](docs/SCALING.md))
- _(coming)_ Tasks, notes and reminders, each usable directly or through the agent
- _(coming)_ Agent chat with tool calling and an action receipt for every change
- _(coming)_ Reminder scheduler with live in-app notifications
- _(coming)_ Voice mode with an animated assistant face

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js, Express 5 | Async errors are handled natively; small and well understood |
| Database | MongoDB Atlas with Mongoose | Tasks, notes and conversations are document-shaped; free hosted tier |
| Auth | scrypt (Node built-in) + JWT in an httpOnly cookie | Passwords are never stored in plain text; hashing runs off the event loop; tokens are unreadable from page JavaScript |
| Background jobs | Job queue in MongoDB | Reminders and slow work run once, even with many instances; no extra service to pay for |
| Logging | pino (JSON) | Structured logs with request ids |
| Deployment | Docker on Render | One image, runs on any container platform; see [docs/SCALING.md](docs/SCALING.md) for why not Kubernetes |
| Validation | zod | One schema both validates input and produces field-level error messages |
| AI | Claude API (tool use) | _(coming)_ |
| Frontend | React, Vite, Tailwind CSS, Motion | _(coming)_ |

## Architecture

```
Browser ──HTTPS──> Saathi container (Render)
                    ├─ web role:    Express API, stateless, any number of copies
                    └─ worker role: background job runner (reminders, slow AI work)
                          │
                          ├──> MongoDB Atlas  (users, data, job queue, rate-limit counters)
                          └──> Claude API     (through the AI gateway: quotas, retries, circuit breaker)
```

One Docker image runs as `web`, `worker` or `all` (`PROCESS_ROLE`). Everything that must be shared between instances (sessions, jobs, rate limits) lives in MongoDB or in the signed cookie, never in one instance's memory, so adding instances behind a load balancer just works. The full reasoning, load-test results and growth plan are in **[docs/SCALING.md](docs/SCALING.md)**.

```
server/
  src/
    config/      environment validation (server refuses to start with bad config)
    db/          MongoDB connection, pool settings, health ping
    models/      Mongoose schemas
    middleware/  auth, validation, errors, overload protection
    routes/      HTTP endpoints
    services/    business logic, kept separate from HTTP
    security/    password hashing
    jobs/        MongoDB job queue and worker
    ai/          AI gateway and circuit breaker
    lib/         logger, process lifecycle
  tests/         unit and integration tests (node:test + supertest)
  loadtest/      load-test scenarios (autocannon)
docs/SCALING.md  scaling decisions, measurements, growth plan
Dockerfile       container image
render.yaml      Render deployment blueprint
```

## Local setup

Requirements: Node.js 20 or newer, a free MongoDB Atlas cluster.

```bash
cd server
npm install
copy .env.example .env      # on macOS/Linux: cp .env.example .env
# open server/.env and fill in MONGODB_URI and JWT_SECRET
npm run dev
```

Check it is running: open http://localhost:4000/api/health/ready, which should show `{"status":"ok","database":"up"}`.

### With Docker (optional)

```bash
docker build -t saathi .
docker run -p 4000:4000 --env-file server/.env saathi
```

### Running the tests

The tests need a separate database because they wipe it. Add `MONGODB_URI_TEST` to `server/.env` (same as `MONGODB_URI` but ending in `/saathi_test`), then:

```bash
cd server
npm test
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB Atlas connection string |
| `JWT_SECRET` | yes | Random string of at least 32 characters used to sign login tokens |
| `JWT_EXPIRES_IN` | no | Login lifetime, default `7d` |
| `PORT` | no | API port, default `4000` |
| `PROCESS_ROLE` | no | `all` (default), `web` or `worker` |
| `MONGO_MAX_POOL` | no | MongoDB connections per instance, default `10` |
| `LOG_LEVEL` | no | `info` (default), `debug`, `warn`... |
| `CLIENT_ORIGIN` | no | Frontend URL allowed by CORS, default `http://localhost:5173` |
| `ANTHROPIC_API_KEY` | from step 3 | Claude API key from console.anthropic.com |
| `ANTHROPIC_MODEL` | no | Default `claude-haiku-5-5` |
| `ANTHROPIC_FALLBACK_MODEL` | no | Used when the main model is overloaded, default `claude-sonnet-5-5` |
| `AI_MAX_CONCURRENCY`, `AI_MAX_QUEUE`, `AI_USER_PER_MINUTE`, `AI_USER_PER_DAY` | no | AI call limits, see [docs/SCALING.md](docs/SCALING.md) |
| `MONGODB_URI_TEST` | for tests | Separate database for the test suite |

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health/live` | no | Process is alive (used to restart hung containers) |
| GET | `/api/health/ready` | no | Ready for traffic: database reachable and not shutting down |
| POST | `/api/auth/signup` | no | Create an account `{ name, email, password, timezone? }` |
| POST | `/api/auth/login` | no | Log in `{ email, password }` |
| POST | `/api/auth/logout` | no | Clear the session cookie |
| GET | `/api/auth/me` | yes | Current user |
| PATCH | `/api/auth/me` | yes | Update `{ name?, timezone? }` |

Every error has the same shape: `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Every response has an `X-Request-Id` header that matches the server log line. Responses that ask the client to wait (429, 503) include `Retry-After`.

## Deployment

Render, using `render.yaml` (New, then Blueprint). Secrets are entered in the Render dashboard. Step-by-step instructions and the live link _(coming)_. Scaling stages: [docs/SCALING.md](docs/SCALING.md).

## AI usage

This project was built with help from Claude (Anthropic) for code generation, debugging and documentation, as allowed by the project guidelines. All workflows are tested and the code is understood and maintained by the author.
