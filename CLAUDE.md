# CLAUDE.md: Saathi

Read this whole file before doing anything. It is the hand-off from the earlier build sessions: what Saathi is, who you are working with, what is already built, and exactly what comes next.

## Who you are working with

- **Himanshu**, a college student in India, on a **Windows** laptop. He uses PowerShell; the project is at `C:\Users\haris\Documents\saathi`.
- He is **new to terminals, Git and deployment**. He writes in **Hinglish** (Hindi in Latin script mixed with English). Reply in simple Hinglish, short sentences, no jargon without a one-line explanation.
- Work **one step at a time**. After each step, say in 3 to 5 plain lines what was built and how it works, so he can explain it in his viva. He must be able to understand and present the code.
- Prefer doing things yourself (running commands, fixing errors) and asking him only for a quick "haan" before anything big or irreversible.
- He wants the app to feel **world class**: polished UI, motion, an animated face, a friendly voice. Be honest when something cannot be done well in the time left, and offer the best realistic version.

## The project

**Saathi** ("companion") is a personal AI agent that does work, not just chat. You type or speak ("kal 9 baje lab file submit karne ka reminder lagao"), and Saathi creates the task and reminder in your account, then reminds you on time. It talks like a close friend, has an animated face with expressions, remembers you long term, and works by voice too.

- College **End-Term Software Project**. Official deadline **27 Oct 2026, 11:59 PM IST**. Himanshu wants to **submit by 23 Oct** (24 Oct at the latest).
- Submission needs: GitHub repo with real commit history, a public deployment, README, a 3 to 5 minute demo video, and the Google Form.
- The rubric rewards: real workflows (not CRUD, not a thin API wrapper), engineering depth, error handling (invalid input, failed APIs, duplicates, unauthorized access), security (no secrets in Git, hashed passwords, auth), loading/empty/error states, and meaningful commits. **Depth beats feature count.** Every feature must actually work end to end.
- It is fine (and allowed) that AI writes code. The README already has an "AI usage" section.

## Current status

**Done and committed** (Steps 1 and 2), backend only, all in `server/`:

- Auth: signup, login, logout, `/me`; scrypt password hashing (off the event loop); JWT in an httpOnly cookie; per-IP and per-account login limits.
- Tasks (due date, priority, tags, `kind: deadline` for countdowns), notes, reminders (fired by a background worker exactly once; snooze; cancel).
- Undo for every change via an activity log; Idempotency-Key support; duplicate reminder detection.
- Today panel data (`/api/me/today`), weekly progress and streak (`/api/me/progress`), typing hints (`/api/me/hints`), notifications, activity timeline.
- Scaling groundwork: stateless instances, MongoDB job queue (`src/jobs`), shared quotas, AI gateway with retries/fallback model/circuit breaker (`src/ai/gateway.js`, not yet wired to Claude), health checks, graceful shutdown, structured logs. See `docs/SCALING.md`.
- 63 tests (`npm test`; integration tests need `MONGODB_URI_TEST` pointing at a separate database, e.g. the same Atlas URI with `/saathi_test`).

**Step 3 (agent): code done, tested with a fake provider (86 tests pass); not yet tried against the real Claude API** because there is no API key yet. Files: `src/ai/{provider,tools,prompt,expression}.js`, `services/{agent,memory,planner}.service.js`, `routes/agent.routes.js`, models `Conversation` (rolling summary embedded), `Message`, `Memory`, `PendingAction`, `DayPlan`, job `agent.summarize`. Expression = a `[face:x]` tag at the start of the reply, stripped while streaming. Prior turns are replayed as plain text (thinking blocks are kept only inside one turn, so the history-editing check of current models never trips). `MONGODB_URI_TEST` is now in `server/.env`.

