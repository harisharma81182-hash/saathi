import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus } from 'lucide-react';
import { api } from '../lib/api.js';

// Quick add: type one sentence ("kal 5 baje DBMS assignment, important"), Saathi turns it into a
// task draft, you check or fix it in a small preview card, then save. Nothing is saved before that.

// "2026-10-19T17:00:00+05:30" <-> the value a <input type="datetime-local"> shows (browser's local time).
const toInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromInput = (value) => (value ? new Date(value).toISOString() : null);

const PRIORITIES = [
  ['low', 'Kabhi bhi'],
  ['normal', 'Normal'],
  ['high', 'Important'],
];
const REPEAT_LABEL = (r) => (r.every === 'day' ? 'Roz' : `Har ${r.days?.join(', ') ?? 'hafte'}`);

export function QuickAdd({ onSaved }) {
  const [text, setText] = useState('');
  const [state, setState] = useState('idle'); // idle | parsing | preview | saving | saved
  const [draft, setDraft] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);

  async function parse(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setState('parsing');
    setError(null);
    try {
      const res = await api('/tasks/quick-parse', { method: 'POST', body: { text } });
      setDraft({ ...res.draft, dueInput: toInput(res.draft.dueAt) });
      setNotes(res.warnings);
      setState('preview');
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  }

  async function save() {
    setState('saving');
    setError(null);
    const body = {
      title: draft.title.trim(),
      priority: draft.priority,
      kind: draft.kind,
      tags: draft.tags,
      dueAt: fromInput(draft.dueInput),
      ...(draft.repeat && draft.dueInput && { repeat: draft.repeat }),
    };
    try {
      // If the response is lost and the request is sent again, the key makes the server create it once.
      await api('/tasks', { method: 'POST', body, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setState('saved');
      setText('');
      onSaved?.();
      setTimeout(() => {
        setDraft(null);
        setState('idle');
      }, 1200);
    } catch (err) {
      setError(err.message);
      setState('preview');
    }
  }

  const edit = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const busy = state === 'parsing' || state === 'saving';

  return (
    <div className="mb-2">
      <form onSubmit={parse} className="flex items-center gap-2.5 rounded-xl border border-transparent bg-surface/70 px-3 py-2.5 transition-colors focus-within:border-gold/30 hover:bg-surface">
        <Plus size={16} className="shrink-0 text-faint" aria-hidden />
        <label htmlFor="quick-add" className="sr-only">
          Quick add
        </label>
        <input
          id="quick-add"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={state === 'preview' || busy}
          placeholder="Ek line mein naya task likho"
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint focus-visible:outline-none disabled:opacity-60"
        />
        {text.trim() && state === 'idle' && (
          <button type="submit" className="shrink-0 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink transition hover:brightness-110 active:scale-95">
            Banao
          </button>
        )}
        {state === 'parsing' && <span className="shrink-0 text-xs text-faint">Samajh raha hoon...</span>}
      </form>
      {error && state === 'idle' && <p className="mt-1 px-1 text-xs text-vermilion">{error}</p>}

      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-2xl bg-surface p-4">
              {state === 'saved' ? (
                <p className="inline-flex items-center gap-1.5 text-sm text-leaf">
                  <Check size={14} strokeWidth={2.6} /> Task ban gaya
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-faint">Check kar lo, phir save karo</p>
                  <label className="sr-only" htmlFor="qa-title">
                    Title
                  </label>
                  <input
                    id="qa-title"
                    value={draft.title}
                    onChange={(e) => edit({ title: e.target.value })}
                    className="w-full rounded-lg bg-ink/50 px-2.5 py-1.5 font-display text-lg font-semibold text-text outline-none focus-visible:outline-none focus:bg-ink/80"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <label className="sr-only" htmlFor="qa-due">
                      Kab
                    </label>
                    <input
                      id="qa-due"
                      type="datetime-local"
                      value={draft.dueInput}
                      onChange={(e) => edit({ dueInput: e.target.value })}
                      className="rounded-lg bg-ink/50 px-2 py-1 text-text outline-none [color-scheme:dark] focus-visible:outline-none focus:bg-ink/80"
                    />
                    {draft.kind === 'deadline' && <span className="text-gold">Deadline</span>}
                    {draft.repeat && <span className="text-leaf">{REPEAT_LABEL(draft.repeat)}</span>}
                    {draft.tags?.map((t) => (
                      <span key={t} className="text-faint">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Priority">
                    {PRIORITIES.map(([value, label]) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={draft.priority === value}
                        onClick={() => edit({ priority: value })}
                        className={`rounded-full px-2.5 py-1 text-xs transition-colors ${draft.priority === value ? 'bg-surface-2 text-text ring-1 ring-gold/50' : 'text-faint hover:text-text'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {notes.map((n) => (
                    <p key={n} className="mt-2 text-xs text-gold/90">
                      {n}
                    </p>
                  ))}
                  {error && <p className="mt-2 text-xs text-vermilion">{error}</p>}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={save}
                      disabled={busy || !draft.title.trim()}
                      className="rounded-full bg-gold px-4 py-1.5 text-xs font-semibold text-ink transition hover:brightness-110 active:scale-95 disabled:opacity-50"
                    >
                      {state === 'saving' ? 'Save ho raha hai...' : 'Save karo'}
                    </button>
                    <button
                      onClick={() => {
                        setDraft(null);
                        setState('idle');
                        setError(null);
                      }}
                      disabled={busy}
                      className="rounded-full px-3 py-1.5 text-xs text-faint transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      Rehne do
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
