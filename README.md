<div align="center">

<img src="docs/banner.svg" alt="Saathi: a glowing golden face at the centre of a small solar system of its features (Tasks, Reminders, Study plan, Memory, Voice). Your AI friend who gets things done." width="100%">

<br><br>

<p><a href="https://saathi-ksk8.onrender.com"><img src="docs/readme/btn-live.svg" alt="Live demo" height="48"></a>&nbsp;<a href="#screenshots"><img src="docs/readme/btn-screenshots.svg" alt="Screenshots" height="48"></a>&nbsp;<a href="#getting-started"><img src="docs/readme/btn-docs.svg" alt="Docs" height="48"></a></p>

<br><br>

<img src="https://img.shields.io/badge/Node.js-20%2B-F2A541?style=for-the-badge&labelColor=1B2148&logo=nodedotjs&logoColor=F6C46F" alt="Node.js 20+">
<img src="https://img.shields.io/badge/React-19-F2A541?style=for-the-badge&labelColor=1B2148&logo=react&logoColor=F6C46F" alt="React 19">
<img src="https://img.shields.io/badge/MongoDB-Atlas-F2A541?style=for-the-badge&labelColor=1B2148&logo=mongodb&logoColor=F6C46F" alt="MongoDB Atlas">
<img src="https://img.shields.io/badge/AI-Google%20Gemini-F2A541?style=for-the-badge&labelColor=1B2148&logo=googlegemini&logoColor=F6C46F" alt="AI: Google Gemini">
<img src="https://img.shields.io/badge/Deployed-Render-F2A541?style=for-the-badge&labelColor=1B2148&logo=render&logoColor=F6C46F" alt="Deployed on Render">
<img src="https://img.shields.io/badge/Tests-156%20passing-F2A541?style=for-the-badge&labelColor=1B2148" alt="156 tests passing">

<br><br>

### Your AI friend who gets things done.

Tell Saathi what you need, by typing or speaking, and it does the work: tasks, reminders, study plans and notes in your own account.<br>
It reminds you on time, remembers what matters to you, and talks like a close friend, in your language.

<p><i>"kal subah 9 baje lab file submit karni hai, yaad dila dena"</i><br>
<sub>→ a task for tomorrow, a reminder at 9 AM, and a receipt with <b>Undo</b></sub></p>