**AI provider switched to Gemini (free tier) on 18 Oct 2026**, Claude kept as an option. `AI_PROVIDER=gemini|anthropic` (default gemini) in `env.js`; `env.js` also exports `ai` (selected key, key name, models). `src/ai/gemini.js` (official `@google/genai` SDK) translates the Claude-format request/answer to and from Gemini, so `agent.service.js` is unchanged: tools become `functionDeclarations` (`parametersJsonSchema`), `tool_choice none` becomes mode `NONE`, effort becomes `thinkingLevel` on gemini-3 models, and Gemini's raw parts are kept in a `gemini_parts` block and sent back unchanged inside a turn (Gemini 3 needs its thought signatures). Errors: 429 with a short `retryDelay` is retried; the daily limit and a bad key become friendly non-retryable errors (`retryable: false`, they do not trip the breaker). Per-user and app-wide limits: see below. Models: see the model chain below. Tests: `tests/gemini.test.js` with a fake Gemini client.

**Live test passed (18 Oct)** with the real Gemini key (new keys start with `AQ.`; the app accepts any non-empty key). "kal subah 9 baje lab file submit karni hai, yaad dila dena" -> `create_task` + `set_reminder` (linked, 19 Oct 9:00 AM IST), face `happy`, a short Hinglish reply; about 20 s for 3 model calls. Greeting live test passed (Hinglish, name, "Sunday shaam", 5-minute cache works). Gemini streaming sometimes hangs, hence the shorter timeouts below. On Windows, run the server with `node src/index.js` in background tasks (stopping `npm start` can leave the node child running on port 4000).

**Limits, timeouts and the model chain (18 Oct, all in `.env`):** `AI_REQUEST_TIMEOUT_MS=20000` per attempt, `AI_TOTAL_TIMEOUT_MS=28000` per AI call including retries (the gateway cuts the last attempt short to meet it). Per-user `AI_USER_PER_MINUTE=20`, `AI_USER_PER_DAY=300` (only spam hits them). **Model chain** `GEMINI_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash` (IDs verified with the models list API; function calling verified live on all three; free tier per ai.dev/rate-limit: Lite models 15 RPM / 500 RPD, 3.8 Flash 5 RPM / 20 RPD, per model per project, daily reset 00:00 UTC = 5:30 AM IST). **Per-model app-wide limits** `AI_MODEL_LIMITS=gemini-3.5-flash-lite=13/480,gemini-3.1-flash-lite=13/480,gemini-3.8-flash=4/18`, counted in MongoDB (`ai:model:<model>:min|day`) for every request (steps and retries too). `gateway.pickModel` takes the first model with room; a Gemini 429 (`err.rateLimit` = minute/day, set in `gemini.js`) marks that model full (`quota.fill`) and the next model answers at once (does not use up `retries`); 5xx also moves down the chain. When every model is at its limit a new message/greeting gets the Hinglish `AI_BUSY` (some model is only minute-limited) or `AI_DAILY_LIMIT` message; follow-up steps of a started message (`continuation: true`) still go out, so a message is never cut off halfway. Switching models mid-turn works: Gemini accepts another model's thought signatures (checked live; removing them gives 400). Tasks, notes, reminders keep working without AI. 96 tests pass.

**Live tests clean up after themselves:** use `npm run live:chat -- "message" ...` (server running; signs up `live.<number>@example.com`, prints replies, receipts and saved tasks/reminders, then deletes the account and all its data). `npm run live:cleanup` deletes leftovers. The 7 old test accounts were deleted on 18 Oct. Never name scripts `*-test.js` or `test-*.js` (Node's test runner picks them up); `npm test` only runs `tests/**/*.test.js`. **Live tests on the chain passed (18 Oct evening, all answered by gemini-3.5-flash-lite, 4 to 13 s per message):** lab-file reminder (task + reminder 19 Oct 9 AM); study plan. The first study-plan run found a bug: changing the plan ("roz 7 baje") made a second plan next to the first (the model used `force`). Fixed: `make_study_plan` has `replace: true` (cancels the upcoming sessions' reminders and removes those tasks through the services, so it is undoable; the exam deadline is reused), `force` is only for two separate plans, and the conflict error tells the model to use `replace`. Persona: ask once for topics (and study time unless memories say) before making a plan. Rerun: Saathi asked for topics, made 6 sessions at 7 PM, then "raat 9 baje kar do" replaced them with 7 sessions at 9 PM (no duplicates). Small known quirk: the Lite model sometimes forgets `subject` on the first try and fixes it after the validation error (one extra request). 97 tests pass. **Next:** persona tuning (optional), then Step 4.

