import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Check, Flame, RotateCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { clock, lateBy, when } from '../lib/format.js';
import { Face } from './Face.jsx';
import { QuickAdd } from './QuickAdd.jsx';

// The Today panel: what matters today, at a glance. Refreshed live whenever something changes
// (Saathi added a task, a reminder fired, you completed something in another tab).
// Quiet on purpose: sections are separated by space and small labels, not boxes, so the chat and
// Saathi's face stay the focus of the screen.

export function TodayPanel({ today, error, onRetry, onChanged }) {
  if (error) {
    return (
      <Panel>
        <p className="text-sm text-muted">{error.message}</p>
        <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gold hover:text-text">
          <RotateCw size={14} /> Dobara load karo
        </button>
      </Panel>
    );
  }
  if (!today) return <PanelSkeleton />;

  const { countdowns, upcomingReminders, habits = [], dayPlan, counts } = today;
  // Habits have their own section with the streak, so they are not listed twice.
  const dueToday = today.dueToday.filter((t) => !t.repeat);
  const overdue = today.overdue.filter((t) => !t.repeat);
  const nothing = !countdowns.length && !dueToday.length && !overdue.length && !upcomingReminders.length && !habits.length && !dayPlan?.slots?.length;
  return (
    <Panel>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Aaj</h2>
        <p className="text-sm text-faint">
          {counts.doneToday > 0 && <span className="text-leaf">{counts.doneToday} ho gaye · </span>}
          {today.focus?.todayMinutes > 0 && <span className="text-gold">{today.focus.todayMinutes} min focus · </span>}
          {counts.openTasks} baaki
        </p>
      </header>

      <div className="mt-4">
        <QuickAdd onSaved={onChanged} />
      </div>

      {nothing && (
        <div className="mt-12 flex flex-col items-center text-center">
          <Face size={56} expression="sleepy" followCursor={false} label="Saathi aaram kar raha hai" />
          <p className="mt-4 font-display text-lg font-semibold">Aaj abhi tak khaali hai</p>
          <p className="mt-1 max-w-[16rem] text-sm text-faint">Chat mein bolo ya upar ek line likho. Jo bhi banega, yahan dikhega.</p>
        </div>
      )}

      <LayoutGroup>
        {countdowns.length > 0 && (
          <Section title="Countdown">
            <ul className="flex flex-col gap-3">
              {countdowns.slice(0, 3).map((t) => (
                <motion.li layout key={t.id} className="flex items-center gap-4">
                  <span className="w-10 text-right font-display text-3xl font-semibold leading-none text-gold tabular-nums">{t.daysLeft === 0 ? '0' : t.daysLeft}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{t.title}</span>
                    <span className="block text-xs text-faint">{t.daysLeft === 0 ? 'aaj hai' : t.daysLeft === 1 ? 'din bacha, kal hai' : 'din bache'}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </Section>
        )}

        {overdue.length > 0 && (
          <Section title="Pending">
            <TaskList tasks={overdue} meta={(t) => <span className="text-vermilion">{lateBy(t.dueAt)}</span>} onChanged={onChanged} />
          </Section>
        )}

        {dueToday.length > 0 && (
          <Section title="Aaj karna hai">
            <TaskList tasks={dueToday} meta={(t) => clock(t.dueAt)} onChanged={onChanged} />
          </Section>
        )}

        {habits.length > 0 && (
          <Section title="Habits">
            <ul className="flex flex-col">
              {habits.map((h) => (
                <motion.li layout key={h.id} className="flex items-center gap-3 py-1.5">
                  <TaskCheck task={h} onChanged={onChanged} />
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  {h.streak > 0 ? (
                    <span className={`inline-flex items-center gap-1 text-sm tabular-nums ${h.streak >= 3 ? 'text-gold' : 'text-faint'}`} title={`${h.streak} din lagatar`}>
                      <Flame size={14} strokeWidth={2} /> {h.streak}
                    </span>
                  ) : (
                    <span className="text-sm text-faint">{when(h.dueAt)}</span>
                  )}
                </motion.li>
              ))}
            </ul>
          </Section>
        )}

        {upcomingReminders.length > 0 && (
          <Section title="Reminders">
            <ul className="flex flex-col gap-2">
              {upcomingReminders.map((r) => (
                <li key={r.id} className="flex gap-4 text-sm">
                  <span className="w-16 shrink-0 text-faint tabular-nums">{clock(r.remindAt)}</span>
                  <span className="min-w-0 flex-1 text-muted">{r.text}</span>
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
                  <span className="absolute -left-[20.5px] top-1.5 h-2 w-2 rounded-full bg-gold/80 ring-4 ring-ink" />
                  <span className="text-faint tabular-nums">
                    {s.start}–{s.end}
                  </span>{' '}
                  <span className="text-muted">{s.label}</span>
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
    <ul className="flex flex-col">
      <AnimatePresence initial={false}>
        {tasks.map((t) => (
          <motion.li
            layout
            key={t.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-3 py-1.5"
          >
            <TaskCheck task={t} onChanged={onChanged} />
            <span className="min-w-0 flex-1 truncate">
              {t.title}
              {t.priority === 'high' && <span className="ml-2 text-xs text-gold">important</span>}
            </span>
            <span className="shrink-0 text-sm text-faint tabular-nums">{meta(t)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** Tick a task off right from the panel: the circle fills, a soft ring fades out, the item leaves. */
function TaskCheck({ task, onChanged }) {
  const [state, setState] = useState('idle');
  const done = state === 'done';
  async function complete() {
    setState('busy');
    try {
      await api(`/tasks/${task.id}/complete`, { method: 'POST' });
      setState('done');
      setTimeout(onChanged, 600); // let the tick show before the item leaves
    } catch {
      setState('idle');
    }
  }
  return (
    <button
      onClick={complete}
      disabled={state !== 'idle'}
      aria-label={`"${task.title}" ho gaya`}
      className="group relative -m-2 grid shrink-0 place-items-center p-2"
    >
      <span
        className={`grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] transition-colors ${done ? 'border-leaf bg-leaf text-ink' : 'border-faint group-hover:border-gold'}`}
      >
        {done && <Check size={11} strokeWidth={3.2} />}
      </span>
      <AnimatePresence>
        {done && (
          <motion.span
            aria-hidden
            className="absolute h-[18px] w-[18px] rounded-full border border-leaf"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        )}
      </AnimatePresence>
    </button>
  );
}

function Section({ title, children }) {
  return (
    <motion.section layout className="mt-8">
      <h3 className="mb-2 text-sm font-medium text-faint">{title}</h3>
      {children}
    </motion.section>
  );
}

function Panel({ children }) {
  return <div className="scroll-quiet h-full overflow-y-auto px-6 py-6">{children}</div>;
}

function PanelSkeleton() {
  return (
    <Panel>
      <div className="skeleton h-7 w-20" />
      <div className="skeleton mt-4 h-11" />
      <div className="skeleton mt-8 h-4 w-24" />
      <div className="skeleton mt-3 h-9 w-3/4" />
      <div className="skeleton mt-8 h-4 w-28" />
      <div className="skeleton mt-3 h-6" />
      <div className="skeleton mt-2 h-6 w-4/5" />
    </Panel>
  );
}
