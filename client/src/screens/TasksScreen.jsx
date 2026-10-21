import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Pencil, Repeat, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { clock, lateBy, when } from '../lib/format.js';
import { useLiveRefresh } from '../app/live.js';
import { QuickAdd } from '../components/QuickAdd.jsx';
import { ProgressChart } from '../components/ProgressChart.jsx';
import { EmptyState, ErrorState, GroupTitle, ListSkeleton, ScreenFrame, Tabs } from '../components/ScreenParts.jsx';

// Tasks: everything to do, in one list grouped by when it is due (Pending, Aaj, Kal, Is hafte,
// Baad mein, Bina date), with quick add on top. The Completed tab groups finished tasks by the day
// they were done and shows the 14-day progress chart. Every change goes through the normal API, so
// the Undo bar appears and every other open screen updates live.

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

function groupOpen(tasks) {
  const today = dayStart(new Date());
  const now = Date.now();
  const groups = { pending: [], today: [], tomorrow: [], week: [], later: [], none: [] };
  for (const t of tasks) {
    if (!t.dueAt) groups.none.push(t);
    else {
      const due = new Date(t.dueAt);
      const day = dayStart(due);
      if (due.getTime() < now && day < today) groups.pending.push(t);
      else if (day === today) groups.today.push(t);
      else if (day === today + DAY) groups.tomorrow.push(t);
      else if (day < today + 7 * DAY) groups.week.push(t);
      else groups.later.push(t);
    }
  }
  return [
    ['pending', 'Pending', groups.pending],
    ['today', 'Aaj', groups.today],
    ['tomorrow', 'Kal', groups.tomorrow],
    ['week', 'Is hafte', groups.week],
    ['later', 'Baad mein', groups.later],
    ['none', 'Bina date', groups.none],
  ].filter(([, , list]) => list.length);
}

function groupDone(tasks) {
  const today = dayStart(new Date());
  const map = new Map();
  for (const t of tasks) {
    const day = dayStart(new Date(t.completedAt));
    const title = day === today ? 'Aaj' : day === today - DAY ? 'Kal' : new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    if (!map.has(title)) map.set(title, []);
    map.get(title).push(t);
  }
  return [...map.entries()];
}

