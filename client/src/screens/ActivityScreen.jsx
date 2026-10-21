import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { clock } from '../lib/format.js';
import { useLiveRefresh } from '../app/live.js';
import { Face } from '../components/Face.jsx';
import { EmptyState, ErrorState, GroupTitle, ListSkeleton, ScreenFrame } from '../components/ScreenParts.jsx';

// Activity: every change to a task, note or reminder, by you or by Saathi, newest first, as a
// timeline per day. A change from the last 10 minutes can be undone right here (the server checks
// that nothing changed the item since, so an Undo never overwrites newer work).

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function ActivityScreen({ user }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api('/me/activity?limit=100')).activity);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  const groups = useMemo(() => {
    if (!items) return [];
    const today = dayStart(new Date());
    const map = new Map();
    for (const a of items) {
      const day = dayStart(new Date(a.createdAt));
      const title = day === today ? 'Aaj' : day === today - 86_400_000 ? 'Kal' : new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
      if (!map.has(title)) map.set(title, []);
      map.get(title).push(a);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <ScreenFrame title="Activity" description="Har badlaav, tumhara ya Saathi ka. Pichhle 10 minute ka koi bhi badlaav yahin se Undo ho sakta hai.">
      {error && <ErrorState error={error} onRetry={load} />}
      {!items && !error && <ListSkeleton />}
      {items?.length === 0 && <EmptyState title="Abhi tak kuch nahi badla" text="Jaise hi tum ya Saathi koi task, note ya reminder banaoge, woh yahan dikhega." />}
      {groups.map(([title, list]) => (
        <section key={title}>
          <GroupTitle>{title}</GroupTitle>
          <ol className="relative ml-3 border-l border-line">
            {list.map((a) => (
              <ActivityItem key={a.id} a={a} user={user} onChanged={load} />
            ))}
          </ol>
        </section>
      ))}
    </ScreenFrame>
  );
}

function ActivityItem({ a, user, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await api(`/me/activity/${a.id}/undo`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const bySaathi = a.actor === 'agent';
  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative py-3 pl-7">
      {/* Who did it: Saathi's small face, or your initial */}
      <span className="absolute -left-3 top-3">
        {bySaathi ? (
          <Face size={24} expression="happy" followCursor={false} label="Saathi ne kiya" />
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 font-display text-xs font-semibold ring-4 ring-ink" aria-label="Tumne kiya">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={`min-w-0 flex-1 ${a.undoneAt ? 'text-faint line-through' : ''}`}>{a.summary}</p>
        <span className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-faint tabular-nums">{clock(a.createdAt)}</span>
          {a.canUndo && (
            <button onClick={undo} disabled={busy} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-gold transition-colors hover:bg-surface hover:text-text disabled:opacity-50">
              <Undo2 size={13} /> {busy ? 'Undo ho raha hai' : 'Undo'}
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-faint">
        {bySaathi ? 'Saathi ne kiya' : 'Tumne kiya'}
        {a.undoneAt && ', baad mein Undo kiya'}
      </p>
      {error && <p className="mt-1 text-sm text-vermilion">{error}</p>}
    </motion.li>
  );
}
