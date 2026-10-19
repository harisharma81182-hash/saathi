# Saathi

A personal AI agent that does the work instead of only answering. Tell Saathi, by typing or by voice, "remind me to submit the lab file tomorrow at 9", and it creates the task and the reminder in your account, then notifies you when the time comes.

> This README is being filled in as the project is built. Sections marked _(coming)_ are not built yet.

## Problem statement

Students juggle assignments, lab submissions, exams and small personal errands across chat messages, notebooks and memory. Normal to-do apps make you stop, open a form, pick a date and type everything in, so things never get written down. Chatbots can talk about your tasks, but they cannot keep, change or remind you of them.

## Target users

College students (and anyone with a busy schedule) who would rather say what they need in plain language, in English, Hindi or Hinglish, than fill in forms.

## Solution

Saathi is a chat and voice assistant connected to your own data. The AI model (Gemini by default, Claude as an option) reads your request and decides which actions to take: create a task, set a reminder, save or search a note. The server validates every action, carries it out against your account, and shows it as a receipt in the chat. A background scheduler fires reminders on time.

## Key features

- Account signup and login with secure, httpOnly cookie sessions, per-IP and per-account brute-force limits
- "Password bhool gaye?": an emailed single-use reset link (30 minutes, stored only as a hash) that logs out every other session
- Built to scale horizontally: stateless instances, MongoDB job queue, shared quotas, health checks and graceful shutdown ([docs/SCALING.md](docs/SCALING.md))
- Tasks (with due dates, priority, tags, and deadlines that show a countdown), notes, and reminders, all searchable and filterable
- Reminders fire on time from a background worker, exactly once, and can be snoozed or cancelled; Saathi writes a short friendly line for each at fire time (plain text if the AI is unavailable, never late)
- Habits: daily or weekly repeating tasks, the next one created when you finish one, with a streak
- Quick add: one sentence becomes a task with date, priority and tags (preview before saving)
- Saathi texts first: a friendly nudge about overdue tasks (at most once per task per day, never at night) and an evening recap of the day with a button to move leftovers to tomorrow
- Undo for every change (create, edit, complete, delete, snooze), safe against double clicks and later edits
- Today panel: due today, overdue, upcoming reminders, deadline countdowns; weekly progress with a streak
- Typing hints: while you type, Saathi points out related open tasks (no AI call, instant)
- Double-submit protection with `Idempotency-Key`, and duplicate reminder detection
- Agent chat with tool calling, streamed replies, an action receipt (with Undo) for every change, and Confirm/Cancel before deleting
- Live updates: reminders, nudges and changes appear in every open tab at once (Server-Sent Events)
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
| AI | Google Gemini (function calling) by default, Claude API (tool use) as an option | Gemini has a free tier, which suits a student project. One provider interface (`server/src/ai/provider.js`): `AI_PROVIDER` switches between them without touching the agent code |
| Frontend | React, Vite, Tailwind CSS, Motion | _(coming)_ |

## Architecture

```
Browser ──HTTPS──> Saathi container (Render)
                    ├─ web role:    Express API, stateless, any number of copies
                    └─ worker role: background job runner (reminders, slow AI work)
                          │
                          ├──> MongoDB Atlas  (users, data, job queue, rate-limit counters)
                          └──> Gemini API or Claude API (through the AI gateway: quotas, retries, circuit breaker)
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

### Live check with the real AI

The test suite never calls a real AI. To try Saathi for real, start the server, then in a second terminal:

```bash
cd server
npm run live:chat -- "kal subah 9 baje lab file submit karni hai, yaad dila dena"
```

It signs up a throwaway account (`live.<number>@example.com`), shows the greeting, Saathi's replies, receipts and what was saved, then deletes that account and all its data. `npm run live:cleanup` removes any leftover test accounts. Each run uses a few requests of the AI quota.

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
| `AI_PROVIDER` | no | `gemini` (default) or `anthropic` |
| `GEMINI_API_KEY` | for chat (gemini) | Gemini API key from aistudio.google.com (free tier) |
| `GEMINI_MODELS` | no | Model chain, tried in order: default `gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash`. When one reaches its limit or is overloaded, the next one answers |
| `ANTHROPIC_API_KEY` | for chat (anthropic) | Claude API key from console.anthropic.com |
| `ANTHROPIC_MODEL` | no | Default `claude-haiku-5-5` |
| `ANTHROPIC_FALLBACK_MODEL` | no | Used when the main model is overloaded, default `claude-sonnet-5-5` |
| `AI_REQUEST_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS` | no | One AI attempt gives up after 20 s; one AI call including retries after 28 s |
| `AI_USER_PER_MINUTE`, `AI_USER_PER_DAY` | no | Chat messages per user, default 20 / 300 (only spam should hit these) |
| `AI_MODEL_LIMITS` | no | Requests per model for the whole app, `model=perMinute/perDay`, kept just below the free-tier limits (default `gemini-3.5-flash-lite=13/480,gemini-3.1-flash-lite=13/480,gemini-3.8-flash=4/18`). When every model is at its limit, Saathi says so in a friendly message and everything except chat keeps working |
| `AI_MAX_CONCURRENCY`, `AI_MAX_QUEUE` | no | AI call limits per instance, see [docs/SCALING.md](docs/SCALING.md) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for email | SMTP server for password reset links (Gmail App Password works). Without `SMTP_HOST` the link is printed in the server log |
| `APP_URL` | no | Address used in email links, default `CLIENT_ORIGIN` |
| `MONGODB_URI_TEST` | for tests | Separate database for the test suite |

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health/live` | no | Process is alive (used to restart hung containers) |
| GET | `/api/health/ready` | no | Ready for traffic: database reachable and not shutting down |
| POST | `/api/auth/signup` | no | Create an account `{ name, email, password, timezone? }` |
| POST | `/api/auth/login` | no | Log in `{ email, password }` |
| POST | `/api/auth/logout` | no | Clear the session cookie |
| POST | `/api/auth/forgot-password` | no | `{ email }`: emails a reset link (30 minutes, single use; only a hash of the token is stored). Always the same answer, so it never reveals which emails have accounts. Rate-limited per IP and per address |
| POST | `/api/auth/reset-password/check` | no | `{ token }`: is this link still usable? |
| POST | `/api/auth/reset-password` | no | `{ token, password }`: sets the new password (signup rules) and logs out every session |
| GET | `/api/auth/me` | yes | Current user |
| PATCH | `/api/auth/me` | yes | Update `{ name?, timezone? }` |

