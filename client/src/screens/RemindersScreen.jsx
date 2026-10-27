import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlarmClock, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.js';
import { clock, when } from '../lib/format.js';
import { useLiveRefresh } from '../app/live.js';
import { EmptyState, ErrorState, GroupTitle, ListSkeleton, ScreenFrame, Tabs } from '../components/ScreenParts.jsx';

// Reminders: what Saathi will remind you about, by day. Add one with a time, push one later
// (10 minutes, an hour, tomorrow morning) or cancel it. "Ho gaye" lists the ones that already
// rang; any of them can be brought back with a snooze.

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

function byDay(list) {
  const today = dayStart(new Date());
  const map = new Map();
  for (const r of list) {
    const day = dayStart(new Date(r.remindAt));
    const title = day === today ? 'Aaj' : day === today + DAY ? 'Kal' : day === today - DAY ? 'Kal (beeta hua)' : new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    if (!map.has(title)) map.set(title, []);
    map.get(title).push(r);
  }
  return [...map.entries()];
}

/** Tomorrow at 9:00 in the browser's time, as an ISO string (for "Kal subah"). */
function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export function RemindersScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState('scheduled');
  const [lists, setLists] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [scheduled, sent, cancelled] = await Promise.all(
        ['scheduled', 'sent', 'cancelled'].map((s) => api(`/reminders?status=${s}&limit=100`).then((r) => r.reminders)),
      );
      setLists({ scheduled, sent, cancelled });
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  const list = lists[tab];
  const groups = useMemo(() => (list ? byDay(list) : []), [list]);

  return (
    <ScreenFrame title={t('nav.reminders')} description={t('reminders.desc')}>
      <div className="mt-6">
        <NewReminder onSaved={load} />
      </div>
      <div className="mt-6">
        <Tabs
          label="Reminders"
          value={tab}
          onChange={setTab}
          options={[
            ['scheduled', 'Aane wale', lists.scheduled?.length ?? 0],
            ['sent', 'Ho gaye', 0],
            ['cancelled', 'Cancel kiye', 0],
          ]}
        />
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!list && !error && <ListSkeleton rows={4} />}
      {list?.length === 0 && (
        <EmptyState
          title={tab === 'scheduled' ? 'Koi reminder nahi laga' : tab === 'sent' ? 'Abhi tak koi reminder nahi baja' : 'Koi reminder cancel nahi hua'}
          text={tab === 'scheduled' ? 'Upar time ke saath likho, ya Saathi ko bolo: "kal 9 baje lab file yaad dila dena".' : null}
          expression={tab === 'scheduled' ? 'happy' : 'sleepy'}
        />
      )}
      {groups.map(([title, items]) => (
        <section key={title}>
          <GroupTitle>{title}</GroupTitle>
          <ul>
            <AnimatePresence initial={false}>
              {items.map((r) => (
                <ReminderItem key={r.id} reminder={r} onChanged={load} />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </ScreenFrame>
  );
}

function ReminderItem({ reminder: r, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function call(path, options) {
    setBusy(true);
    setError(null);
    try {
      await api(path, options);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const snooze = (body) => call(`/reminders/${r.id}/snooze`, { method: 'POST', body });

  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.25 }} className="border-b border-line/60 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
        <span className={`w-20 shrink-0 font-display text-lg font-semibold tabular-nums ${r.status === 'cancelled' ? 'text-faint line-through' : ''}`}>{clock(r.remindAt)}</span>
        <div className="min-w-0 flex-1 basis-40">
          <p className={r.status === 'cancelled' ? 'text-faint line-through' : ''}>{r.text}</p>
          {(r.snoozeCount > 0 || r.taskId) && (
            <p className="mt-0.5 text-xs text-faint">
              {r.taskId && 'Ek task se juda hai'}
              {r.taskId && r.snoozeCount > 0 && ', '}
              {r.snoozeCount > 0 && `${r.snoozeCount} baar aage kiya`}
            </p>
          )}
        </div>
        {r.status !== 'cancelled' && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <AlarmClock size={15} className="mr-1 text-faint" aria-hidden />
            <button disabled={busy} onClick={() => snooze({ minutes: 10 })} className="min-h-8 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2 active:scale-95 disabled:opacity-50">
              10 min
            </button>
            <button disabled={busy} onClick={() => snooze({ minutes: 60 })} className="min-h-8 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2 active:scale-95 disabled:opacity-50">
              1 ghanta
            </button>
            <button disabled={busy} onClick={() => snooze({ until: tomorrowMorning() })} className="min-h-8 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2 active:scale-95 disabled:opacity-50">
              Kal subah
            </button>
            {r.status === 'scheduled' && (
              <button
                disabled={busy}
                onClick={() => call(`/reminders/${r.id}`, { method: 'DELETE' })}
                aria-label={`"${r.text}" cancel karo`}
                title="Cancel karo"
                className="ml-1 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-vermilion/10 hover:text-vermilion"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="-mt-1 pb-3 text-sm text-vermilion">{error}</p>}
    </motion.li>
  );
}

/** One line: what, and when. Saathi can do the same from chat in plain words. */
function NewReminder({ onSaved }) {
  const [text, setText] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/reminders', { method: 'POST', body: { text: text.trim(), remindAt: new Date(at).toISOString() }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setText('');
      setAt('');
      onSaved();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3 pl-4">
      <label className="sr-only" htmlFor="reminder-text">
        Kis baat ka reminder
      </label>
      <input
        id="reminder-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Kis baat ka reminder?"
        className="min-w-0 flex-1 basis-48 bg-transparent text-text outline-none placeholder:text-faint focus-visible:outline-none"
      />
      <label className="sr-only" htmlFor="reminder-at">
        Kab
      </label>
      <input
        id="reminder-at"
        type="datetime-local"
        value={at}
        onChange={(e) => setAt(e.target.value)}
        className="rounded-lg bg-ink/50 px-2.5 py-1.5 text-sm text-text outline-none [color-scheme:dark] focus:bg-ink/80 focus-visible:outline-none"
      />
      <button type="submit" disabled={busy || !text.trim() || !at} className="btn-gold">
        {busy ? 'Lag raha hai' : 'Reminder lagao'}
      </button>
      {error && <p className="basis-full text-sm text-vermilion">{error}</p>}
      {!error && at && <p className="basis-full text-xs text-faint">{when(new Date(at).toISOString())} yaad dilaunga</p>}
    </form>
  );
}
