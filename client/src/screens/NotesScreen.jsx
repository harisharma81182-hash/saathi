import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useLiveRefresh } from '../app/live.js';
import { EmptyState, ErrorState, GroupTitle, ListSkeleton, ScreenFrame } from '../components/ScreenParts.jsx';

// Notes: quick thoughts, class notes, links. Write one at the top; pinned notes stay first; click a
// note to edit it in place. Saathi can save and search notes too ("yeh note kar lo...").

export function NotesScreen() {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api(`/notes?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
      setNotes(res.notes);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useLiveRefresh(load);

  const pinned = notes?.filter((n) => n.pinned) ?? [];
  const rest = notes?.filter((n) => !n.pinned) ?? [];

  return (
    <ScreenFrame title="Notes" description="Jo yaad rakhna hai, yahan likh do. Saathi bhi chat se notes bana aur dhoondh sakta hai.">
      <div className="mt-6">
        <Composer onSaved={load} />
      </div>
      <label className="mt-6 flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm focus-within:ring-1 focus-within:ring-gold/40 sm:max-w-72">
        <Search size={15} className="shrink-0 text-faint" aria-hidden />
        <span className="sr-only">Notes mein dhoondho</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notes mein dhoondho" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint focus-visible:outline-none" />
      </label>

      {error && <ErrorState error={error} onRetry={load} />}
      {!notes && !error && <ListSkeleton rows={4} />}
      {notes?.length === 0 && (
        <EmptyState
          title={q ? 'Aisa koi note nahi mila' : 'Abhi koi note nahi'}
          text={q ? 'Koi aur shabd try karo.' : 'Upar likho, ya chat mein bolo: "note kar lo, DBMS ka viva 28 ko hai".'}
          expression={q ? 'thinking' : 'happy'}
        />
      )}
      {pinned.length > 0 && <GroupTitle>Pinned</GroupTitle>}
      <NoteList notes={pinned} open={open} setOpen={setOpen} onChanged={load} />
      {pinned.length > 0 && rest.length > 0 && <GroupTitle>Baaki notes</GroupTitle>}
      <NoteList notes={rest} open={open} setOpen={setOpen} onChanged={load} />
    </ScreenFrame>
  );
}

function NoteList({ notes, open, setOpen, onChanged }) {
  return (
    <ul className="mt-2">
      <AnimatePresence initial={false}>
        {notes.map((n) => (
          <motion.li key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-line/60 last:border-0">
            {open === n.id ? (
              <NoteEditor note={n} onClose={() => setOpen(null)} onChanged={onChanged} />
            ) : (
              <button onClick={() => setOpen(n.id)} className="group block w-full rounded-xl px-2 py-4 text-left transition-colors hover:bg-surface sm:-mx-2 sm:w-[calc(100%+1rem)]">
                <span className="flex items-baseline justify-between gap-4">
                  <span className="truncate font-display text-lg font-semibold">{n.title || n.body.split('\n')[0].slice(0, 80)}</span>
                  <span className="shrink-0 text-xs text-faint">{when(n.updatedAt)}</span>
                </span>
                <span className="mt-1 line-clamp-2 text-muted">{n.title ? n.body : n.body.split('\n').slice(1).join(' ')}</span>
                {n.tags?.length > 0 && <span className="mt-1.5 block text-xs text-faint">{n.tags.map((t) => `#${t}`).join('  ')}</span>}
              </button>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** "Kuch likhna hai?": a quiet field that opens into a title + body when you start. */
function Composer({ onSaved }) {
  const [form, setForm] = useState({ title: '', body: '' });
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/notes', { method: 'POST', body: { body: form.body, ...(form.title.trim() && { title: form.title.trim() }) }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setForm({ title: '', body: '' });
      setActive(false);
      onSaved();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="glass rounded-2xl p-4">
      {active && (
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Title (zaroori nahi)"
          aria-label="Title"
          className="mb-2 w-full bg-transparent font-display text-lg font-semibold outline-none placeholder:text-faint focus-visible:outline-none"
        />
      )}
      <textarea
        value={form.body}
        onFocus={() => setActive(true)}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
        placeholder="Kuch likhna hai?"
        aria-label="Note"
        rows={active ? 4 : 1}
        className="w-full resize-none bg-transparent text-text outline-none placeholder:text-faint focus-visible:outline-none"
      />
      {error && <p className="mt-1 text-sm text-vermilion">{error}</p>}
      {active && (
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={busy || !form.body.trim()} className="btn-gold">
            {busy ? 'Save ho raha hai' : 'Note save karo'}
          </button>
          <button
            type="button"
            onClick={() => {
              setActive(false);
              setForm({ title: '', body: '' });
              setError(null);
            }}
            className="btn-ghost text-faint"
          >
            Rehne do
          </button>
        </div>
      )}
    </form>
  );
}

function NoteEditor({ note, onClose, onChanged }) {
  const [form, setForm] = useState({ title: note.title ?? '', body: note.body });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function call(path, options) {
    setBusy(true);
    setError(null);
    try {
      await api(path, options);
      return true;
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = async (e) => {
    e.preventDefault();
    if (await call(`/notes/${note.id}`, { method: 'PATCH', body: { title: form.title.trim(), body: form.body } })) {
      onClose();
      onChanged();
    }
  };
  const togglePin = async () => {
    if (await call(`/notes/${note.id}`, { method: 'PATCH', body: { pinned: !note.pinned } })) onChanged();
  };
  const remove = async () => {
    if (await call(`/notes/${note.id}`, { method: 'DELETE' })) onChanged();
  };

  return (
    <motion.form onSubmit={save} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="my-3 rounded-2xl bg-surface p-4">
      <input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="Title"
        aria-label="Title"
        className="w-full bg-transparent font-display text-lg font-semibold outline-none placeholder:text-faint focus-visible:outline-none"
      />
      <textarea
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
        aria-label="Note"
        rows={Math.min(14, Math.max(4, form.body.split('\n').length + 1))}
        autoFocus
        className="mt-2 w-full resize-none bg-transparent text-text outline-none focus-visible:outline-none"
      />
      {error && <p className="mt-1 text-sm text-vermilion">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !form.body.trim()} className="btn-gold">
          Save karo
        </button>
        <button type="button" onClick={onClose} className="btn-ghost text-faint">
          Band karo
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={togglePin} disabled={busy} aria-label={note.pinned ? 'Pin hatao' : 'Pin karo'} title={note.pinned ? 'Pin hatao' : 'Pin karo'} className="grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text">
            {note.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <button type="button" onClick={remove} disabled={busy} aria-label="Note delete karo" title="Delete" className="grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-vermilion/10 hover:text-vermilion">
            <Trash2 size={16} />
          </button>
        </span>
      </div>
    </motion.form>
  );
}
