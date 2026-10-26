import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';
import { notifyStyle, oneTask } from '../lib/notifyStyle.js';
import { Face } from './Face.jsx';
import { SpaceBackdrop } from './SpaceBackdrop.jsx';

// Notifications while Saathi is open (a reminder rang, a task is due, the morning plan, a streak...)
// slide in at the top right as glass cards: the kind's emoji and glow colour, its space photo, Saathi's
// face with the expression it chose, and the buttons that make sense ("Ho gaya", "10 min baad",
// "Kholo"). Reminders stay until closed; the rest leave by themselves after a few seconds.
// The same notification also goes to the user's other devices as a push (or email).

const AUTO_CLOSE_MS = 12_000;

export function Toasts({ items, onDismiss, onChanged, go }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-50 flex flex-col items-center gap-3 px-3 sm:inset-x-auto sm:right-4 sm:items-end">
      <AnimatePresence>
        {items.map((n) => (
          <Toast key={n.id} n={n} onDismiss={() => onDismiss(n.id)} onChanged={onChanged} go={go} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ n, onDismiss, onChanged, go }) {
  const reduce = useReducedMotion();
  const style = notifyStyle(n);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [hover, setHover] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  // Everything except reminders closes by itself (not while the pointer is on it).
  useEffect(() => {
    if (n.kind === 'reminder' || hover || busy) return;
    const t = setTimeout(() => dismiss.current(), note ? 1800 : AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [n.kind, hover, busy, note]);

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

  return (
    <motion.div
      layout
      role="status"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48, transition: { duration: 0.25 } }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      style={{ '--glow': style.glow }}
      className="glass pointer-events-auto relative isolate w-full max-w-sm overflow-hidden rounded-3xl bg-ink/75 p-4 shadow-[0_0_0_1px_rgb(var(--glow)/0.25),0_12px_40px_-8px_rgb(var(--glow)/0.35)]"
    >
      <SpaceBackdrop photo={style.photo} className="absolute" strength="strong" />
      {/* A soft light in the kind's colour behind Saathi's face */}
      <span aria-hidden className="pointer-events-none absolute -left-10 -top-10 -z-[5] h-36 w-36 rounded-full bg-[rgb(var(--glow)/0.22)] blur-2xl" />
      <button onClick={onDismiss} aria-label="Band karo" className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text">
        <X size={15} />
      </button>
      <div className="flex gap-3">
        <div className="relative shrink-0 self-start">
          <Face size={42} expression={n.expression ?? (n.kind === 'nudge' ? 'concerned' : 'happy')} followCursor={false} />
          <span aria-hidden className="absolute -bottom-1 -right-1.5 text-base leading-none">
            {style.emoji}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="pr-7 font-display text-[17px] font-semibold leading-snug">{n.title}</p>
          {n.body && <p className="mt-1 text-sm leading-relaxed text-muted">{n.body}</p>}
          {note ? (
            <p className="mt-2.5 text-sm font-semibold text-leaf">{note}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {oneTask(n) && n.kind !== 'achievement' && n.kind !== 'countdown' && (
                <Btn primary disabled={busy} onClick={() => action('done')}>
                  Ho gaya ✅
                </Btn>
              )}
              {n.kind === 'reminder' && n.refId && (
                <>
                  <Btn disabled={busy} onClick={() => action('snooze')}>
                    10 min baad 😴
                  </Btn>
                  <Btn disabled={busy} onClick={() => run(() => api(`/reminders/${n.refId}/snooze`, { method: 'POST', body: { minutes: 60 } }), '1 ghante baad phir yaad dilaunga')}>
                    1 ghanta
                  </Btn>
                </>
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
        </div>
      </div>
    </motion.div>
  );
}

function Btn({ primary, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-50 ${primary ? 'bg-gold text-ink hover:brightness-110' : 'bg-surface-2/80 text-text hover:bg-line'}`}
    />
  );
}
