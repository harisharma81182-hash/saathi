import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { aiConfigured, getProvider, getGateway } from '../ai/provider.js';
import { AppError } from '../utils/AppError.js';
import { toLocalIso, describeLocalNow } from '../utils/time.js';
import { createTaskSchema } from './task.service.js';

// Quick add: one sentence ("kal 5 baje DBMS assignment, important") becomes a task draft with a
// title, due time, priority and so on. One small AI call returns JSON, which is checked with the
// same zod schema as the normal "create task" API. Nothing is saved here: the page shows the draft
// as a preview, and saving uses POST /api/tasks. Without the AI, the sentence itself is the title.

const log = logger.child({ component: 'quick-add' });

export const quickAddSchema = z.object({
  text: z.string().trim().min(1, 'Type what you need to do.').max(300, 'Keep it under 300 characters.'),
});

const INSTRUCTIONS = `You turn one sentence (English, Hindi or Hinglish) into a task for a to-do app.
Reply with only a JSON object, no other text:
{"title": string, "dueAt": string or null, "priority": "low" | "normal" | "high", "kind": "task" | "deadline", "tags": string[], "repeat": null or {"every": "day"} or {"every": "week", "days": ["mon", ...]}}
- title: short, in the user's words and language, without the date or time words ("DBMS assignment").
- dueAt: ISO 8601 with the user's UTC offset, e.g. 2026-10-19T17:00:00+05:30; null if no time is given. "kal" = tomorrow, "parso" = the day after. A date without a time: use 09:00 for tasks, 10:00 for exams.
- priority: high for "important", "urgent", "zaroori", exams; low for "kabhi bhi", "if time"; otherwise normal.
- kind: "deadline" for exams, submissions and anything with a hard date; otherwise "task".
- tags: zero to three lowercase subject words, e.g. ["dbms"].
- repeat: only for "roz", "daily", "har Monday" and the like. Then dueAt is the next time it happens: today if that time is still ahead, otherwise the next day it repeats ("roz subah 7 baje gym" at 8 PM -> tomorrow 07:00).`;

const draftSchema = createTaskSchema.pick({ title: true, dueAt: true, priority: true, kind: true, tags: true, repeat: true });

/** The first {...} block in the reply (models sometimes wrap JSON in ``` fences). */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Returns { draft, source: 'ai' | 'plain', warnings }. Never fails because of the AI: a problem
 * there gives a plain draft (the sentence as the title) and a note saying so.
 */
export async function parse(user, { text }, { now = new Date(), signal } = {}) {
  const plain = (note) => ({ draft: { title: text.slice(0, 200), dueAt: null, priority: 'normal', kind: 'task', tags: [], repeat: null }, source: 'plain', warnings: [note] });
  if (!aiConfigured()) return plain('Saathi could not read the date and priority (AI not connected), so check them before saving.');

  let parsed;
  try {
    const provider = getProvider();
    const system = `${INSTRUCTIONS}\n\nNow for the user: ${describeLocalNow(user.timezone, now)} (${toLocalIso(now, user.timezone)}), timezone ${user.timezone}.`;
    const response = await getGateway().run({
      userId: String(user._id), // a quick add counts like a chat message for the user's quota
      signal,
      call: ({ model, signal: callSignal }) =>
        provider.send(
          { model, max_tokens: 1024, system, messages: [{ role: 'user', content: text }], output_config: { effort: 'low' } },
          { signal: callSignal },
        ),
    });
    const reply = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const result = draftSchema.safeParse(extractJson(reply));
    if (!result.success) throw new Error(`invalid draft: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    parsed = result.data;
  } catch (err) {
    // The user's own limits (spam) are worth telling them about; anything else falls back quietly.
    if (err instanceof AppError && err.code === 'RATE_LIMITED') throw err;
    log.warn({ err: err.message }, 'quick add fell back to plain text');
    return plain('Saathi could not read this one, so the whole sentence is the title. Add the date and priority before saving.');
  }

  const draft = { title: parsed.title, dueAt: parsed.dueAt ?? null, priority: parsed.priority ?? 'normal', kind: parsed.kind ?? 'task', tags: parsed.tags ?? [], repeat: parsed.repeat ?? null };
  const warnings = [];
  if (draft.repeat && !draft.dueAt) {
    draft.repeat = null;
    warnings.push('A repeating task needs a time; add one to make it repeat.');
  }
  if (draft.dueAt && draft.dueAt.getTime() < now.getTime()) warnings.push('That time has already passed. Check the date.');
  return { draft: { ...draft, dueAt: draft.dueAt ? toLocalIso(draft.dueAt, user.timezone) : null }, source: 'ai', warnings };
}