export function TasksScreen() {
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [data, setData] = useState({ open: null, done: null, progress: null });
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const search = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : '';
      const [open, done, progress] = await Promise.all([
        api(`/tasks?status=open&sort=due&limit=100${search}`),
        api(`/tasks?status=done&sort=completed&limit=100${search}`),
        api('/me/progress'),
      ]);
      setData({ open: open.tasks, done: done.tasks, progress, openTotal: open.total });
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // wait for typing to pause before searching
    return () => clearTimeout(t);
  }, [load, q]);
  useLiveRefresh(load);

  const openGroups = useMemo(() => (data.open ? groupOpen(data.open) : []), [data.open]);
  const doneGroups = useMemo(() => (data.done ? groupDone(data.done) : []), [data.done]);
  const loading = !data.open && !error;

  return (
    <ScreenFrame title="Tasks" description="Saare kaam ek jagah. Ho jaaye to nishaan lagao, Saathi hisaab rakhta hai.">
      <div className="mt-6">
        <QuickAdd onSaved={load} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Tasks"
          value={tab}
          onChange={setTab}
          options={[
            ['open', 'Open', data.openTotal ?? 0],
            ['done', 'Completed', 0],
          ]}
        />
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm focus-within:ring-1 focus-within:ring-gold/40 sm:max-w-60">
          <Search size={15} className="shrink-0 text-faint" aria-hidden />
          <span className="sr-only">Tasks mein dhoondho</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dhoondho" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint focus-visible:outline-none" />
        </label>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {loading && <ListSkeleton />}

      {!loading && !error && tab === 'open' && (
        <>
          {openGroups.length === 0 && (
            <EmptyState
              title={q ? 'Is naam ka koi kaam nahi mila' : 'Koi kaam pending nahi'}
              text={q ? 'Spelling check karo, ya Completed tab mein dekho.' : 'Upar ek line mein naya task likho, ya Saathi ko chat mein bolo.'}
              expression={q ? 'thinking' : 'proud'}
            />
          )}
          {openGroups.map(([id, title, list]) => (
            <section key={id}>
              <GroupTitle tone={id === 'pending' ? 'text-vermilion' : 'text-faint'}>{title}</GroupTitle>
              <ul>
                <AnimatePresence initial={false}>
                  {list.map((t) => (
                    <TaskItem key={t.id} task={t} group={id} onChanged={load} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </>
      )}

      {!loading && !error && tab === 'done' && (
        <>
          {data.progress && (
            <div className="glass mt-6 rounded-3xl p-5 sm:p-7">
              <ProgressChart progress={data.progress} />
            </div>
          )}
          {doneGroups.length === 0 && (
            <EmptyState title="Abhi tak kuch complete nahi hua" text="Pehla kaam khatam karo, woh yahan din ke hisaab se dikhega." expression="happy" />
          )}
          {doneGroups.map(([title, list]) => (
            <section key={title}>
              <GroupTitle>
                {title}
                <span className="ml-2 tabular-nums text-faint/70">{list.length}</span>
              </GroupTitle>
              <ul>
                <AnimatePresence initial={false}>
                  {list.map((t) => (
                    <TaskItem key={t.id} task={t} done onChanged={load} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </>
      )}
    </ScreenFrame>
  );
}

function TaskItem({ task, group, done = false, onChanged }) {
  const [state, setState] = useState('idle'); // idle | busy | ticked
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);

  async function run(path, method = 'POST', body) {
    setError(null);
    try {
      await api(path, { method, body });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function toggle() {
    setState('busy');
    const ok = await run(`/tasks/${task.id}/${done ? 'reopen' : 'complete'}`);
    if (!ok) return setState('idle');
    setState('ticked');
    setTimeout(onChanged, 450); // let the tick show before the row moves
  }

  async function remove() {
    setState('busy');
    if (await run(`/tasks/${task.id}`, 'DELETE')) onChanged();
    else setState('idle');
  }

  const checked = done !== (state === 'ticked');
  const meta = done
    ? clock(task.completedAt)
    : task.dueAt
      ? group === 'pending'
        ? lateBy(task.dueAt)
        : group === 'today'
          ? clock(task.dueAt)
          : when(task.dueAt)
      : null;

  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.25 }} className="group border-b border-line/60 last:border-0">
      <div className="flex items-center gap-3 py-3">
        <button
          onClick={toggle}
          disabled={state !== 'idle'}
          aria-label={done ? `"${task.title}" ko phir se open karo` : `"${task.title}" ho gaya`}
          className="-m-2 grid shrink-0 place-items-center p-2"
        >
          <span className={`grid h-5 w-5 place-items-center rounded-full border-[1.5px] transition-colors ${checked ? 'border-leaf bg-leaf text-ink' : 'border-faint hover:border-gold'}`}>
            {checked && <Check size={12} strokeWidth={3.2} />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate ${done ? 'text-faint line-through decoration-faint/60' : 'cursor-pointer'}`}
            {...(!done && {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': editing,
              'aria-label': `"${task.title}" badlo`,
              onClick: () => setEditing((v) => !v),
              onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditing((v) => !v)),
            })}
          >
            {task.title}
            {task.kind === 'deadline' && !done && <span className="ml-2 text-xs text-gold">deadline</span>}
            {task.priority === 'high' && !done && task.kind !== 'deadline' && <span className="ml-2 text-xs text-gold">important</span>}
          </p>
          {(task.repeat || task.tags?.length > 0) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
              {task.repeat && (
                <span className="inline-flex items-center gap-1">
                  <Repeat size={11} aria-hidden /> {task.repeat.every === 'day' ? 'roz' : 'har hafte'}
                </span>
              )}
              {task.tags?.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </p>
          )}
        </div>
        {meta && <span className={`shrink-0 text-sm tabular-nums ${group === 'pending' ? 'text-vermilion' : 'text-faint'}`}>{meta}</span>}
        {!done && (
          <div className="hidden shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 lg:flex">
            <button onClick={() => setEditing((v) => !v)} aria-label={`"${task.title}" badlo`} aria-expanded={editing} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-text">
              <Pencil size={15} />
            </button>
            <button onClick={remove} disabled={state !== 'idle'} aria-label={`"${task.title}" delete karo`} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-vermilion/10 hover:text-vermilion">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      {error && <p className="-mt-1 pb-2 pl-8 text-sm text-vermilion">{error}</p>}
      <AnimatePresence>{editing && <TaskEditor task={task} onClose={() => setEditing(false)} onSaved={onChanged} onDelete={remove} />}</AnimatePresence>
    </motion.li>
  );
}

// Datetime-local value <-> ISO, in the browser's own time.
const toInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function TaskEditor({ task, onClose, onSaved, onDelete }) {
  const [form, setForm] = useState({ title: task.title, due: toInput(task.dueAt), priority: task.priority });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { title: form.title.trim(), priority: form.priority, dueAt: form.due ? new Date(form.due).toISOString() : null },
      });
      onClose();
      onSaved();
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      onSubmit={save}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mb-3 ml-8 rounded-2xl bg-surface p-4">
        <label className="sr-only" htmlFor={`title-${task.id}`}>
          Title
        </label>
        <input
          id={`title-${task.id}`}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg bg-ink/50 px-3 py-2 font-display text-lg font-semibold outline-none focus:bg-ink/80 focus-visible:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="sr-only" htmlFor={`due-${task.id}`}>
            Kab
          </label>
          <input
            id={`due-${task.id}`}
            type="datetime-local"
            value={form.due}
            onChange={(e) => setForm({ ...form, due: e.target.value })}
            className="rounded-lg bg-ink/50 px-2.5 py-1.5 outline-none [color-scheme:dark] focus:bg-ink/80 focus-visible:outline-none"
          />
          {form.due && (
            <button type="button" onClick={() => setForm({ ...form, due: '' })} className="text-xs text-faint hover:text-text">
              Date hatao
            </button>
          )}
          <span className="ml-auto flex gap-1" role="radiogroup" aria-label="Priority">
            {[
              ['low', 'Kabhi bhi'],
              ['normal', 'Normal'],
              ['high', 'Important'],
            ].map(([v, l]) => (
              <button
                type="button"
                key={v}
                role="radio"
                aria-checked={form.priority === v}
                onClick={() => setForm({ ...form, priority: v })}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${form.priority === v ? 'bg-surface-2 text-text ring-1 ring-gold/50' : 'text-faint hover:text-text'}`}
              >
                {l}
              </button>
            ))}
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-vermilion">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={busy || !form.title.trim()} className="btn-gold">
            {busy ? 'Save ho raha hai' : 'Save karo'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost text-faint">
            Rehne do
          </button>
          <button type="button" onClick={onDelete} className="btn-ghost ml-auto text-faint hover:!text-vermilion">
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </motion.form>
  );
}
