import { motion, AnimatePresence } from 'motion/react';
import { TOOL_LABELS } from '../lib/format.js';

// Small pieces of Saathi's replies: the "receipt" slip for every change it made (with Undo), the
// Confirm/Cancel card for destructive actions, and the "working on it" line while a tool runs.

export function ReceiptSlip({ receipt, onUndo }) {
  const { summary, undone, undoing, undoError } = receipt;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`relative mt-2 flex items-start gap-3 rounded-xl border border-dashed px-3 py-2 text-sm ${undone ? 'border-line text-faint' : 'border-gold/30 bg-gold-soft/60 text-text'}`}
    >
      {/* The stamp lands once, like a rubber stamp on a slip. */}
      <motion.span
        aria-hidden
        initial={{ scale: 1.8, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: -8, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.1 }}
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${undone ? 'bg-surface-2 text-faint' : 'bg-leaf text-ink'}`}
      >
        {undone ? '↺' : '✓'}
      </motion.span>
      <span className={`flex-1 ${undone ? 'line-through' : ''}`}>{summary}</span>
      {!undone && (
        <button
          onClick={onUndo}
          disabled={undoing}
          className="shrink-0 rounded-full px-2 text-xs font-semibold text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          {undoing ? 'Undo...' : 'Undo'}
        </button>
      )}
      {undoError && <span className="basis-full text-xs text-vermilion">{undoError}</span>}
    </motion.div>
  );
}

export function ConfirmCard({ confirm, onAnswer }) {
  const settled = confirm.status !== 'pending';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-xl border border-vermilion/30 bg-vermilion/5 p-3 text-sm"
    >
      <p>{confirm.summary}</p>
      {settled ? (
        <p className="mt-1 text-xs text-muted">{confirm.status === 'confirmed' ? 'Ho gaya. Activity se Undo kar sakte ho.' : 'Theek hai, kuch nahi hataya.'}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            disabled={confirm.busy}
            onClick={() => onAnswer('confirm')}
            className="rounded-full bg-vermilion px-4 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
          >
            Haan, delete karo
          </button>
          <button disabled={confirm.busy} onClick={() => onAnswer('cancel')} className="rounded-full px-4 py-1.5 text-xs font-semibold text-muted hover:text-text">
            Rehne do
          </button>
        </div>
      )}
      {confirm.error && <p className="mt-1 text-xs text-vermilion">{confirm.error}</p>}
    </motion.div>
  );
}

export function ToolActivity({ tools }) {
  const running = tools.filter((t) => t.status === 'running');
  return (
    <AnimatePresence>
      {running.map((t) => (
        <motion.p
          key={t.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="mt-1 flex items-center gap-2 text-sm text-muted"
        >
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-gold"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          {TOOL_LABELS[t.name] ?? 'Kaam kar raha hoon'}...
        </motion.p>
      ))}
    </AnimatePresence>
  );
}

/** Three soft dots while Saathi has not written anything yet. */
export function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-2" aria-label="Saathi soch raha hai">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