**Not started:** Step 4 onwards (live updates, frontend, face and voice, deploy).

## Environment facts (important)

- Node 24, Git 2.55, Windows PowerShell. Run the server from `server/`: `npm run dev` (watch mode). It must print `connected`, `worker started`, `listening on http://localhost:4000`.
- Database: **MongoDB Atlas free tier (M0), Mumbai region**, accessed with Mongoose. Limits: 100 ops/sec, 500 connections, 0.5 GB.
- Himanshu's internet **breaks DNS SRV lookups** (`querySrv EBADRESP`, even via public DNS). So `server/.env` uses Atlas's **legacy `mongodb://` URI** (three shard hosts, `replicaSet=...`, `authSource=admin`), not `mongodb+srv://`. Keep it that way. `src/db/connect.js` also has a public-DNS fallback for SRV.
- `server/.env` holds real secrets (Atlas password, JWT secret). **Never print it, never commit it, never paste it into chat.** It is in `.gitignore`. When a new variable is needed, add it to `.env.example` with a comment and ask Himanshu before editing `.env` (or edit it yourself without echoing values).
- The Atlas password was shown in an early screenshot. **Before deploying, have Himanshu reset the database user's password in Atlas (Database Access) and update `.env`**, then set Network Access to `0.0.0.0/0` for Render.
- AI: Gemini free tier is the active provider (`AI_PROVIDER=gemini`, key in `GEMINI_API_KEY` from aistudio.google.com). Claude stays an option for later (`AI_PROVIDER=anthropic`, key in `ANTHROPIC_API_KEY` from console.anthropic.com, needs paid credit; Claude.ai Pro and API credits are separate things). Never print or log either key.
- Git identity is set (`Himanshu`). Commit after each working step with a clear message. Check `git status` before every commit so `.env` and `node_modules` never get added.

## Architecture and conventions (follow these)

```
server/src/
  config/env.js      every env var, validated with zod; server refuses to start if invalid
  db/connect.js      Mongoose connection (pool size, fail-fast, DNS fallback)
  models/            Mongoose schemas + publicX() serializers (never send raw docs)
  services/          business logic (no req/res); zod schemas live next to the service
  routes/            thin Express routers: requireAuth -> validate -> service -> json
  middleware/        auth (JWT cookie + 30 s user cache), validate, errors, overload, idempotency
  jobs/              queue.js (atomic claim, lock tokens, retries, dead letter), worker.js, handlers/
  ai/                gateway.js (all model calls go through it), circuitBreaker.js
  security/          password hashing
  utils/             AppError, retry, semaphore, ttlCache, time (luxon, user timezone), schemas
```

- Errors: throw `AppError` (`badRequest`, `unauthorized`, `notFound`, `conflict`); everything leaves as `{ error: { code, message, details? } }`. Messages are plain and say what to do next.
- Every query is scoped by `userId`; other users' items are 404, not 403.
- Every change to a task, note or reminder goes through its service so it is recorded in the activity log (`actor: 'user' | 'agent'`) and stays undoable. The agent must use the same services, never the models directly.
- Dates: ISO 8601 with offset. "Today" is computed in the user's timezone (`utils/time.js`).
- ESM, Express 5 (async errors handled natively), zod 4, Mongoose 9, luxon. Code must run on Windows (no bash-only scripts in `package.json`).
- Tests: `node:test` + supertest. Add tests for each new workflow, including failure cases.

## Remaining plan

Keep this order. Each step ends with: it runs, tests pass, a short explanation to Himanshu, a commit.

### Step 3: the agent (Saathi's brain)

