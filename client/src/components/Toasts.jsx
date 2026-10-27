import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';
import { notifyStyle, oneTask } from '../lib/notifyStyle.js';
import { Face } from './Face.jsx';
import { SpaceBackdrop } from './SpaceBackdrop.jsx';

// Notifications while Saathi is open: big glass cards that slide in at the top right (full width on
// phones), each with its kind's colour, emoji and space photo, Saathi's face with the expression it
// chose, a clear heading, Saathi's short line and big buttons ("Ho gaya ✅", "10 min baad 😴",
// "Kholo"). Several stack, newest on top. A reminder stays until you act on it; the others shrink
// to a small line after a few seconds (hover or focus to open them again) and then leave. Esc closes
// the newest. The same notification also reaches your other devices as a push (or email).

const SHRINK_AFTER_MS = 8_000;
const LEAVE_AFTER_MS = 40_000;

export function Toasts({ items, onDismiss, onChanged, go }) {
  // Esc closes the newest card (unless a dialog such as the timer is open on top).
  const newest = items[0]?.id;
  useEffect(() => {
    if (!newest) return;
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('[aria-modal="true"]') && onDismiss(newest);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newest, onDismiss]);

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),10px)] z-50 flex flex-col items-center gap-3 px-3 sm:inset-x-auto sm:right-5 sm:top-4 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {items.map((n, i) => (
          <Notice key={n.id} n={n} index={i} onDismiss={() => onDismiss(n.id)} onChanged={onChanged} go={go} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Notice({ n, index, onDismiss, onChanged, go }) {
  const reduce = useReducedMotion();
  const style = notifyStyle(n);
  const persistent = n.kind === 'reminder';
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [small, setSmall] = useState(false);
  const [hold, setHold] = useState(false); // pointer or keyboard focus on it
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const titleId = useId();
  const bodyId = useId();

  // Non-reminders shrink after a few seconds and leave later; never while you are on it.
  useEffect(() => {
    if (persistent || hold || busy) return;
    if (note) {
      const t = setTimeout(() => dismiss.current(), 1800);
      return () => clearTimeout(t);
    }
    const shrink = setTimeout(() => setSmall(true), SHRINK_AFTER_MS);
    const leave = setTimeout(() => dismiss.current(), LEAVE_AFTER_MS);
    return () => {
      clearTimeout(shrink);
      clearTimeout(leave);
    };
  }, [persistent, hold, busy, note]);

  async function run(request, done) {
    setBusy(true);
    try {
      const res = await request();
      setNote(res?.message ?? done);
      onChanged();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }
  const action = (name) => run(() => api('/push/action', { method: 'POST', body: { notificationId: n.id, action: name } }));
  const open = () => {
    api('/push/action', { method: 'POST', body: { notificationId: n.id, action: 'open' } }).catch(() => {});
    go(style.path);
    onDismiss();
  };
  const compact = small && !hold;

  return (
    <motion.section
      layout
      role={persistent ? 'alertdialog' : 'status'}
      aria-labelledby={titleId}
      aria-describedby={n.body ? bodyId : undefined}
      aria-live={persistent ? 'assertive' : 'polite'}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHold(false)}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 60, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: index > 2 ? 0.96 : 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 60, scale: 0.96, transition: { duration: 0.25 } }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ '--glow': style.glow }}
      className={`glass pointer-events-auto relative isolate w-full overflow-hidden bg-ink/75 backdrop-blur-2xl shadow-[0_0_0_1px_rgb(var(--glow)/0.3),0_18px_50px_-12px_rgb(var(--glow)/0.45)] ${compact ? 'max-w-sm rounded-full px-3 py-2' : 'max-w-[440px] rounded-[28px] p-5'}`}
    >
      {!compact && <SpaceBackdrop photo={style.photo} className="absolute" strength="strong" />}
      <span aria-hidden className="pointer-events-none absolute -left-12 -top-12 -z-[5] h-44 w-44 rounded-full bg-[rgb(var(--glow)/0.25)] blur-3xl" />

      {compact ? (
        <button onClick={() => setSmall(false)} className="flex w-full items-center gap-2.5 text-left" aria-label={`${n.title}: kholo`}>
          <Face size={26} expression={n.expression ?? 'happy'} followCursor={false} />
          <span aria-hidden>{style.emoji}</span>
          <span id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
            {n.title}
          </span>
        </button>
      ) : (
        <>
          <button onClick={onDismiss} aria-label="Band karo (Esc)" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text">
            <X size={16} />
          </button>
          <div className="flex gap-4">
            <div className="relative shrink-0 self-start">
              <Face size={58} expression={n.expression ?? (n.kind === 'nudge' ? 'concerned' : 'happy')} followCursor={false} />
              <span aria-hidden className="absolute -bottom-1 -right-2 text-xl leading-none drop-shadow">
                {style.emoji}
              </span>
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={titleId} className="pr-8 font-display text-xl font-semibold leading-snug">
                {n.title}
              </h2>
              {n.body && (
                <p id={bodyId} className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  {n.body}
                </p>
              )}
            </div>
          </div>
          {note ? (
            <p className="mt-4 text-[15px] font-semibold text-leaf" role="status">
              {note}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {oneTask(n) && !['achievement', 'countdown'].includes(n.kind) && (
                <Btn primary disabled={busy} onClick={() => action('done')}>
                  Ho gaya ✅
                </Btn>
              )}
              {n.kind === 'reminder' && n.refId && (
                <Btn disabled={busy} onClick={() => action('snooze')}>
                  10 min baad 😴
                </Btn>
              )}
              {n.kind === 'recap' && n.data?.leftovers?.length > 0 && (
                <Btn primary disabled={busy} onClick={() => run(() => api('/me/leftovers/move-to-tomorrow', { method: 'POST' }), 'Bache kaam kal pe shift ho gaye')}>
                  Kal shift karo
                </Btn>
              )}
              <Btn disabled={busy} onClick={open}>
                Kholo
              </Btn>
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}

function Btn({ primary, ...props }) {
  return (
    <button
      {...props}
      className={`h-11 grow whitespace-nowrap rounded-full px-4 text-sm font-semibold transition active:scale-95 disabled:opacity-50 sm:grow-0 ${primary ? 'bg-gold text-ink shadow-[0_0_24px_-6px_rgb(242_165_65/0.7)] hover:brightness-110' : 'bg-surface-2/80 text-text hover:bg-line'}`}
    />
  );
}
