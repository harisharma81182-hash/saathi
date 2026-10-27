import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Minimize2, Pause, Play, Plus, X } from 'lucide-react';
import { clockText, spokenLength, useFocus } from '../app/focus.js';
import { FocusRing } from './FocusRing.jsx';
import { Face } from './Face.jsx';

// The big focus view: a golden ring emptying with the time, big numbers, and Saathi's face, whose
// mood follows the clock (happy at the start, thoughtful midway, a little tense near the end).
// When the work is done: a short celebration (gold stars, the ring flashes full, Saathi cheers,
// a line from Saathi and how long it took). Esc or the minimise button goes back to the small bar.

function moodFor(focus, fraction, timeUp) {
  if (timeUp) return 'surprised';
  if (focus.status === 'paused') return 'sleepy';
  if (fraction > 0.5) return 'happy';
  if (fraction > 0.2) return 'thinking';
  return 'concerned';
}

export function FocusView({ user }) {
  const f = useFocus();
  const open = f.view === 'big' && (f.focus || f.celebration);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && (f.celebration ? f.endCelebration() : f.close());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, f]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="focus-view"
          role="dialog"
          aria-modal="true"
          aria-label="Focus timer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[55] flex flex-col items-center overflow-y-auto bg-[#070914]/80 px-4 backdrop-blur-xl"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_30rem_at_50%_40%,rgb(242_165_65/0.14),transparent_70%)]" />
          {f.celebration ? <Celebration user={user} /> : <Running />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Running() {
  const f = useFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { focus, remainingMs, timeUp } = f;
  if (!focus) return null;
  const fraction = timeUp ? 0 : remainingMs / focus.plannedMs;
  const small = typeof window !== 'undefined' && window.innerWidth < 640;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex w-full max-w-xl items-center justify-between pt-[max(env(safe-area-inset-top),16px)]">
        <p className="min-w-0 truncate text-sm text-faint">Focus: {focus.label}</p>
        <button onClick={f.close} aria-label="Chhota karo" title="Chhota karo" className="grid h-10 w-10 place-items-center rounded-full text-faint transition hover:bg-surface hover:text-text">
          <Minimize2 size={18} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-6">
        <FocusRing size={small ? 250 : 320} stroke={small ? 9 : 11} fraction={fraction}>
          <Face size={small ? 96 : 120} expression={moodFor(focus, fraction, timeUp)} followCursor={false} />
        </FocusRing>
        <p className={`mt-6 font-display text-[3.75rem] font-semibold leading-none tabular-nums tracking-tight sm:text-[4.75rem] ${timeUp ? 'text-gold' : ''}`} aria-live="polite">
          {timeUp ? '00:00' : clockText(remainingMs)}
        </p>
        <p className="mt-2 text-muted">{timeUp ? 'Time pura! Ho gaya?' : focus.status === 'paused' ? 'Ruka hua hai. Taiyaar ho toh chalu karo.' : 'Focus mode on. Phone side mein rakho.'}</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {timeUp ? (
            <>
              <BigButton primary disabled={busy} onClick={() => run(() => f.finish())}>
                <Check size={18} /> Ho gaya ✅
              </BigButton>
              <BigButton disabled={busy} onClick={() => run(() => f.extend(10))}>
                10 min aur ⏳
              </BigButton>
            </>
          ) : (
            <>
              {focus.status === 'paused' ? (
                <BigButton disabled={busy} onClick={() => run(f.resume)}>
                  <Play size={18} /> Resume
                </BigButton>
              ) : (
                <BigButton disabled={busy} onClick={() => run(f.pause)}>
                  <Pause size={18} /> Pause
                </BigButton>
              )}
              <BigButton disabled={busy} onClick={() => run(() => f.extend(5))}>
                <Plus size={18} /> 5 min
              </BigButton>
              <BigButton primary disabled={busy} onClick={() => run(() => f.finish())}>
                <Check size={18} /> Khatam
              </BigButton>
            </>
          )}
        </div>
        <button disabled={busy} onClick={() => run(f.cancel)} className="mt-5 inline-flex items-center gap-1.5 text-sm text-faint transition hover:text-vermilion">
          <X size={15} /> Timer cancel karo
        </button>
        {error && <p className="mt-3 text-sm text-vermilion">{error}</p>}
      </div>
    </>
  );
}

function BigButton({ primary, children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex h-12 items-center gap-2 rounded-full px-6 font-semibold transition active:scale-95 disabled:opacity-50 ${primary ? 'bg-gold text-ink shadow-[0_0_30px_-6px_rgb(242_165_65/0.7)] hover:brightness-110' : 'glass bg-ink/60 text-text hover:bg-surface-2'}`}
    >
      {children}
    </button>
  );
}

/** Gold stars bursting out and drifting down, about 2.5 seconds. Nothing with reduced motion. */
function StarBurst() {
  const reduce = useReducedMotion();
  const stars = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const a = (i / 42) * Math.PI * 2 + Math.random() * 0.3;
        const d = 120 + Math.random() * 180;
        return { id: i, x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, fall: 140 + Math.random() * 160, size: 6 + Math.random() * 9, delay: Math.random() * 0.25, spin: (Math.random() - 0.5) * 360 };
      }),
    [],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {stars.map((s) => (
        <motion.span
          key={s.id}
          className="absolute block"
          style={{ width: s.size, height: s.size, marginLeft: -s.size / 2, marginTop: -s.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
          animate={{ x: s.x, y: [0, s.y, s.y + s.fall], opacity: [0, 1, 0], scale: [0.4, 1, 0.7], rotate: s.spin }}
          transition={{ duration: 2.4, delay: s.delay, ease: [0.22, 1, 0.36, 1], times: [0, 0.35, 1] }}
        >
          <svg viewBox="0 0 24 24" width={s.size} height={s.size}>
            <path d="M12 0l2.9 8.6L24 12l-9.1 3.4L12 24l-2.9-8.6L0 12l9.1-3.4z" fill={s.id % 3 ? '#F2A541' : '#FFE3A8'} />
          </svg>
        </motion.span>
      ))}
    </div>
  );
}

function Celebration({ user }) {
  const f = useFocus();
  const c = f.celebration;
  const reduce = useReducedMotion();
  // Close by itself after a while (the user can close it sooner).
  useEffect(() => {
    const t = setTimeout(f.endCelebration, 9000);
    return () => clearTimeout(t);
  }, [f.endCelebration]);
  const fallback = `Kamaal kar diya ${user.name}! 🎉 ${spokenLength(c.focusedMs)} ka focus poora!`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center" role="status" aria-live="polite">
      <div className="relative">
        <StarBurst />
        <motion.div initial={reduce ? false : { scale: 0.9 }} animate={{ scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <FocusRing size={240} stroke={10} fraction={1} flash>
            <motion.div initial={reduce ? false : { y: 6 }} animate={reduce ? {} : { y: [6, -8, 0] }} transition={{ duration: 0.9, delay: 0.2 }}>
              <Face size={110} expression="excited" followCursor={false} />
            </motion.div>
          </FocusRing>
        </motion.div>
      </div>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="mt-8 max-w-md font-display text-2xl font-semibold leading-snug sm:text-3xl"
      >
        {c.message ?? fallback}
      </motion.p>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-2 text-muted">
        {c.label}: {spokenLength(c.focusedMs)} focus
      </motion.p>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} onClick={f.endCelebration} className="btn-gold mt-8">
        Shukriya Saathi
      </motion.button>
    </div>
  );
}
