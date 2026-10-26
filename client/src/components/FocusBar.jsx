import { AnimatePresence, motion } from 'motion/react';
import { Pause, Timer } from 'lucide-react';
import { clockText, useFocus } from '../app/focus.js';
import { FocusRing } from './FocusRing.jsx';

// The running timer, small and sticky under the top bar on every screen. A tap opens the big view.

export function FocusBar() {
  const f = useFocus();
  const focus = f.focus;
  const fraction = focus ? (focus.status === 'timeup' ? 0 : f.remainingMs / focus.plannedMs) : 0;
  return (
    <AnimatePresence>
      {focus && f.view !== 'big' && (
        <motion.button
          key="focus-bar"
          onClick={f.openBig}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          aria-label={`Focus timer: ${focus.label}, ${f.timeUp ? 'time pura' : clockText(f.remainingMs)} baaki. Bada dekho`}
          className="glass relative z-30 mx-auto mt-1 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-ink/70 py-1.5 pl-1.5 pr-4 shadow-[0_0_24px_-6px_rgb(242_165_65/0.5)] transition hover:bg-ink/90"
        >
          <FocusRing size={34} stroke={3.5} fraction={fraction} glow={false}>
            {focus.status === 'paused' ? <Pause size={12} className="text-gold" /> : <Timer size={13} className="text-gold" />}
          </FocusRing>
          <span className="min-w-0 truncate text-sm text-muted">{focus.label}</span>
          <span className={`font-display text-lg font-semibold tabular-nums ${f.timeUp ? 'text-gold' : ''}`}>{f.timeUp ? 'Time pura!' : clockText(f.remainingMs)}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
