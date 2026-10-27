# Saathi: architecture decisions

Each section is one decision: **what** was chosen, **why**, and the **trade-off** (what it costs or
what was given up). The overview diagram is in the [README](../README.md#architecture); load tests
and the scaling plan are in [SCALING.md](SCALING.md).

## The shape of the system

```
Browser (React app, service worker)
   │  HTTPS, same origin: REST + Server-Sent Events, httpOnly cookie
   ▼
Express (one Docker image, PROCESS_ROLE = web | worker | all)
   ├─ routes (thin) → services (business logic, zod schemas, activity log)
   ├─ agent loop → the same services, through 18 tools
   ├─ AI gateway → Gemini (or Claude): model chain, quotas, retries, circuit breaker
   └─ worker → MongoDB job queue → reminders, alerts, nudges, recap, delivery (push / email)
   ▼
MongoDB Atlas: data, jobs, rate counters, idempotency keys, sessions' version numbers
```

## 1. One codebase, three roles (`PROCESS_ROLE`)

- **What:** one Express app and one Docker image. `web` serves HTTP, `worker` runs background jobs, `all` does both ([server/src/index.js](../server/src/index.js)).
- **Why:** the free Render plan gives one small instance, so `all` runs everything there. On a paid plan the same image scales web and worker separately without code changes.
- **Trade-off:** in `all` mode a slow job and HTTP traffic share one CPU. The overload guard ([middleware/overload.js](../server/src/middleware/overload.js)) answers 503 with `Retry-After` instead of letting latency grow without limit.

## 2. MongoDB Atlas with Mongoose

- **What:** one MongoDB database for users, tasks, notes, reminders, conversations, memories, jobs and counters.
- **Why:** tasks, notes and chat messages are document-shaped and change often; Atlas has a free hosted tier in Mumbai; single-document updates are atomic, which the job queue and quotas rely on.
- **Trade-off:** no joins or multi-document transactions in the hot paths, so related writes are ordered carefully (for example, a reminder's notification is written before the reminder is marked sent, so a crash in between is retried instead of lost). The free tier allows about 100 operations per second, so authenticated requests use a 30-second user cache.

## 3. A job queue in MongoDB instead of Redis or a cron

- **What:** [jobs/queue.js](../server/src/jobs/queue.js): atomic claim (`findOneAndUpdate`), lock token with heartbeat, retries with backoff, dead-lettering, `dedupeKey` unique index, `runAt` for scheduled jobs.
- **Why:** reminders must fire exactly once even with several instances, and without paying for another service. The dedupe key includes the reminder time, so a snoozed reminder gets a new job and the old one does nothing.
- **Trade-off:** polling adds a little latency (seconds, not milliseconds) and some database reads. A dedicated queue (BullMQ on Redis) would be faster at very high volume; [SCALING.md](SCALING.md) shows when to switch.

## 4. The AI only proposes; the server acts

- **What:** the agent loop ([services/agent.service.js](../server/src/services/agent.service.js)) gives the model 18 tools ([ai/tools.js](../server/src/ai/tools.js)). Every tool call is validated with the same zod schema as the REST endpoint and runs through the same service as the screens.
- **Why:** one set of rules for data, whoever changes it. Every change is logged in the activity log and can be undone; deleting needs a Confirm tap in the UI.
- **Trade-off:** more round trips to the model than a single "answer" call, so the loop has a hard cap on iterations and each call has a timeout.

## 5. Undo through an activity log

- **What:** every change to a task, note or reminder records a before/after snapshot ([services/activity.service.js](../server/src/services/activity.service.js)); `POST /api/me/activity/:id/undo` restores it.
- **Why:** an agent that changes your data must be easy to correct; the same mechanism gives the Activity screen and receipts in chat.
- **Trade-off:** extra writes per change, and undo is limited to a recent window so old snapshots cannot overwrite newer edits.

## 6. AI gateway with a model chain (Gemini by default, Claude optional)

- **What:** all model calls go through [ai/gateway.js](../server/src/ai/gateway.js): per-model app limits counted in MongoDB, per-user quotas, timeouts, retries honouring `Retry-After`, a circuit breaker ([ai/circuitBreaker.js](../server/src/ai/circuitBreaker.js)), and a chain of models: when one hits its limit (429) the next answers at once. [ai/provider.js](../server/src/ai/provider.js) switches between Gemini and Claude with `AI_PROVIDER`.
- **Why:** Gemini's free tier fits a student project but has small per-minute and per-day limits. The app must keep working when the AI is slow, down or out of quota.
- **Trade-off:** replies can come from a smaller model when the first one is full. Without any AI, chat says so kindly; tasks, notes, reminders and the timer still work, and reminders go out with their plain text, never late.

## 7. Login: scrypt, JWT in an httpOnly cookie, session version

- **What:** passwords hashed with Node's built-in `scrypt` on the thread pool ([security/password.js](../server/src/security/password.js)); a JWT in an httpOnly, `SameSite=Lax`, `Secure` (production) cookie; the token carries `sv` = the user's session version ([middleware/auth.js](../server/src/middleware/auth.js)). Optional "Continue with Google" checks Google's signed ID token on the server.
- **Why:** pure-JavaScript bcrypt froze the event loop under load (health checks dropped to 21 req/s while logins ran; 5,135 req/s after the switch, see SCALING.md). An httpOnly cookie cannot be read by page scripts. Raising the session version logs out every device after a password reset.
- **Trade-off:** a stateless JWT cannot be revoked one by one; the 30-second user cache means another instance notices a reset within 30 seconds.

## 8. Same-origin deployment

- **What:** in production Express serves the built React app and the API from one address.
- **Why:** the login cookie works without CORS or third-party-cookie problems; one service to deploy.
- **Trade-off:** the frontend cannot be put on a separate CDN without adding CORS and cross-site cookie settings.

## 9. Live updates with Server-Sent Events

- **What:** `GET /api/me/events` streams `notification` and `changed` events; chat replies also stream as SSE. Each instance keeps its own connections and polls MongoDB every 2 seconds for its users.
- **Why:** traffic is server-to-browser only, SSE works through proxies and reconnects by itself, and needs no extra service.
- **Trade-off:** up to 2 seconds of delay across instances; at larger scale a pub/sub (Redis) would replace the poll.

## 10. Notifications: Web Push first, email as a fallback

- **What:** [services/delivery.service.js](../server/src/services/delivery.service.js) sends each notification once: quiet hours 23:00 to 07:00 (only reminders and timers ring), Web Push to every registered device (VAPID, [services/push.service.js](../server/src/services/push.service.js)), and an email copy only for important kinds when push reached no device and the app is closed (at most 10 a day).
- **Why:** reminders must arrive with the app closed, on phones and computers, without a paid service. Emails go through an HTTPS email API ([services/mail.service.js](../server/src/services/mail.service.js): Resend first, then Brevo) because Render's free plan blocks SMTP ports; SMTP still works on a laptop. A failed send is logged and never breaks the request that caused it.
- **Trade-off:** iPhone push needs "Add to Home Screen". Without a verified domain, Resend's test sender delivers only to the account owner's address, and email can land in Spam.

## 11. Input validation and errors in one shape

- **What:** zod schemas next to each service, a `validate` middleware, `AppError` for expected failures; every error leaves as `{ error: { code, message, details? } }` with field-level details; `Idempotency-Key` on create endpoints ([middleware/idempotency.js](../server/src/middleware/idempotency.js)).
- **Why:** the UI can show the message under the right field, and a double click or a retried request never creates a duplicate.
- **Trade-off:** schemas are written by hand (no shared types with the client).

## 12. Frontend: React, one 3D element, a 2D fallback

- **What:** React 19 + Vite + Tailwind; Saathi's face is the only 3D element (React Three Fiber, [components/Face3D.jsx](../client/src/components/Face3D.jsx)) with an SVG version ([components/Face.jsx](../client/src/components/Face.jsx)) used without WebGL or with reduced motion. The landing page's Three.js scene is lazy-loaded only for logged-out visitors.
- **Why:** the face is what makes Saathi feel like a friend; everything else stays light and fast on low-end phones.
- **Trade-off:** a bigger bundle for the 3D parts, so they load on demand and stop rendering when hidden.

## 13. Tests against a real database, with a fake AI

- **What:** 154 tests with `node:test` and supertest against a separate MongoDB database (`saathi_test`); the AI, push sender and mail outbox are replaced by fakes ([server/tests](../server/tests)).
- **Why:** the hard parts (atomic claims, unique indexes, quotas across instances) only show their bugs against a real MongoDB; a fake AI makes tests free and repeatable.
- **Trade-off:** tests need network access to Atlas and take several minutes; they must never share a database with a running server (they drop it).
