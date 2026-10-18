import { motion, AnimatePresence } from 'motion/react';
import { Check, Undo2 } from 'lucide-react';
import { TOOL_LABELS } from '../lib/format.js';

// Small pieces of Saathi's replies: the receipt for every change it made (with Undo), the
// Confirm/Cancel request for destructive actions, and the "working on it" line while a tool runs.
// They sit quietly under the reply: a perforated line, not another box.

const ENTER = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } };

export function ReceiptSlip({ receipt, onUndo }) {
  const { summary, undone, undoing, undoError } = receipt;
  return (
    <motion.div {...ENTER} className="mt-3 flex flex-wrap items-start gap-x-2.5 border-t border-dashed border-line pt-2.5 text-sm">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${undone ? 'text-faint' : 'bg-leaf/15 text-leaf'}`}>
        {undone ? <Undo2 size={12} strokeWidth={2.2} /> : <Check size={11} strokeWidth={3} />}
      </span>
      <span className={`min-w-0 flex-1 ${undone ? 'text-faint line-through' : 'text-muted'}`}>{summary}</span>
      {!undone && (
        <button
          onClick={onUndo}
          disabled={undoing}
          className="shrink-0 rounded-md px-1.5 text-xs font-semibold text-gold transition-colors hover:text-text active:opacity-70 disabled:opacity-50"
        >
          {undoing ? 'Undo ho raha hai' : 'Undo'}
        </button>
      )}
      {undoError && <span className="mt-1 basis-full pl-6 text-xs text-vermilion">{undoError}</span>}
    </motion.div>
  );
}

export function ConfirmCard({ confirm, onAnswer }) {
  const settled = confirm.status !== 'pending';
  return (
    <motion.div {...ENTER} className="mt-3 border-l-2 border-vermilion/60 pl-3 text-sm">
      <p className="text-text">{confirm.summary}</p>
      {settled ? (
        <p className="mt-1 text-xs text-faint">{confirm.status === 'confirmed' ? 'Ho gaya. Galti se hua ho to Activity se Undo kar sakte ho.' : 'Theek hai, kuch nahi hataya.'}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            disabled={confirm.busy}
            onClick={() => onAnswer('confirm')}
            className="rounded-full bg-vermilion/90 px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-vermilion active:scale-[0.98] disabled:opacity-50"
          >
            Haan, delete karo
          </button>
          <button
            disabled={confirm.busy}
            onClick={() => onAnswer('cancel')}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface hover:text-text"
          >
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
        <motion.p key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1 flex items-center gap-2 text-sm text-faint">
          <motion.span className="h-1.5 w-1.5 rounded-full bg-gold" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} />
          {TOOL_LABELS[t.name] ?? 'Kaam kar raha hoon'}
        </motion.p>
      ))}
    </AnimatePresence>
  );
}

/** Three quiet dots while Saathi has not written anything yet (they fade, they don't bounce). */
export function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-2.5" role="status" aria-label="Saathi soch raha hai">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}