| GET | `/api/tasks` | yes | List: `status` (open/done/all), `due` (today/overdue/upcoming/none), `kind`, `q`, `tag`, `sort` (due/created/priority), `page`, `limit` |
| POST | `/api/tasks` | yes | Create `{ title, notes?, kind?, priority?, dueAt?, tags?, repeat? }`. `repeat: { every: 'day' }` or `{ every: 'week', days: ['mon','thu'] }` makes it a habit (needs `dueAt`) |
| POST | `/api/tasks/quick-parse` | yes | Quick add: `{ text }` like "kal 5 baje DBMS assignment, important" becomes a task draft `{ draft, source: 'ai' or 'plain', warnings }` to preview; nothing is saved. Without the AI the sentence becomes the title |
| GET | `/api/tasks/habits` | yes | Habits: the current occurrence of each repeating task, with its streak |
| GET / PATCH / DELETE | `/api/tasks/:id` | yes | Read, edit, delete (soft delete, undoable) |
| POST | `/api/tasks/:id/complete`, `/reopen` | yes | Mark done / open again. Completing a habit creates its next occurrence (returned as `next`); undoing the completion removes it again |
| GET / POST | `/api/notes` | yes | List (`q`, `tag`, `pinned`) / create `{ body, title?, tags?, pinned? }` |
| GET / PATCH / DELETE | `/api/notes/:id` | yes | Read, edit, delete |
| GET / POST | `/api/reminders` | yes | List (`status`) / create `{ text, remindAt, taskId? }` |
| PATCH / DELETE | `/api/reminders/:id` | yes | Change text or time / cancel |
| POST | `/api/reminders/:id/snooze` | yes | `{ minutes }` or `{ until }` |
| GET | `/api/me/events` | yes | Live updates (Server-Sent Events): `ready`, `notification` (a reminder fired, a nudge), `changed` (a task, note or reminder changed, including Undo). Works across instances: each instance polls MongoDB every 2 s for its connected users |
| GET | `/api/me/today` | yes | Today panel data |
| POST | `/api/me/leftovers/move-to-tomorrow` | yes | The recap's button: today's unfinished tasks move to tomorrow, same time (each move undoable; habits and deadlines stay) |
| GET | `/api/me/progress` | yes | Completions per day (14 days), this week vs last, streak |
| GET | `/api/me/hints?q=` | yes | Open tasks related to what the user is typing |
| GET | `/api/me/notifications` | yes | Notifications (`unread=true`), with unread count |
| POST | `/api/me/notifications/:id/read`, `/read-all` | yes | Mark read |
| GET | `/api/me/activity` | yes | Timeline of changes, each with `canUndo` |
| POST | `/api/me/activity/:id/undo` | yes | Undo one change |
| POST | `/api/agent/chat` | yes | Talk to Saathi `{ message, conversationId? }`. Streams Server-Sent Events: `start`, `expression`, `text`, `reset`, `tool`, `receipt`, `confirm`, `error`, `done` |
| GET | `/api/agent/greeting` | yes | A freshly generated greeting (cached for 5 minutes) |
| GET | `/api/agent/conversations` | yes | The user's conversations |
| GET | `/api/agent/conversations/:id/messages` | yes | Messages, newest page (`before`, `limit`) |
| POST | `/api/agent/actions/:id/confirm`, `/cancel` | yes | Confirm or cancel an action Saathi proposed (deleting a task) |
| GET / POST | `/api/agent/memories` | yes | What Saathi remembers / add a memory `{ text, kind? }` |
| DELETE | `/api/agent/memories/:id` | yes | Forget a memory |

Dates are ISO 8601 with a timezone (`2026-10-18T09:00:00+05:30`); dates without one are rejected because "9 AM" is ambiguous. POST create endpoints accept an optional `Idempotency-Key` header: sending the same key twice returns the first response instead of creating a duplicate.

Every error has the same shape: `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Every response has an `X-Request-Id` header that matches the server log line. Responses that ask the client to wait (429, 503) include `Retry-After`.

## Deployment

Render, using `render.yaml` (New, then Blueprint). Secrets are entered in the Render dashboard. Step-by-step instructions and the live link _(coming)_. Scaling stages: [docs/SCALING.md](docs/SCALING.md).

## Roadmap

Planned after the first release:

- Google Calendar sync
- Upload a PDF or syllabus and turn it into tasks
- Saathi on WhatsApp or Telegram
- Web search (weather, explanations)
- Shared tasks with friends

## AI usage

This project was built with help from Claude (Anthropic) for code generation, debugging and documentation, as allowed by the project guidelines. All workflows are tested and the code is understood and maintained by the author.