**Live app:** [saathi-ksk8.onrender.com](https://saathi-ksk8.onrender.com)

</div>

> [!NOTE]
> The free server sleeps after 15 minutes without visitors, so the first visit can take up to a minute to wake it.

<p align="center">
  <img src="docs/screenshots/home-chat.webp" alt="Saathi chat: a reminder set from one Hinglish sentence, with receipts and Undo" width="100%">
</p>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

## Contents

<table>
  <tr>
    <td valign="top"><a href="#whats-new"><b>What's new</b></a><br><a href="#for-evaluators"><b>For evaluators</b></a><br><a href="#why-saathi">Why Saathi</a><br><a href="#features">Features</a><br><a href="#try-it-in-60-seconds">Try it in 60 seconds</a><br><a href="#screenshots">Screenshots</a><br><a href="#faq">FAQ</a></td>
    <td valign="top"><a href="#architecture">Architecture</a><br><a href="#engineering-highlights">Engineering highlights</a><br><a href="#tech-stack">Tech stack</a><br><a href="#getting-started">Getting started</a><br><a href="#environment-variables">Environment variables</a></td>
    <td valign="top"><a href="#api">API</a><br><a href="#project-structure">Project structure</a><br><a href="#deployment">Deployment</a><br><a href="#known-limitations">Known limitations</a><br><a href="#roadmap">Roadmap</a><br><a href="#ai-usage">AI usage, credits and author</a></td>
  </tr>
</table>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="whats-new"></a>
## <img src="docs/readme/icons/features.svg" width="34" height="34" align="top" alt=""> What's new

<table>
  <tr>
    <td valign="top" width="160"><b>27 Oct 2026</b><br><sub>submission day</sub></td>
    <td valign="top">

- **Continue with Google:** a premium dark-glass button with Google's official "G", that takes you to Google's own sign-in page and back. `state` and a server-checked `nonce` stop forged returns and copied tokens; an existing account with the same email is joined, not duplicated
- **Password reset email through Resend:** Render's free plan blocks SMTP, and Brevo closed our account for sending, so email now goes through Resend's HTTPS API (Resend → Brevo → SMTP → log only). A `MAIL_FROM` like `Saathi <onboarding@resend.dev>` is understood correctly. See [Known limitations](#known-limitations)
- **Focus timer as a cosmic clock:** the golden orbit empties with the time, hour numbers 12, 1 … 11 and small stars around it, a planet with a comet trail, "Khatam hoga 4:45 PM par"
- **Polish:** landing labels never cover the headline, bigger timer digits, phone tap targets, the Undo bar no longer covers the chat box, autofill on login forms with the last email remembered
- **Reminders over NASA's black hole** visualization (NASA Goddard / Jeremy Schnittman, credited in [CREDITS.md](CREDITS.md))
- **Safer and steadier:** logging out removes the device from push; the live app uses the `saathi` database and tests use `saathi_test` only; an UptimeRobot monitor keeps the free server awake
- **Bug hunt** before submission: [docs/BUG-REPORT.md](docs/BUG-REPORT.md). **Architecture decisions:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

</td>
  </tr>
</table>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="for-evaluators"></a>
## <img src="docs/readme/icons/check.svg" width="34" height="34" align="top" alt=""> For evaluators

Where to find the evidence for each part of the rubric. Every link goes to the real code, test or document.

| Area | Weight | What to look at | Evidence |
|---|---|---|---|
| **Problem** | 10% | A real, everyday problem for students, solved by acting on their data instead of chatting about it | [Why Saathi](#why-saathi), [Try it in 60 seconds](#try-it-in-60-seconds) |
| **Core implementation** | 25% | An AI agent with 18 tools that run through the same validated services as the screens; reminders fired exactly once by a worker; study plans, habits, focus timer, notifications | [agent.service.js](server/src/services/agent.service.js), [ai/tools.js](server/src/ai/tools.js), [jobs/handlers/reminder.js](server/src/jobs/handlers/reminder.js), [habit.service.js](server/src/services/habit.service.js), [focus.service.js](server/src/services/focus.service.js), [agent.test.js](server/tests/agent.test.js) |
| **Engineering** | 20% | Atomic job queue with locks and dedupe keys, AI gateway with model chain, quotas, retries and circuit breaker, idempotency keys, undo log, load-tested and fixed | [jobs/queue.js](server/src/jobs/queue.js), [ai/gateway.js](server/src/ai/gateway.js), [middleware/idempotency.js](server/src/middleware/idempotency.js), [activity.service.js](server/src/services/activity.service.js), [docs/SCALING.md](docs/SCALING.md), [scaling.test.js](server/tests/scaling.test.js), [resilience.test.js](server/tests/resilience.test.js) |
| **Architecture** | 15% | Thin routes → services → models; one image with web / worker roles; every decision with its trade-off | [Architecture](#architecture), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [Project structure](#project-structure) |
| **UX & reliability** | 10% | Loading, empty and error states on every screen; receipts with Undo; works when the AI is down; push with email fallback; phone layout | [ScreenParts.jsx](client/src/components/ScreenParts.jsx), [UndoToast.jsx](client/src/components/UndoToast.jsx), [delivery.service.js](server/src/services/delivery.service.js), [Screenshots](#screenshots), [notifications.test.js](server/tests/notifications.test.js) |
| **Code quality** | 10% | zod validation, one error shape, user-scoped queries (404 for others' data), 156 automated tests, a written bug hunt | [middleware/validate.js](server/src/middleware/validate.js), [utils/AppError.js](server/src/utils/AppError.js), [server/tests](server/tests), [docs/BUG-REPORT.md](docs/BUG-REPORT.md) |
| **Deployment & docs** | 10% | Live on Render from `render.yaml` and a Dockerfile, health checks, env validation, this README | [Live app](https://saathi-ksk8.onrender.com), [render.yaml](render.yaml), [Dockerfile](Dockerfile), [config/env.js](server/src/config/env.js), [Deployment](#deployment) |

<details open>
<summary><b>Feature checklist</b></summary>

| Feature | Works end to end | Tested in |
|---|---|---|
| Sign up, log in, log out, httpOnly cookie, brute-force limits | ✅ | [auth.test.js](server/tests/auth.test.js), [scaling.test.js](server/tests/scaling.test.js) |
| "Password bhool gaye?" reset link (30 min, single use, logs out everywhere) | ✅ (email needs `RESEND_API_KEY` on Render; see [Known limitations](#known-limitations)) | [passwordReset.test.js](server/tests/passwordReset.test.js), [mail.test.js](server/tests/mail.test.js) |
| "Continue with Google" (premium button, Google's sign-in page, state + nonce) | ✅ (needs `GOOGLE_CLIENT_ID` and the redirect URI in Google Cloud) | [google.test.js](server/tests/google.test.js), [googleAuth.js](client/src/lib/googleAuth.js) |
| Email through Resend (then Brevo, SMTP), never crashes a request | ✅ (free tier: owner's inbox only) | [mail.test.js](server/tests/mail.test.js), [passwordReset.test.js](server/tests/passwordReset.test.js) |
| Logout removes the device from push | ✅ | [lib/push.js](client/src/lib/push.js) |
| Chat agent with 18 tools, receipts, Undo, Confirm before delete | ✅ | [agent.test.js](server/tests/agent.test.js) |
| Tasks, notes, reminders with snooze, activity log with Undo, Idempotency-Key | ✅ | [features.test.js](server/tests/features.test.js) |
| Habits with streaks (next occurrence created exactly once) | ✅ | [habits.test.js](server/tests/habits.test.js) |
| Study plan, plan my day, quick add | ✅ | [agent.test.js](server/tests/agent.test.js), [proactive.test.js](server/tests/proactive.test.js) |
| Nudges, evening recap, morning plan, countdowns | ✅ | [proactive.test.js](server/tests/proactive.test.js), [notifications.test.js](server/tests/notifications.test.js) |
| Live updates (SSE) across tabs | ✅ | [live.test.js](server/tests/live.test.js) |
| Push notifications with buttons, quiet hours, email fallback | ✅ (real push checked by hand in browsers) | [notifications.test.js](server/tests/notifications.test.js) |
| Focus timer: any length, pause, +5 min, time-up job, celebration | ✅ | [focus.test.js](server/tests/focus.test.js) |
| AI down, slow or out of quota: model chain, timeouts, friendly message | ✅ | [resilience.test.js](server/tests/resilience.test.js), [gemini.test.js](server/tests/gemini.test.js) |
| Job queue: one claim per job, lock heartbeat, retries, dead letter | ✅ | [scaling.test.js](server/tests/scaling.test.js) |
| Voice input and spoken replies (Edge, Chrome) | ✅ (checked by hand; no automated browser test) | [lib/speech.js](client/src/lib/speech.js) |
| Six languages | ✅ | [agent.test.js](server/tests/agent.test.js) |

</details>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="why-saathi"></a>
## <img src="docs/readme/icons/why.svg" width="34" height="34" align="top" alt=""> Why Saathi

**The problem.** Students juggle assignments, lab submissions, exams and small personal errands across chat messages, notebooks and memory. Normal to-do apps make you stop, open a form, pick a date and type everything in, so things never get written down. Chatbots can talk about your tasks, but they cannot keep, change or remind you of them.

**Who it is for.** College students in India (and anyone with a busy schedule) who would rather say what they need in plain language, in Hinglish, English, Hindi or their own language, than fill in forms.

**The solution.** Saathi is a chat and voice assistant connected to your own data. The AI model (Google Gemini by default, Claude as an option) reads your request and decides which actions to take: create a task, set a reminder, make a study plan, save a note, remember a fact. The server validates every action with the same rules as the normal screens, carries it out against your account, and shows it as a receipt with an Undo button. A background worker fires reminders on time, and Saathi messages you first when something is overdue.

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="features"></a>
## <img src="docs/readme/icons/features.svg" width="34" height="34" align="top" alt=""> Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/ai.svg" width="40" height="40" alt=""><br>
      <b>AI agent, not a chatbot</b><br>
      <sub>18 tools that really change your data, each with a receipt and Undo. Memory, voice and six languages.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/productivity.svg" width="40" height="40" alt=""><br>
      <b>Productivity</b><br>
      <sub>Tasks, habits with streaks, reminders, study plans, plan my day, notes and a cosmic focus timer.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/notifications.svg" width="40" height="40" alt=""><br>
      <b>Notifications everywhere</b><br>
      <sub>Push on phones and computers even with the app closed, written by Saathi, with buttons. Email as a fallback.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/design.svg" width="40" height="40" alt=""><br>
      <b>Design</b><br>
      <sub>A glowing 3D face with expressions, the Saathi Orbit landing page and real space photos on every screen.</sub>
    </td>
  </tr>
</table>

<details open>
<summary><b>🤖 AI agent: an agent, not a chatbot</b></summary>

- Chat with tool calling: 18 tools (tasks, reminders, notes, study plans, plan my day, focus timer, memory, undo) run through the same validated services as the screens
- A receipt with Undo for every change Saathi makes; deleting needs a Confirm tap
- Long-term memory (classes, hard subjects, routines) that you can see and edit in Settings
- Saathi texts first: a nudge about overdue tasks (never at night, at most once per task per day) and an evening recap with "move leftovers to tomorrow"
- **Languages:** Saathi replies in the language you write or speak, with the same friendly personality in every language. Preferred language in Settings: Hinglish, English, Hindi, Marwari (beta), Tamil, Bengali
- **Voice:** mic button in the chat box: speak, your words appear as you talk and are sent when you stop (Web Speech API, Hindi/Hinglish and English). Speaker button (off by default): Saathi's replies are read aloud in the reply's language; the face listens, thinks and speaks

</details>

<details>
<summary><b>📚 Productivity</b></summary>

- Tasks with due dates, priority, tags and deadline countdowns; habits (daily or weekly) with streaks; quick add from one sentence
- Reminders that fire exactly once, with snooze; a friendly line written by Saathi at fire time (plain text if the AI is down, never late)
- Study plans: "25 ko DBMS exam hai, plan bana do" spreads the topics over the days with a reminder for each session; changing the plan replaces it instead of adding a second one
- Plan my day: Saathi arranges today's tasks into time slots around your classes, shown as a timeline on the Today panel
- Today panel, a 14-day progress chart, an activity timeline with Undo, notes with search and pins
- Live updates in every open tab (Server-Sent Events)

**⏱️ Focus timer: a cosmic clock**
- Any length on any task or activity (1 minute to 12 hours: hours and minutes plus quick picks), or from chat: "ye kaam 2 ghante 30 minute mein khatam karna hai" and Saathi starts it
- Small and sticky on every screen (a tiny orbit with its moving planet); the big view is a cosmic clock: the golden orbit empties with the time, hour numbers and stars around it, a small planet with a comet trail marks the time left, and Saathi's face is the sun in the middle, its mood following the clock (happy at the start, a little tense near the end). Big numbers and "Khatam hoga 4:45 PM par"
- Pause, Resume, +5 min, Khatam (also completes the task), Cancel; the end time is kept on the server, so it survives a refresh or a closed tab
- When the time is up: a soft chime, a notification on every device asking "Ho gaya? ✅ / 10 min aur? ⏳"; when the work is done: a short golden star-burst celebration with Saathi's line and the time taken (no motion with reduced motion)
- Focus minutes on the Today panel, the progress chart and the activity timeline

</details>

<details>
<summary><b>🔔 Notifications everywhere, in Saathi's voice</b></summary>

- Push notifications on phones and computers (Chrome, Edge, Android, iPhone after "Add to Home Screen"), even with the app closed: Web Push with a service worker and VAPID keys; every device of a user is registered and expired ones are removed automatically
- Always on, no setting: the browser asks on your first tap after login. If you say no (or on an iPhone not added to the Home Screen), notifications still reach you in the app, and the important ones (reminders, tasks due, the morning plan) by email
- For everything that matters: reminders, a task due in an hour and due now, overdue nudges, the morning "Aaj ka din", the evening recap, exam countdowns (3 days, 1 day, today), study sessions, the focus timer, streak and weekly milestones, and what Saathi did from the chat if you closed the app
- Every message written fresh by the AI in your language (a plain line if the AI is down, never late), with its own emoji, Saathi's icon, a space photo on Android/Chrome, and buttons: "Ho gaya ✅", "10 min baad 😴", "Kholo" (opens the right screen)
- In the app: big glass cards with Saathi's face, the kind's colour and photo, big buttons; they stack, Esc closes the newest, reminders stay until you act, the others shrink after a few seconds
- No spam: quiet hours 11 PM to 7 AM (only reminders and timers ring), several tasks at once become one notification, at most 2 nudges a day, emails only for the important kinds and at most 10 a day
- Logging out removes the device, so a shared computer stops getting your reminders
- Installable app (PWA) with its own icon

</details>

<details>
<summary><b>🎨 Design</b></summary>

- **Saathi's face:** a glowing golden 3D orb (React Three Fiber, custom shader) that breathes, blinks, follows your cursor and changes expression with each reply; a 2D SVG version is used without WebGL or with reduced motion
- **Saathi Orbit landing page:** Saathi's features orbit its glowing core as dotted planets (Three.js), followed by a scroll story with a 3D folding feature panel and smooth scrolling
- **Real space backgrounds:** every screen sits on a photo from ESA/Hubble, NASA, Chandra or Pexels (Reminders on NASA's black hole visualization), with a dark veil and glass panels so text stays readable
- Loading skeletons, empty states with a next step, and error states with a retry on every screen; works on phones with a bottom tab bar
- Sign in with email and password or "Continue with Google"; the browser can fill in your saved login

</details>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="try-it-in-60-seconds"></a>
## <img src="docs/readme/icons/try.svg" width="34" height="34" align="top" alt=""> Try it in 60 seconds

1. Open **[saathi-ksk8.onrender.com](https://saathi-ksk8.onrender.com)** (give it up to a minute if the free server is asleep).
2. Click **Account banao** and sign up with any name, email and password.
3. Tap anywhere once and allow notifications when the browser asks.
4. In the chat, type or say (mic button): *"2 minute baad paani peene ka reminder lagao"*. Saathi creates it and shows a receipt with Undo.
5. Wait two minutes: the reminder arrives with Saathi's own line, as a card in the app and as a notification on your device, with "Ho gaya ✅" and "10 min baad 😴".

Then try *"25 ko DBMS exam hai, plan bana do"* or the **Timer** button at the top.

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="screenshots"></a>
## <img src="docs/readme/icons/screens.svg" width="34" height="34" align="top" alt=""> Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/landing.webp" alt="Landing page with the Saathi Orbit scene"><br><sub>Landing page: Saathi's features orbit its glowing core (Three.js)</sub></td>
    <td width="50%"><img src="docs/screenshots/voice-listening.webp" alt="Talking to Saathi with the mic"><br><sub>Mic in the chat box: the face turns violet and listens</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/tasks.webp" alt="Tasks grouped by when they are due"><br><sub>Tasks grouped by when they are due</sub></td>
    <td><img src="docs/screenshots/tasks-completed.webp" alt="Completed tasks with the 14-day progress chart"><br><sub>Completed tasks and the 14-day progress chart</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/reminders.webp" alt="Reminders with snooze"><br><sub>Reminders with snooze and cancel, over NASA's black hole visualization</sub></td>
    <td><img src="docs/screenshots/activity.webp" alt="Activity timeline with Undo"><br><sub>Every change, yours or Saathi's, with Undo</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/notes.webp" alt="Notes with pinned notes first"><br><sub>Notes</sub></td>
    <td><img src="docs/screenshots/settings-language.webp" alt="Settings: language picker"><br><sub>Settings: language, profile and what Saathi remembers</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/focus-start.webp" alt="Focus timer: start any length"><br><sub>Focus timer: any length, quick picks</sub></td>
    <td><img src="docs/screenshots/focus-timer.webp" alt="Focus timer running as a cosmic clock"><br><sub>The cosmic clock: the golden orbit empties with the time, a planet with a comet trail marks it, Saathi is the sun</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/focus-celebration.webp" alt="Celebration when the work is done"><br><sub>Done: golden stars, Saathi's line and the time taken</sub></td>
    <td><img src="docs/screenshots/notification-popup.webp" alt="In-app notification: a reminder card"><br><sub>In-app notification: a reminder fired, with Saathi's own line and the buttons "Ho gaya ✅", "10 min baad 😴", "Kholo"</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/login-google.webp" alt="Login with the Continue with Google button"><br><sub>Login: the dark-glass "Continue with Google" button with Google's own G, then email and password</sub></td>
    <td><img src="docs/screenshots/focus-bar.webp" alt="The small focus timer under the top bar"><br><sub>A running timer stays small and sticky on every screen: a tiny orbit with its moving planet</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="33%" align="center"><img src="docs/screenshots/phone-tasks.webp" alt="Saathi on a phone: Tasks with the bottom tab bar" width="220"><br><sub>On a phone: the same screens with a bottom tab bar</sub></td>
    <td width="33%" align="center"><img src="docs/screenshots/focus-phone.webp" alt="The focus timer on a phone" width="220"><br><sub>The cosmic clock on a phone</sub></td>
    <td width="33%" align="center"><img src="docs/screenshots/login-google-phone.webp" alt="Login on a phone with the Google button at full width" width="220"><br><sub>Login on a phone, Google button at full width</sub></td>
  </tr>
</table>

The space photos behind the screens come from ESA/Hubble, NASA, Chandra, ESA Herschel and Pexels; every photo and its credit is listed in **[CREDITS.md](CREDITS.md)** (and in the app under Settings).

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="architecture"></a>
## <img src="docs/readme/icons/arch.svg" width="34" height="34" align="top" alt=""> Architecture

```mermaid
flowchart TB
    U["Browser<br/>React app, voice, 3D face,<br/>service worker"] -- "HTTPS, same origin" --> W
    subgraph R["Saathi container on Render"]
        W["Express<br/>API + built frontend"] --> S["Services<br/>tasks, reminders, notes,<br/>focus, memory, undo log"]
        W --> A["Agent loop<br/>18 tools"]
        A --> S
        A --> G["AI gateway<br/>model chain, quotas,<br/>retries, circuit breaker"]
        J["Worker<br/>job queue"] --> S
        J --> G
        J --> D["Delivery<br/>push, email, quiet hours"]
    end
    S <--> M[("MongoDB Atlas<br/>data, jobs, counters")]
    J <--> M
    G --> AI["Gemini API<br/>or Claude API"]
    D --> P["Web Push services<br/>browsers and phones"]
    D --> E["Email<br/>(Resend, Brevo or SMTP)"]
    P -. notification .-> U
    W -. "live updates (SSE)" .-> U
    W ~~~ J

    classDef app fill:#1B2148,stroke:#F2A541,color:#F5EFE6,stroke-width:1.5px
    classDef ext fill:#12152B,stroke:#8A86A6,color:#F5EFE6
    classDef data fill:#2A1E0B,stroke:#F2A541,color:#FFE3A8,stroke-width:1.5px
    class W,S,A,G,J,D app
    class U,AI,P,E ext
    class M data
    style R fill:transparent,stroke:#F2A541,stroke-dasharray: 5 5
```

**How one request flows:** you say "kal 9 baje lab file yaad dila dena" → the agent sends your message, your memories and today's agenda to the AI → the AI asks for `create_task` and `set_reminder` → each tool call is validated and run through the same service as the Tasks screen (so it is logged and undoable) → the results go back to the AI, which writes a short reply → the chat shows the reply and a receipt per change. At 9 AM the worker claims the reminder job (atomically, so it fires once), asks Saathi for a friendly line, and pushes it to your open tabs, your devices (Web Push) and, if no device can be reached and the app is closed, your email.

One Docker image runs as `web`, `worker` or `all` (`PROCESS_ROLE`). Everything shared between instances (sessions, jobs, rate limits) lives in MongoDB or in the signed cookie, never in one instance's memory. Details and load tests: **[docs/SCALING.md](docs/SCALING.md)**.

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="engineering-highlights"></a>
## <img src="docs/readme/icons/engineering.svg" width="34" height="34" align="top" alt=""> Engineering highlights

<p align="center">
  <img src="docs/readme/stats.svg" alt="5,135 requests per second for health checks while logins run (was 21); 156 automated tests; 18 agent tools; 6 languages" width="720">
</p>

**Measured, then fixed.** Load-tested with `autocannon` on a 2-core machine (the load generator shared the same cores, so absolute numbers are pessimistic; the before/after comparison is what matters). From [docs/SCALING.md](docs/SCALING.md):

| Scenario | Before | After |
|---|---|---|
| Health check, no load | 5,155 req/s, p99 33 ms | 7,078 req/s, p99 23 ms |
| `GET /api/auth/me` (auth + user lookup) | 737 req/s, p99 139 ms | 1,628 req/s, p99 67 ms |
| **Health check while logins run** | **21 req/s, p99 3.35 s** | **5,135 req/s, p99 9 ms** |

The big fix: password hashing moved from pure-JavaScript bcrypt (which froze the event loop) to Node's built-in `scrypt` on the thread pool, plus a 30-second user cache and a right-sized connection pool.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/shield.svg" width="32" height="32" alt=""> <b>Security</b>
      <ul>
        <li>Secure accounts: scrypt password hashing, JWT in an httpOnly cookie, brute-force limits per IP and per account, a single-use emailed reset link that logs out every session, and "Continue with Google" (Google's signed ID token is checked on the server; an existing account with the same verified email is joined, not duplicated)</li>
        <li>Every query is scoped to the logged-in user; other users' data is never visible (404, not 403)</li>
        <li>No secrets in Git: everything comes from environment variables, validated at startup</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/icons/jobs.svg" width="32" height="32" alt=""> <b>Reliability</b>
      <ul>
        <li>Background work in a MongoDB job queue: atomic claim, lock heartbeat, retries with backoff, dead-lettering, dedupe keys, so a reminder fires exactly once even with several instances</li>
        <li>AI gateway: a chain of models with per-model limits, per-user quotas, timeouts, retries honouring <code>Retry-After</code>, and a circuit breaker; when the AI is down, tasks, notes and reminders keep working</li>
        <li>Error handling everywhere: invalid input gets field-level messages, failed AI calls fall back to the next model or a friendly message, duplicates are caught (<code>Idempotency-Key</code>, similar-task check)</li>
        <li>Separate databases: the live app uses <code>saathi</code>, the tests use <code>saathi_test</code> only (the tests wipe it), so a test run can never touch real data</li>
        <li>Email never breaks a request: a refusal from the mail service is logged with its reason and the user still gets the same answer</li>
        <li>Ready to scale: stateless instances, a MongoDB job queue, shared quotas, health checks and graceful shutdown (<a href="docs/SCALING.md">docs/SCALING.md</a>)</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/readme/icons/check.svg" width="32" height="32" alt=""> <b>Quality</b>
      <ul>
        <li>156 automated tests (unit and integration) with <code>node:test</code> and supertest, against a real MongoDB; the AI is replaced by a fake provider, so tests are free and repeatable</li>
        <li>A written bug hunt before submission, with what was fixed and what was not: <a href="docs/BUG-REPORT.md">docs/BUG-REPORT.md</a></li>
      </ul>
    </td>
  </tr>
</table>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="tech-stack"></a>
## <img src="docs/readme/icons/stack.svg" width="34" height="34" align="top" alt=""> Tech stack

| Layer | Choice | Why |
|---|---|---|
| <img src="https://cdn.simpleicons.org/react" width="16" height="16" alt=""> Frontend | React 19, <img src="https://cdn.simpleicons.org/vite" width="14" height="14" alt=""> Vite, <img src="https://cdn.simpleicons.org/tailwindcss" width="14" height="14" alt=""> Tailwind CSS, Motion, <img src="https://cdn.simpleicons.org/threedotjs/8A86A6" width="14" height="14" alt=""> React Three Fiber | Fast builds; one design system; motion only where something changes; one 3D element (Saathi's face) with a 2D fallback |
| <img src="https://cdn.simpleicons.org/nodedotjs" width="16" height="16" alt=""> Backend | Node.js, <img src="https://cdn.simpleicons.org/express/8A86A6" width="14" height="14" alt=""> Express 5 | Async errors are handled natively; small and well understood |
| <img src="https://cdn.simpleicons.org/mongodb" width="16" height="16" alt=""> Database | MongoDB Atlas with <img src="https://cdn.simpleicons.org/mongoose" width="14" height="14" alt=""> Mongoose | Tasks, notes and conversations are document-shaped; free hosted tier |
| <img src="https://cdn.simpleicons.org/jsonwebtokens/8A86A6" width="16" height="16" alt=""> Auth | scrypt (Node built-in) + JWT in an httpOnly cookie, Google Identity Services | Passwords are never stored in plain text; hashing runs off the event loop; tokens are unreadable from page JavaScript |
| <img src="https://cdn.simpleicons.org/googlegemini" width="16" height="16" alt=""> AI | Google Gemini (function calling) by default, <img src="https://cdn.simpleicons.org/anthropic/8A86A6" width="14" height="14" alt=""> Claude (tool use) as an option | Gemini's free tier suits a student project. One provider interface (`server/src/ai/provider.js`): `AI_PROVIDER` switches without touching the agent code |
| <img src="docs/readme/icons/voice.svg" width="16" height="16" alt=""> Voice | Web Speech API (SpeechRecognition, speechSynthesis) | Built into Edge and Chrome, free, supports Indian languages. The browser turns speech into text (Edge and Chrome use their own speech service for this); Saathi's server only receives the text |
| <img src="docs/readme/icons/notifications.svg" width="16" height="16" alt=""> Notifications | Web Push (service worker, VAPID, `web-push`), Resend or Brevo email API, or nodemailer (SMTP) | Works on desktop and phones with the app closed, no paid service; email as the fallback |
| <img src="docs/readme/icons/jobs.svg" width="16" height="16" alt=""> Background jobs | Job queue in MongoDB | Reminders run exactly once, even with many instances; no extra service to pay for |
| <img src="https://cdn.simpleicons.org/zod" width="16" height="16" alt=""> Validation | zod | One schema validates input and produces field-level error messages |
| <img src="docs/readme/icons/logs.svg" width="16" height="16" alt=""> Logging | pino (JSON) | Structured logs with request ids |
| <img src="https://cdn.simpleicons.org/docker" width="16" height="16" alt=""> Deployment | Docker on <img src="https://cdn.simpleicons.org/render/8A86A6" width="14" height="14" alt=""> Render | One image serves the API and the built frontend; runs on any container platform |

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="getting-started"></a>
## <img src="docs/readme/icons/setup.svg" width="34" height="34" align="top" alt=""> Getting started

Requirements: Node.js 20.19 or newer, a free MongoDB Atlas cluster, a free Gemini API key (aistudio.google.com).

```bash
# 1. Backend
cd server
npm install
copy .env.example .env      # on macOS/Linux: cp .env.example .env
# open server/.env and fill in MONGODB_URI, JWT_SECRET and GEMINI_API_KEY
npm run dev                 # http://localhost:4000

# 2. Frontend (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173 (calls to /api go to port 4000)
```

Check the backend: http://localhost:4000/api/health/ready should show `{"status":"ok","database":"up"}`. For voice, use Microsoft Edge (best Indian voices) or Chrome.

**Production build locally:** `cd client && npm run build`, then in `server` run `$env:NODE_ENV='production'; node src/index.js` (PowerShell) or `NODE_ENV=production node src/index.js` (macOS/Linux): the server also serves the built app at http://localhost:4000.

<details>
<summary><b>With Docker (optional)</b></summary>

```bash
docker build -t saathi .
docker run -p 4000:4000 --env-file server/.env saathi
```

</details>

### Tests

The tests need a separate database because they wipe it. Add `MONGODB_URI_TEST` to `server/.env` (same as `MONGODB_URI` but ending in `/saathi_test`), then `cd server && npm test`. The tests never call a real AI (a fake provider stands in). Never point a running server at the test database.

To try Saathi with the real AI from the terminal (server running): `npm run live:chat -- "kal subah 9 baje lab file submit karni hai, yaad dila dena"`. It uses a throwaway account and deletes it afterwards; `npm run live:cleanup` removes leftovers.

<a name="environment-variables"></a>
### <img src="docs/readme/icons/env.svg" width="28" height="28" align="top" alt=""> Environment variables

Set in `server/.env` locally, or in the Render dashboard. **Required:** `MONGODB_URI`, `JWT_SECRET`, and `GEMINI_API_KEY` for chat. Everything else has a sensible default or is optional.

<details>
<summary><b>All environment variables</b> (click to open)</summary>

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB Atlas connection string |
| `JWT_SECRET` | yes | Random string of at least 32 characters used to sign login tokens |
| `GEMINI_API_KEY` | for chat | Gemini API key from aistudio.google.com (free tier) |
| `AI_PROVIDER` | no | `gemini` (default) or `anthropic` |
| `GEMINI_MODELS` | no | Model chain, tried in order (default `gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash`). When one reaches its limit, the next one answers |
| `AI_MODEL_LIMITS` | no | Requests per model for the whole app, `model=perMinute/perDay`, just below the free-tier limits. When every model is full, Saathi says so kindly and everything except chat keeps working |
| `NODE_ENV` | no | `production` on the server (secure cookies, serves the built frontend) |
| `PROCESS_ROLE` | no | `all` (default: API + worker in one process), `web` or `worker` |
| `CLIENT_ORIGIN` | no | The app's address, e.g. `https://saathi.onrender.com` (default `http://localhost:5173`) |
| `APP_URL` | no | Address used in email links (default `CLIENT_ORIGIN`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | Web Push key pair (`npx web-push generate-vapid-keys`) and a contact (`mailto:...` or your https address). Without them notifications still arrive in the app and by email |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for email | SMTP for password reset links and the email copy of important notifications (a Gmail App Password works). Without `SMTP_HOST` the email is written to the server log |
| `RESEND_API_KEY` | for email on Render's free plan | Sends email through Resend's HTTPS API (used first when set), because Render's free plan blocks the SMTP ports. Sender `onboarding@resend.dev` until you verify your own domain in Resend (then set `MAIL_FROM` to an address on it); until then mail reaches only the Resend account owner |
| `BREVO_API_KEY` | for email on Render's free plan | Sends the same emails through Brevo's HTTPS API (free, 300 a day) instead of SMTP, because Render's free plan blocks the SMTP ports. `MAIL_FROM` must be a sender verified in Brevo |
| `GOOGLE_CLIENT_ID` | optional | OAuth Web Client ID for "Continue with Google" (public, not a secret). In Google Cloud add your address as an Authorized JavaScript origin and, with a trailing slash, as an Authorized redirect URI. Without it the Google button is hidden |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_FALLBACK_MODEL` | for Claude | Only with `AI_PROVIDER=anthropic` |
| `JWT_EXPIRES_IN`, `PORT`, `MONGO_MAX_POOL`, `LOG_LEVEL` | no | Login lifetime (7d), port (4000), DB connections per instance (10), log level (info) |
| `AI_REQUEST_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`, `AI_USER_PER_MINUTE`, `AI_USER_PER_DAY`, `AI_MAX_CONCURRENCY`, `AI_MAX_QUEUE` | no | AI timeouts (20 s / 28 s), per-user limits (20 per minute, 300 per day) and per-instance limits |
| `MONGODB_URI_TEST` | for tests | Separate database for the test suite |

</details>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="api"></a>
## <img src="docs/readme/icons/api.svg" width="34" height="34" align="top" alt=""> API

**In short:** auth (`/api/auth`), tasks (`/api/tasks`), notes (`/api/notes`), reminders (`/api/reminders`), my day, progress, notifications and activity (`/api/me`), push devices and notification buttons (`/api/push`), the focus timer (`/api/focus`), and Saathi itself (`/api/agent`). All JSON; chat and live updates stream as Server-Sent Events.

<details>
<summary><b>Full endpoint list</b> (click to open)</summary>

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health/live` | no | Process is alive (used to restart hung containers) |
| GET | `/api/health/ready` | no | Ready for traffic: database reachable and not shutting down |
| POST | `/api/auth/signup` | no | Create an account `{ name, email, password, timezone? }` |
| POST | `/api/auth/login` | no | Log in `{ email, password }` |
| GET | `/api/auth/config` | no | `{ googleClientId }` for the login page (null hides the Google button) |
| POST | `/api/auth/google` | no | `{ credential }`: Google ID token. Logs in, joins an account with the same verified email, or creates one (201) |
| POST | `/api/auth/logout` | no | Clear the session cookie |
| POST | `/api/auth/forgot-password` | no | `{ email }`: emails a reset link (30 minutes, single use, only a hash stored). Always the same answer, so it never reveals which emails have accounts |
| POST | `/api/auth/reset-password/check` | no | `{ token }`: is this link still usable? |
| POST | `/api/auth/reset-password` | no | `{ token, password }`: sets the new password and logs out every session |
| GET | `/api/auth/me` | yes | Current user |
| PATCH | `/api/auth/me` | yes | Update `{ name?, timezone?, language? }` |
| GET | `/api/tasks` | yes | List: `status` (open/done/all), `due` (today/overdue/upcoming/none), `kind`, `q`, `tag`, `sort` (due/created/priority/completed), `page`, `limit` |
| POST | `/api/tasks` | yes | Create `{ title, notes?, kind?, priority?, dueAt?, tags?, repeat? }`. `repeat: { every: 'day' }` or `{ every: 'week', days: ['mon','thu'] }` makes it a habit |
| POST | `/api/tasks/quick-parse` | yes | Quick add: `{ text }` becomes a task draft to preview; nothing is saved. Without the AI the sentence becomes the title |
| GET | `/api/tasks/habits` | yes | The current occurrence of each habit, with its streak |
| GET / PATCH / DELETE | `/api/tasks/:id` | yes | Read, edit, delete (undoable) |
| POST | `/api/tasks/:id/complete`, `/reopen` | yes | Mark done / open again. Completing a habit creates its next occurrence |
| GET / POST | `/api/notes` | yes | List (`q`, `tag`, `pinned`) / create `{ body, title?, tags?, pinned? }` |
| GET / PATCH / DELETE | `/api/notes/:id` | yes | Read, edit, delete |
| GET / POST | `/api/reminders` | yes | List (`status`) / create `{ text, remindAt, taskId? }` |
| PATCH / DELETE | `/api/reminders/:id` | yes | Change text or time / cancel |
| POST | `/api/reminders/:id/snooze` | yes | `{ minutes }` or `{ until }` |
| GET | `/api/me/events` | yes | Live updates (Server-Sent Events): `ready`, `notification`, `changed` |
| GET | `/api/me/today` | yes | Today panel data |
| POST | `/api/me/leftovers/move-to-tomorrow` | yes | The recap's button: today's unfinished tasks move to tomorrow (each move undoable) |
| GET | `/api/me/progress` | yes | Completions per day (14 days), this week vs last, streak |
| GET | `/api/me/hints?q=` | yes | Open tasks related to what the user is typing |
| GET | `/api/me/notifications` | yes | Notifications (`unread=true`), with unread count |
| GET | `/api/push/key` | yes | The public VAPID key for subscribing this device |
| POST | `/api/push/subscribe`, `/unsubscribe` | yes | Register this device for push `{ endpoint, keys: { p256dh, auth }, device? }` / forget it `{ endpoint }` |
| POST | `/api/push/action` | yes | A notification button `{ notificationId, action: done / snooze / more / open }` |
| GET | `/api/focus/current` | yes | The running focus timer (or null) |
| POST | `/api/focus` | yes | Start a timer `{ minutes (1 to 720), taskId?, label? }`; one at a time (409 otherwise) |
| POST | `/api/focus/:id/pause`, `/resume`, `/extend`, `/finish`, `/cancel` | yes | Control the timer; `extend { minutes }` (12 hours in total at most), `finish { done }` also completes its task and returns Saathi's line |
| POST | `/api/me/notifications/:id/read`, `/read-all` | yes | Mark read |
| GET | `/api/me/activity` | yes | Timeline of changes, each with `canUndo` |
| POST | `/api/me/activity/:id/undo` | yes | Undo one change |
| POST | `/api/agent/chat` | yes | Talk to Saathi `{ message, conversationId?, voice? }` (`voice: true` asks for a short reply to read aloud). Streams Server-Sent Events: `start`, `expression`, `text`, `reset`, `tool`, `receipt`, `confirm`, `error`, `done` |
| GET | `/api/agent/greeting` | yes | A freshly generated greeting (cached for 5 minutes) |
| GET | `/api/agent/conversations` | yes | The user's conversations |
| GET | `/api/agent/conversations/:id/messages` | yes | Messages, newest page (`before`, `limit`) |
| POST | `/api/agent/actions/:id/confirm`, `/cancel` | yes | Confirm or cancel an action Saathi proposed (deleting a task) |
| GET / POST | `/api/agent/memories` | yes | What Saathi remembers / add a memory `{ text, kind? }` |
| DELETE | `/api/agent/memories/:id` | yes | Forget a memory |

</details>

Dates are ISO 8601 with a timezone (`2026-10-18T09:00:00+05:30`); dates without one are rejected because "9 AM" is ambiguous. Create endpoints accept an optional `Idempotency-Key` header: the same key twice returns the first response instead of creating a duplicate. Every error has the same shape: `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Every response has an `X-Request-Id` header that matches the server log line; 429 and 503 responses include `Retry-After`.

<a name="project-structure"></a>
### <img src="docs/readme/icons/structure.svg" width="28" height="28" align="top" alt=""> Project structure

<details>
<summary><b>Folders and what lives where</b> (click to open)</summary>

```
client/                React app (Vite)
  public/              service worker (sw.js), PWA manifest and icons, space photos (bg/)
  src/app/             app shell: navigation, live updates, Undo bar, focus timer state
  src/screens/         Home (chat + Today), Tasks, Reminders, Notes, Activity, Settings, auth
  src/components/      chat parts, faces (2D and 3D), progress chart, backgrounds, focus timer, notification cards
  src/landing/         landing page and the Saathi Orbit scene
  src/lib/             API client, speech (voice), push, languages, photos
server/
  src/config/          environment validation (refuses to start with bad config)
  src/models/          Mongoose schemas
  src/routes/          HTTP endpoints (thin)
  src/services/        business logic, kept separate from HTTP
  src/ai/              agent tools, prompt, Gemini/Claude providers, gateway
  src/jobs/            MongoDB job queue, worker, reminder and proactive jobs
  src/middleware/      auth, validation, errors, idempotency, overload protection
  tests/               unit and integration tests (node:test + supertest)
docs/                  scaling notes, bug report, screenshots, banner, README assets (readme/)
Dockerfile, render.yaml
```

</details>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="deployment"></a>
## <img src="docs/readme/icons/deploy.svg" width="34" height="34" align="top" alt=""> Deployment

Render, one web service from `render.yaml` (New → Blueprint). The Docker image builds the React app and the server; Express serves both from the same address, so the login cookie needs no CORS. Free plan: `PROCESS_ROLE=all` (API and reminder worker in one process), health check `/api/health/ready`. Secrets (`MONGODB_URI`, `GEMINI_API_KEY`, VAPID keys, `RESEND_API_KEY`, Brevo or SMTP) are entered in the Render dashboard, never committed. MongoDB Atlas must allow Render's addresses (Network Access `0.0.0.0/0`; the database user's password protects it).

The free plan sleeps after 15 minutes without visits; reminders that fall due while it sleeps fire as soon as it wakes. An UptimeRobot monitor calls `/api/health/live` every 5 minutes, which keeps the free server awake. Scaling beyond one instance: [docs/SCALING.md](docs/SCALING.md).

**Live link:** https://saathi-ksk8.onrender.com

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="known-limitations"></a>
## <img src="docs/readme/icons/faq.svg" width="34" height="34" align="top" alt=""> Known limitations

- **Email reaches only the owner's inbox for now.** On Render's free plan the SMTP ports are blocked, so email goes through Resend's HTTPS API. Without a domain verified in Resend, the sender is `onboarding@resend.dev`, and Resend delivers only to the email address of the Resend account's owner. Password reset links and email copies of notifications to other users are refused by Resend; the app logs the reason and carries on (the user sees the same friendly message, and notifications still arrive in the app and as push). Fix: verify a domain in Resend and set `MAIL_FROM` to an address on it.
- **How we got here:** Gmail SMTP was the first plan, but Render's free plan blocks SMTP ports; Brevo's HTTPS API worked until Brevo closed the account for sending; Resend is now first in line. All three stay in the code (Resend → Brevo → SMTP → log only).
- **Google sign-in and the consent screen:** while the Google Cloud consent screen is in "Testing", only the test users listed there can sign in with Google. Publishing it ("In production") opens it to everyone; for the basic `openid email profile` scopes no Google review is needed.
- **Free server sleeps** after 15 minutes without visitors; the first visit can take up to a minute (see [FAQ](#faq)). An UptimeRobot monitor keeps it awake.
- **iPhone push** needs iOS 16.4+ and "Add to Home Screen".
- **Voice** depends on the browser's speech service (best in Edge and Chrome; hidden in Firefox).

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="roadmap"></a>
## <img src="docs/readme/icons/roadmap.svg" width="34" height="34" align="top" alt=""> Roadmap

**Done**
- [x] AI agent with 18 tools, receipts and Undo
- [x] Reminders, habits, study plans, plan my day, focus timer
- [x] Push notifications on every device, with email as a fallback
- [x] Voice and six languages
- [x] "Continue with Google" sign-in with a premium button
- [x] Password reset email through Resend's HTTPS API (Render blocks SMTP)
- [x] Focus timer as a cosmic clock
- [x] NASA black hole behind Reminders; landing and phone polish

**Next**
- [ ] ✉️ Verify our own domain in Resend, so password reset links and notification emails reach every user, not only the owner
- [ ] 🌐 More languages for the app and voice: Marathi, Gujarati, Punjabi, Telugu, Kannada, Malayalam, Odia, Urdu, Bhojpuri and more, and every screen fully translated (today the navigation, titles, chat and settings are translated; the rest is in Hinglish)
- [ ] 🙋 "Apni bhasha maango": a button in Settings to ask for a missing language, so the most requested ones come first
- [ ] ✅ Marwari out of beta, checked with native speakers
- [ ] 🔑 Facebook and Instagram sign-in, next to email, password and Google
- [ ] 📅 Google Calendar sync (classes and exams in, Saathi's reminders out)
- [ ] 💬 Saathi on WhatsApp and Telegram
- [ ] 📄 Upload a syllabus or PDF and turn it into a study plan
- [ ] 🔎 Web search for explanations and quick facts
- [ ] 👥 Shared tasks and study groups with friends

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="faq"></a>
## <img src="docs/readme/icons/faq.svg" width="34" height="34" align="top" alt=""> FAQ

<details>
<summary><b>Why does the first visit take so long?</b></summary>

The app runs on Render's free plan, which sleeps after 15 minutes without visitors. The first request wakes it, which can take up to a minute. Reminders that fell due while it slept fire as soon as it wakes. An uptime monitor that calls `/api/health/live` every few minutes keeps it awake.

</details>

<details>
<summary><b>Do notifications work on an iPhone?</b></summary>

Yes, on iOS 16.4 or newer, after you add Saathi to the Home Screen (Safari → Share → Add to Home Screen) and open it from there; Saathi shows these steps once. Without that, reminders still appear inside the app, and the important ones also come by email.

</details>

<details>
<summary><b>Which browser is best for voice?</b></summary>

Microsoft Edge, which has the best Indian voices, then Chrome. In browsers without speech recognition (such as Firefox) the mic button is hidden and everything else works.

</details>

<details>
<summary><b>What happens when the AI is down or its free limit is used up?</b></summary>

Tasks, notes, reminders and the focus timer keep working without the AI. Saathi first moves to the next model in its chain; when every model is full, the chat says so kindly, and reminders go out with their plain text, never late.

</details>

<details>
<summary><b>Is my data private?</b></summary>

Every query is scoped to your account, passwords are stored only as scrypt hashes, and the login lives in an httpOnly cookie that page scripts cannot read. Logging out also removes the device from push, so a shared computer stops getting your reminders.

</details>

<details>
<summary><b>Which languages does Saathi speak?</b></summary>

Saathi replies in the language you write or speak. Settings offers Hinglish, English, Hindi, Marwari (beta), Tamil and Bengali for the messages Saathi starts itself and for the main screens.

</details>

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<a name="ai-usage"></a>
## <img src="docs/readme/icons/ai.svg" width="34" height="34" align="top" alt=""> AI usage

This project was built with help from Claude (Anthropic) for code generation, debugging and documentation, as allowed by the project guidelines. Every workflow is tested (156 automated tests plus live checks with the real AI), and the code is understood and maintained by the author. Inside the app, the AI (Gemini) only proposes actions; the server validates and executes them, and every change can be undone.

<a name="credits-and-author"></a>
## <img src="docs/readme/icons/credits.svg" width="34" height="34" align="top" alt=""> Credits and author

Background photos: ESA/Hubble, NASA, Chandra X-ray Observatory, ESA Herschel and photographers on Pexels; full list with sources and licences in [CREDITS.md](CREDITS.md). Fonts: Baloo 2 and Mukta (Google Fonts). Icons: Lucide (in the app and in this README); technology logos from Simple Icons.

Using NASA and ESA images does not mean they endorse this project.

**Author:** Himanshu ([@harisharma81182-hash](https://github.com/harisharma81182-hash)), End-Term Software Project, 2026.

<p align="center"><img src="docs/readme/divider.svg" alt="" width="100%"></p>

<div align="center">

<img src="docs/readme/icons/credits.svg" width="28" height="28" alt="">

**Made with ❤️ in India**

<sub>Saathi · your AI friend who gets things done · <a href="https://saathi-ksk8.onrender.com">saathi-ksk8.onrender.com</a></sub>

</div>
