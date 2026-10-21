import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';

// After every change you make (complete, delete, edit, snooze...), a small bar at the bottom offers
// Undo for 10 seconds. The thin line inside it runs out with the time. (Saathi's own changes show
// receipts with Undo in the chat instead.)
const SHOW_MS = 10_000;

export function UndoToast({ activity, onClose }) {
  const reduce = useReducedMotion();
  const [state, setState] = useState('idle'); // idle | undoing | done | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activity) return;
    setState('idle');
    setError(null);
    const t = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(t);
  }, [activity, onClose]);

  async function undo() {
    setState('undoing');
    try {
      await api(`/me/activity/${activity.id}/undo`, { method: 'POST' });
      setState('done');
      setTimeout(onClose, 1200);
    } catch (err) {
      setState('error');
      setError(err.message);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-50 flex justify-center px-4 lg:bottom-8">
      <AnimatePresence>
        {activity && (
          <motion.div
            key={activity.id}
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass pointer-events-auto relative flex max-w-md items-center gap-3 overflow-hidden rounded-full bg-ink/80 py-2 pl-5 pr-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              {state === 'done' ? 'Wapas pehle jaisa kar diya' : state === 'error' ? error : activity.summary}
            </span>
            {state !== 'done' && state !== 'error' && (
              <button onClick={undo} disabled={state === 'undoing'} className="btn-ghost shrink-0 !py-1.5 text-gold">
                <Undo2 size={15} /> {state === 'undoing' ? 'Undo ho raha hai' : 'Undo'}
              </button>
            )}
            {!reduce && state === 'idle' && (
              <motion.span
                aria-hidden
                className="absolute bottom-0 left-0 h-0.5 bg-gold/60"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: SHOW_MS / 1000, ease: 'linear' }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
