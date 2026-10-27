# Bug hunt before submission (27 Oct 2026)

A strict review of the server and the client, plus every screen in a production build at
1366 x 768 and 390 x 844 (headless Edge). No new features: only fixes, each small and tested.

## What was found and fixed

| # | Bug | Severity | Fix |
|---|---|---|---|
| 1 | The live app on Render used the **test database** (`saathi_test`). Every test run deleted all live data, and the live worker put jobs into the test database, so `scaling.test.js` failed at random | High (data loss) | Himanshu pointed Render's `MONGODB_URI` at `saathi`. After that, `scaling.test.js` passed 16/16. CLAUDE.md now warns about it |
| 2 | **Logout did not unregister the device for push.** On a shared computer (a college lab) the next person kept getting the previous user's reminders, with their text | High (privacy) | Logout first removes this browser's push subscription on the server and in the browser (`client/src/lib/push.js` `forgetThisDevice`, at most 3 s). The next login registers it again |
| 3 | Emails could never leave Render: the free plan blocks SMTP ports 25, 465 and 587, so reset links and email copies timed out | High (feature broken live) | Emails go through Brevo's HTTPS API when `BREVO_API_KEY` is set (`mail.service.js`, 3 tests). SMTP stays for laptops |
| 4 | "Ho gaya" on a notification about several tasks failed half way if one task had been deleted, and later tasks were not completed | Medium | Deleted tasks are skipped, the others are completed; if none are left, a clear 404 message (test added) |
| 5 | "+5 min" on the focus timer had no total limit: pressing it again and again went past the 12-hour limit | Low | The total is checked (400 with a message); test added |
| 6 | "+5 min" just after the end time (before the "time up" job ran) added the minutes to a time in the past, so the timer ended at once | Low | Counts from now in that case |
| 7 | On Home, the 10-second Undo bar sat on top of the chat box (on phones it covered it completely) | Medium (UI) | On Home the bar shows under the header; other screens keep it at the bottom |
| 8 | Progress card said "0 min aaj, 0m is hafte" (two styles) | Low (copy) | "0 min is hafte" |
| 9 | Login/signup autofill: missing `name` and `autocomplete="username"` on login | Low | Fixed earlier today, plus the last login email remembered on this device (never the password) |

## Checked and fine

- Every query is scoped by `userId` (tasks, notes, reminders, notifications, focus, conversations, pending Confirm actions); other users' items are 404.
- Cookies: httpOnly, `secure` in production, `sameSite=lax`; password reset logs out every session (`sessionVersion`).
- Password reset: same answer for every email, token stored only as SHA-256, 30 minutes, single use, rate limits.
- No `dangerouslySetInnerHTML`; user text in emails is HTML-escaped; no `console.log`; no secrets in logs or Git.
- Reminders: an old job after a snooze or edit is skipped (time must match); notifications are deduplicated.
- Chat: a failed or cut AI reply shows a friendly error; tasks, notes and reminders keep working without AI.
- Voice: the mic button is hidden where speech recognition is missing (Firefox), speaking returns quietly without voices.
- Screens: no horizontal scroll, no console errors or CSP errors on any screen; keyboard focus ring is visible.
  The "cut text" warnings of the checker are screen-reader-only labels (hidden on purpose).

## Not changed (and why)

- Focus timer pause/resume from two tabs at the same moment is a read-then-save; the last click wins. Rare, harmless, and a fix would touch every timer action on submission day.
- A notification that fails half way through delivery is retried by the job queue and can push twice in rare cases. Changing the delivery order is risky today.
- Task titles on phones are 24 px tall tap targets (the whole row has space around them). Left as designed.
- Google sign-in joins an existing email account. If someone had signed up earlier with another person's email, that password keeps working; email verification at signup is on the roadmap.

## Test now on the live app

1. Log in, allow notifications, log out, log in with another account on the same browser: reminders of the first account must not appear.
2. "Password bhool gaye?" after setting `BREVO_API_KEY` and a verified `MAIL_FROM`: the email arrives (check Spam and Promotions).
3. Home: complete a task in the Today panel; the Undo bar shows at the top, the chat box stays usable.
4. Focus timer: start, pause, resume, +5 min, Khatam.
5. "Continue with Google" after setting `GOOGLE_CLIENT_ID`.

Tests: 148 pass (one file at a time); client production build clean.
