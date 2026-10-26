import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus, Timer, X } from 'lucide-react';
import { useFocus } from '../app/focus.js';
import { Face } from './Face.jsx';

// "Timer lagao": any length (hours + minutes, up to 12 hours), with quick picks, for a task or any
// activity. Saathi can also start one from the chat ("ye kaam 2 ghante 30 minute mein karna hai").

const QUICK = [
  [25, '25 min'],
  [45, '45 min'],
  [60, '1 ghanta'],
  [90, '1.5 ghante'],
  [120, '2 ghante'],
  [180, '3 ghante'],
];

export function FocusStart() {
  const f = useFocus();
  const open = f.view === 'start';
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLabel(f.startFor?.label ?? '');
    setError(null);
    const onKey = (e) => e.key === 'Escape' && f.close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, f]);

  const total = hours * 60 + minutes;
  const setTotal = (t) => {
    const clamped = Math.max(1, Math.min(720, t));
    setHours(Math.floor(clamped / 60));
    setMinutes(clamped % 60);
  };

  async function start(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await f.start({ minutes: total, taskId: f.startFor?.taskId, label: label.trim() || undefined });
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="focus-start"
          className="fixed inset-0 z-[55] grid place-items-end bg-[#070914]/70 p-3 backdrop-blur-md sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && f.close()}
        >
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-label="Focus timer lagao"
            onSubmit={start}
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="glass relative w-full max-w-md rounded-3xl bg-ink/90 p-6 shadow-[0_20px_60px_-20px_rgb(242_165_65/0.45)]"
          >
            <button type="button" onClick={f.close} aria-label="Band karo" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-faint transition hover:bg-surface hover:text-text">
              <X size={17} />
            </button>
            <div className="flex items-center gap-3">
              <Face size={44} expression="excited" followCursor={false} />
              <div>
                <p className="font-display text-xl font-semibold">Timer lagao</p>
                <p className="text-sm text-faint">Jitna time chahiye, utna. Saathi saath baithega.</p>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="text-sm text-muted">Kis kaam par?</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Jaise: DBMS revision"
                maxLength={120}
                autoFocus={!f.startFor?.label}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-text outline-none transition focus:border-gold/60 focus-visible:outline-none"
              />
            </label>

            <div className="mt-5 flex items-center justify-center gap-6">
              <Stepper label="Ghante" value={hours} onChange={(v) => setTotal(v * 60 + minutes)} max={12} />
              <span className="pb-6 font-display text-4xl text-faint">:</span>
              <Stepper label="Minute" value={minutes} onChange={(v) => setTotal(hours * 60 + v)} max={59} step={5} />
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Jaldi chuno">
              {QUICK.map(([m, text]) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setTotal(m)}
                  aria-pressed={total === m}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${total === m ? 'bg-surface-2 text-text ring-1 ring-gold/60' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {text}
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-center text-sm text-vermilion">{error}</p>}
            <button type="submit" disabled={busy || total < 1 || (!label.trim() && !f.startFor?.taskId)} className="btn-gold btn-lg mt-6 w-full justify-center">
              <Timer size={18} /> {busy ? 'Shuru ho raha hai' : 'Shuru karo'}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stepper({ label, value, onChange, max, step = 1 }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(Math.max(0, value - step))} aria-label={`${label} kam karo`} className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition hover:text-text active:scale-95">
          <Minus size={16} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          aria-label={label}
          className="w-16 bg-transparent text-center font-display text-4xl font-semibold tabular-nums outline-none [appearance:textfield] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button type="button" onClick={() => onChange(Math.min(max, value + step))} aria-label={`${label} badhao`} className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted transition hover:text-text active:scale-95">
          <Plus size={16} />
        </button>
      </div>
      <span className="mt-1 text-xs text-faint">{label}</span>
    </div>
  );
}
