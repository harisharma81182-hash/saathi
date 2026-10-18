import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { api } from '../lib/api.js';
import { clock, lateBy, when } from '../lib/format.js';

// The Today panel: what matters today, at a glance. Refreshed live whenever something changes
// (Saathi added a task, a reminder fired, you completed something in another tab).

export function TodayPanel({ today, error, onRetry, onChanged }) {
  if (error) {
    return (
      <Panel>
        <p className="text-sm text-muted">{error.message}</p>
        <button onClick={onRetry} className="mt-3 rounded-full border border-line px-4 py-1.5 text-sm hover:border-gold/50">
          Dobara load karo
        </button>
      </Panel>
    );
  }
  if (!today) return <PanelSkeleton />;

  const { countdowns, dueToday, overdue, upcomingReminders, habits = [], dayPlan, counts } = today;
  const nothing = !countdowns.length && !dueToday.length && !overdue.length && !upcomingReminders.length && !habits.length;
  return (
    <Panel>
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold">Aaj</h2>
        <p className="text-sm text-muted">
          <span className="font-semibold text-leaf">{counts.doneToday}</span> done · {counts.openTasks} open
        </p>
      </header>

      {nothing && (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Aaj ka din khaali hai. Chat mein Saathi ko bolo kya karna hai, woh yahan dikhne lagega.
        </p>
      )}

      <LayoutGroup>
        {countdowns.length > 0 && (
          <Section title="Countdown">
            <div className="grid grid-cols-2 gap-2">
              {countdowns.slice(0, 4).map((t) => (
                <motion.div layout key={t.id} className="rounded-2xl bg-gold-soft p-3">
                  <p className="font-display text-3xl font-bold leading-none text-gold">
                    {t.daysLeft === 0 ? 'Aaj' : t.daysLeft}
                    {t.daysLeft > 0 && <span className="ml-1 text-sm font-semibold text-gold/70">din</span>}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-snug">{t.title}</p>
                </motion.div>
              ))}
            </div>
          </Section>
        )}

        {overdue.length > 0 && (
          <Section title="Pending" tone="text-vermilion">
            <TaskList tasks={overdue} meta={(t) => <span className="text-vermilion/90">{lateBy(t.dueAt)}</span>} onChanged={onChanged} />
          </Section>
        )}

        {dueToday.length > 0 && (
          <Section title="Aaj karna hai">
            <TaskList tasks={dueToday} meta={(t) => clock(t.dueAt)} onChanged={onChanged} />
          </Section>
        )}

        {habits.length > 0 && (
          <Section title="Habits">
            <ul className="flex flex-col gap-1.5">
              {habits.map((h) => (
                <motion.li layout key={h.id} className="flex items-center gap-3 rounded-xl px-1 py-1">
                  <Check task={h} onChanged={onChanged} />
                  <span className="flex-1 truncate">{h.title}</span>
                  <span className={`text-sm ${h.streak >= 3 ? 'text-gold' : 'text-faint'}`} title={`${h.streak} din lagatar`}>
                    {h.streak > 0 ? `🔥 ${h.streak}` : when(h.dueAt)}
                  </span>
                </motion.li>
              ))}
            </ul>
          </Section>
        )}

        {upcomingReminders.length > 0 && (
          <Section title="Reminders">
            <ul className="flex flex-col gap-2">
              {upcomingReminders.map((r) => (
                <li key={r.id} className="flex gap-3 text-sm">
                  <span className="w-20 shrink-0 text-faint">{clock(r.remindAt)}</span>
                  <span className="flex-1">{r.text}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {dayPlan?.slots?.length > 0 && (
          <Section title="Aaj ka plan">
            <ol className="relative ml-1 border-l border-line pl-4">
              {dayPlan.slots.map((s, i) => (
                <li key={i} className="relative pb-3 text-sm last:pb-0">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-gold" />
                  <span className="text-faint">
                    {s.start}–{s.end}
                  </span>{' '}
                  {s.label}
                </li>
              ))}
            </ol>
          </Section>
        )}
      </LayoutGroup>
    </Panel>
  );
}

function TaskList({ tasks, meta, onChanged }) {
  return (
    <ul className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {tasks.map((t) => (
          <motion.li
            layout
            key={t.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            className="flex items-center gap-3 rounded-xl px-1 py-1"
          >
            <Check task={t} onChanged={onChanged} />
            <span className="flex-1 truncate">
              {t.priority === 'high' && <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-gold" title="Important" />}
              {t.title}
            </span>
            <span className="shrink-0 text-sm text-faint">{meta(t)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** Tick a task off right from the panel, with a small celebration. */
function Check({ task, onChanged }) {
  const [state, setState] = useState('idle');
  const done = state === 'done';
  async function complete() {
    setState('busy');
    try {
      await api(`/tasks/${task.id}/complete`, { method: 'POST' });
      setState('done');
      setTimeout(onChanged, 650); // let the tick play before the item leaves
    } catch {
      setState('idle');
    }
  }
  return (
    <button
      onClick={complete}
      disabled={state !== 'idle'}
      aria-label={`${task.title} done karo`}
      className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${done ? 'border-leaf bg-leaf' : 'border-faint hover:border-gold'}`}
    >
      <AnimatePresence>
        {done && (
          <>
            <motion.svg initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#0b0d14" strokeWidth="4" strokeLinecap="round">
              <motion.path d="M5 12l5 5 9-10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
            </motion.svg>
            {/* A small burst of light, once. */}
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-leaf"
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 0.6 }}
            />
          </>
        )}
      </AnimatePresence>
    </button>
  );
}

function Section({ title, tone = 'text-muted', children }) {
  return (
    <motion.section layout className="mt-6">
      <h3 className={`mb-2 font-display text-sm font-semibold ${tone}`}>{title}</h3>
      {children}
    </motion.section>
  );
}

function Panel({ children }) {
  return <div className="h-full overflow-y-auto scroll-quiet px-5 py-5">{children}</div>;
}

function PanelSkeleton() {
  return (
    <Panel>
      <div className="skeleton h-8 w-24" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>
      <div className="skeleton mt-6 h-5 w-32" />
      <div className="skeleton mt-3 h-6" />
      <div className="skeleton mt-2 h-6" />
      <div className="skeleton mt-2 h-6 w-3/4" />
    </Panel>
  );
}