- Install `@anthropic-ai/sdk`. Create the client with `maxRetries: 0` (the gateway does retries). Models: `ANTHROPIC_MODEL=claude-haiku-5-5` (fast, cheap), fallback `claude-sonnet-5-5`. Check current model IDs and tool-use docs on docs.claude.com / platform.claude.com before coding.
- Models: `Conversation`, `Message` (role, content blocks, tool calls and results, tokens), `Memory` (userId, text, kind, source message, createdAt; long-term facts), `ConversationSummary` (rolling summary).
- Tool-use loop in `services/agent.service.js`: call Claude with tools, execute `tool_use` blocks through the existing services (validated with the same zod schemas), return `tool_result` blocks (`is_error: true` with an instructive message on failure), loop until `end_turn`, with a hard cap on iterations. Stream text to the client (SSE) and emit an "action receipt" event per tool call (what changed + activity id for Undo).
- Tools: `create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task` (ask for confirmation first, see below), `save_note`, `search_notes`, `set_reminder`, `list_reminders`, `snooze_reminder`, `cancel_reminder`, `get_today`, `remember_fact`, `recall` (search memories and past messages), `undo_last_action`, `make_study_plan` (creates several tasks and reminders across days for an exam date; the demo's best moment).
- Confirmation for destructive actions: the agent proposes, the UI shows Confirm/Cancel, and only then the delete runs.
- Before `create_task`, check `findSimilarOpen` and tell the user if a similar open task exists.
- Memory: always include the user's memories + the rolling summary + recent messages in context; summarise older turns with a background job; `recall` searches older messages (regex/text search is fine). Settings page later lists memories with delete.
- Personality (system prompt): a close friend, not an assistant. Uses the user's name, mirrors their language (Hindi/English/Hinglish) and tone, short WhatsApp-length replies, light teasing and jokes, celebrates wins, gently pushes back on procrastination, cares about sleep late at night. Never claims to be human; if asked, it is your AI friend. Never just agrees with everything. **No scripted lines anywhere:** every greeting, reply and reminder text is generated live with the user's name, local time of day, today's agenda and memories in context.
- Each reply also returns an **expression** for the face (one of: happy, excited, laughing, thinking, concerned, surprised, sleepy, proud, sorry), chosen by the model, e.g. via a small structured field or tool.
- Greeting endpoint: `/api/agent/greeting` generates a fresh line on app open (cache it a few minutes per user to save cost).
- Failure handling: all calls through the gateway; per-user quotas; if the AI is unreachable, return a clear friendly fallback and keep the rest of the app working.
- Tests with a fake provider (no real API calls in tests).

### Step 4: live updates and proactive Saathi

- SSE endpoint `/api/me/events` (auth by cookie): pushes new notifications, agent stream events, Today panel refreshes. Across multiple instances: each instance polls new notifications every ~2 s for its connected users (no Redis needed yet; see SCALING.md).
- Reminder text written by the AI at fire time (friendly, with context), with the plain reminder text as fallback.
- **Nudges:** a periodic job finds overdue tasks and lets Saathi message first ("Bhai, lab file ka kya hua? Abhi kar lein ya kal subah ka reminder laga doon?"), at most once per task per day, never at night.
- **Recurring tasks (daily/weekly):** add `repeat: { every: 'day' | 'week', days?: [...] }` to tasks. Completing one creates the next occurrence (idempotently). Show a streak per habit.
- Browser notifications (Notification API) when the tab is in the background.

### Step 5: frontend

- `client/`: Vite + React + Tailwind CSS + Motion (`motion` package). Served by Express in production from the same origin (cookies keep working); Vite dev server proxies `/api` to port 4000 in development.
- Screens: login/signup; Home = chat (left/center) + Today panel (right); Tasks (Open / **Completed** tabs; completed view grouped by day with the weekly progress chart); Notes; Reminders; Activity timeline with Undo; Settings (name, timezone, voice, what Saathi remembers).
- Every screen handles loading, empty (an invitation to act), error (what went wrong and what to do) and success states.
- Undo toast for 10 s after each change (agent or user). Typing hints under the chat input as you type. Snooze buttons on reminder notifications.
- **The look is Himanshu's choice.** Before writing any UI code, ask him which direction he likes (see the options below, or his own idea, or apps he likes the look of), then build ONE preview screen (Home with chat + Today panel + face) and get his OK before building the rest. The direction below is only the default if he has no preference.
- **Scroll experience (Himanshu asked for ALL of these):** a public landing page before login (what Saathi does, the face, 3 to 4 sections) with:
  1. a scroll-down indicator at the bottom of the hero (small mouse/arrow icon with a moving dot; click scrolls smoothly to the next section);
  2. scroll-triggered reveals: each section's content eases in as it enters the viewport (one well-timed reveal per section, staggered children, not the same fade-up on every element);
  3. buttery smooth page scrolling (Lenis);
  4. nav links that smooth-scroll to their section, with the active section highlighted in a sticky header.
  Inside the app: chat auto-scrolls smoothly to new messages, with a "Naye messages ↓" button when scrolled up. Respect `prefers-reduced-motion` everywhere (no smooth scroll or reveals when it is on).
- UI ideas he can pick from: command palette (Ctrl+K) to do anything fast; skeleton loaders instead of spinners; Saathi's face appearing in empty states with a friendly line; subtle completion sound (toggle in Settings); dark/light toggle; mobile-first layout with bottom navigation on phones; drag to reorder tasks; swipe to complete on mobile.
- App name stays **Saathi**.
- **Design reference chosen by Himanshu: "AI Common: Between AI and Humans" (featured on awwwards.com/websites/animation).** Its feel: near-black background, one glowing warm golden glass orb lit from within as the hero, big confident headline type, lots of calm empty space, premium (CRED-like). Translate that to Saathi: **dark-first** UI; Saathi's 3D face is that glowing golden orb (with friendly eyes and mouth, expressions as described in Step 6); headlines large and confident; everything else quiet so the orb glows. Light mode exists but dark is the default and the one to polish first. Take the feel, do not copy layouts, text or assets. Show him the preview screen and ask "AI Common jaisa feel aa raha hai?" before building the rest.
- Palette update for this direction: background `#0B0D14`-ish deep ink (not pure black), surfaces slightly lifted, the orb and primary accent warm gold/amber (marigold `#F2A541` deepening to amber), text warm off-white, leaf teal for success, vermilion only for errors/overdue.
- **ON HOLD (18 Oct 2026, Himanshu is still changing the design): do NOT port `design/saathi-orbit.html` into the app until Himanshu explicitly says so.** Do not edit that file either unless he asks.
- **Landing page hero = the Saathi Orbit scene** (Himanshu asked for it; working prototype at `design/saathi-orbit.html`, open it in a browser). Built from his reference video (a "BlueOrbit" site: big particle-dot planet with a blue atmospheric rim, faint orbit lines, shooting-star streaks, dots that light up near the cursor), turned into a solar system: Saathi's glowing gold core in the centre, its features (Tasks, Reminders, Study plan, Memory, Voice) orbiting as dotted planets with atmosphere rims on tilted elliptical orbits at different speeds (two retrograde), glowing orbit rings, a dust ring and a moon, three layers of twinkling stars with parallax, nebula haze, shooting stars, slow cinematic camera drift plus mouse parallax, cursor-reactive dots, and pause/speed/labels controls. Port it into the React app as the landing hero (React Three Fiber or keep the plain Three.js code in a component), keep the same look and motion, and keep the core's colour in sync with the orb-face hues (Step 6). Pause rendering when off screen; reduced motion = slow speed and no camera drift.
- **Landing page features section: 3D folding panels** (Himanshu liked a Dribbble shot, "The Real Estate Fund" by DD NYC: pages folded like an accordion in 3D perspective on black, rotating and unfolding). For Saathi: 4 to 5 feature panels (Chat that acts, Reminders, Study plan, Voice + face, Memory) arranged as a zig-zag fold in perspective; as you scroll, the fold opens and each panel turns to face the viewer in turn, then flattens into the next section. Build with CSS 3D transforms (`perspective`, `rotateY`, `transform-style: preserve-3d`) driven by Motion's `useScroll`/`useTransform`; no WebGL needed. Panels use the dark + golden-glow look, each with a small live UI snippet (a receipt slip, a reminder card, the 2D face) instead of photos. Reduced motion: show the panels flat in a simple grid.
- **Second reference he liked: "AI Assistant Mobile App" by Nexign Studio (Dribbble).** Dark purple-black gradients; onboarding "Meet your smart AI assistant" with a glowing human-like AI bust; Home greets by name ("Hi Zenya, how can I assist you today?") with a search/ask bar, quick-action cards and a history list; voice screen with "I'm listening...", a glowing orb with a live waveform inside, the live transcript below, and round controls (restart, mic, close). Use these screen ideas for Saathi:
  - **Onboarding (3 short screens after signup):** "Milo apne Saathi se" hero, what it does, voice permission. Hero art: a glowing stylized "digital human" bust in Saathi's colours. Use only art Himanshu owns or that is free to use (CC0 / generated by him); never copy the Dribbble image.
  - **Home:** "Hi Himanshu, aaj kya karna hai?" (generated line, not fixed), ask bar, quick-action cards (Study plan, Plan my day, Add reminder, Quick add), recent conversations, Today panel.
  - **Voice mode (full screen):** the 3D face/orb centred with a live audio waveform glowing inside it, status text ("Sun raha hoon...", "Soch raha hoon...", "Bol raha hoon..."), live transcript, round controls (restart, big mic, close).
- **Colour decision combining both references:** dark base stays; Saathi's orb/face **changes hue with its state and mood**: listening = violet/magenta (Nexign feel), speaking/happy/proud = warm gold (AI Common feel), thinking = deep indigo swirl, concerned/sorry = soft blue, sleepy = dim amber. Transitions between hues are smooth. UI accents follow gold (primary) with violet used for voice and AI-in-progress states.
- **Human face, honestly scoped:** a fully realistic talking human head with lip-sync is out of scope (uncanny, heavy, not doable well before the deadline). The human-like look appears as the onboarding/landing hero art (still image or subtle parallax/glow). The interactive face that talks and shows expressions is the stylized 3D orb-face (with the 2D fallback).
- **Creative freedom:** Himanshu gave a free hand on design. Within the direction above, make your own best calls on details (micro-interactions, transitions, empty states, small delights), but: keep it fast (Lighthouse performance 85+ on the landing page), accessible, consistent, and on schedule. Polish the core screens before adding extra flourishes. Show him each major screen and adjust to his taste.
- Default design direction (keep it distinctive, not a template):
  - Subject: a friend who keeps your day with you, for Indian students.
  - Type: **Baloo 2** for display (rounded, friendly, Indian-designed, has Devanagari) and **Mukta** for body (Devanagari support, very readable). Google Fonts.
  - Palette (tokens in Tailwind config, light and dark): ink navy `#1B2240`, cool paper `#F3F5F9`, marigold accent `#F2A541`, leaf teal `#2F8F83` for success, vermilion `#E4572E` only for errors and overdue. Dark mode background ink `#141A33`.
  - Avoid generic AI-UI tells: no identical rounded cards everywhere with the same grey shadow, no ALL-CAPS eyebrow labels, no gradient washes, no "→" on every button, no cream + terracotta.
  - The one memorable element is **Saathi's face**; everything around it stays calm. Agent actions appear in chat as small "receipt" slips (what changed, Undo).
  - Motion only where something changes: messages arriving, receipt stamping in, Today items reordering when the agent adds or completes something, a small celebration when a task is completed. Respect `prefers-reduced-motion`.
  - Responsive down to phone width, visible keyboard focus, good contrast.

### Step 6: face and voice

- **Face (decided: 3D hero, Himanshu wants a world-class 3D look):** Saathi's face is the ONE real 3D element in the app, built with **React Three Fiber + drei** (Three.js): a glowing, softly lit orb-like character with simple friendly features (eyes, mouth) that reads as a face, not a blob. Only the face is 3D; the rest of the UI stays fast 2D with light depth (subtle 3D tilt on hover for key cards, layered parallax on the landing page, frosted-glass panels sparingly).
  - States: idle (gentle float, breathing, blinking, eyes follow the cursor), listening (pulses with real mic volume via Web Audio analyser), thinking (eyes glance around, slow swirl), acting, speaking (mouth and glow move with speech), error.
  - Expressions from Step 3 (happy, excited, laughing, thinking, concerned, surprised, sleepy, proud, sorry) change eye/mouth shapes, colour temperature and motion, with smooth tweened transitions.
  - Landing page: scroll-linked 3D: the face rotates, moves and scales between sections as you scroll.
  - Performance: lazy-load the 3D bundle, cap device pixel ratio (`dpr={[1, 1.5]}`), pause rendering when the tab is hidden or the face is off screen, target 60 fps on a normal laptop.
  - **Fallback:** an SVG + Motion 2D version of the same face with the same states/expressions, used when WebGL is unavailable, on low-power devices, or with `prefers-reduced-motion`. Build the 2D version first (it is quick and always works), then the 3D one.
  - Small face next to chat replies uses the 2D version (cheap); the big face (voice mode, landing, Home header) uses 3D.
- Voice: Web Speech API (`SpeechRecognition` for input, `speechSynthesis` for output), `hi-IN` / `en-IN`. Push-to-talk plus a hands-free conversation mode (listen again after Saathi finishes speaking). Mouth animation is driven while speaking (approximate, not phoneme lip-sync). Recommend **Microsoft Edge** for the demo (better Indian voices). Feature-detect and show a clear message in browsers without support. No always-on wake word.

### Step 7: polish, deploy, submit

- PWA (manifest + service worker) so it installs like an app.
- README: finish every section (problem, users, solution, features, stack, architecture diagram, local setup, env vars, deployment link, AI usage, roadmap).
- Deploy on Render with `render.yaml` (Docker, Singapore region, health check `/api/health/ready`). Reset the Atlas password first; Atlas Network Access `0.0.0.0/0`. Note: Render's free tier sleeps after 15 min idle; reminders due while asleep fire on wake. A free uptime monitor pinging `/api/health/live` keeps it awake for the demo.
- Demo video script (3 to 5 min): problem → greeting by name → voice: "25 ko DBMS exam hai, plan bana do" → study plan appears with receipts → Undo → reminder fires live → Today panel and streak → error handling moment → architecture in 30 s.
- Final check: open GitHub, deployment and video links in an incognito window.
- **REMINDER RULE (Himanshu explicitly asked for this):** whenever submission comes up, and again right before he fills the Google Form, remind him in bold: *"Submit karne se pehle teeno links (GitHub, Render, demo video) Incognito window (Ctrl + Shift + N) mein khol kar check karo. Sir ne khaas taur par ye bola hai."* Do not let him submit until he confirms all three open without asking for login or permission.

## Approved extra features (build these too)

Fit them into the steps above (agent tools in Step 3, jobs in Step 4, UI in Step 5):

- **Plan my day:** Saathi arranges today's open tasks into time slots (asks once for his class timings and remembers them as a memory). Agent tool `plan_my_day`; shown as a timeline on the Today panel.
- **End-of-day recap:** around 9 to 10 PM (user's timezone) a job asks Saathi for a short friendly recap ("aaj 4 kaam kiye, 2 bache hain") with buttons to move leftovers to tomorrow. Once per day, skipped if the user was inactive.
- **Quick add:** an input on the Tasks page; a sentence like "kal 5 baje DBMS assignment, important" becomes a task with due date and priority (one small AI call that returns structured fields, validated with zod, with a preview before saving; falls back to a plain task if the AI is unavailable).

## Optional, only if everything above is done and working

- **Focus mode:** 25-minute timer; Saathi's face shows a "studying" expression and holds nudges until it ends.
- **Sunday letter:** every Sunday evening Saathi writes a short personal note about the week (what went well, streaks, one suggestion), saved and shown on the Today panel.

Do not add anything else before submission. Depth over feature count.

## Later (after submission, roadmap only)

Google Calendar sync, PDF/syllabus upload into tasks, WhatsApp/Telegram bot, web search tool, shared tasks with friends.
