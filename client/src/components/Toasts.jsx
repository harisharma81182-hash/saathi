import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Face } from './Face.jsx';

// Live notifications (a reminder fired, a nudge, the evening recap) slide in at the top right, with
// the buttons that make sense for each: snooze a reminder, move leftovers to tomorrow.

export function Toasts({ items, onDismiss, onChanged }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-50 flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:items-end">
      <AnimatePresence>
        {items.map((n) => (
          <Toast key={n.id} n={n} onDismiss={() => onDismiss(n.id)} onChanged={onChanged} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ n, onDismiss, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function act(path, body, done) {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      setNote(done);
      onChanged();
      setTimeout(onDismiss, 1500);
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="glass pointer-events-auto relative w-full max-w-sm rounded-2xl bg-ink/80 p-4"
    >
      <button onClick={onDismiss} aria-label="Band karo" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text">
        <X size={15} />
      </button>
      <div className="flex gap-3">
        <Face size={36} expression={n.expression ?? (n.kind === 'nudge' ? 'concerned' : 'happy')} followCursor={false} />
        <div className="min-w-0 flex-1">
          <p className="pr-6 font-display font-semibold leading-tight">{n.title}</p>
          {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
          {note ? (
            <p className="mt-2 text-xs text-leaf">{note}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {n.kind === 'reminder' && n.refId && (
                <>
                  <Btn disabled={busy} onClick={() => act(`/reminders/${n.refId}/snooze`, { minutes: 10 }, '10 min baad phir yaad dilaunga')}>
                    10 min baad
                  </Btn>
                  <Btn disabled={busy} onClick={() => act(`/reminders/${n.refId}/snooze`, { minutes: 60 }, '1 ghante baad phir yaad dilaunga')}>
                    1 ghanta
                  </Btn>
                </>
              )}
              {n.kind === 'recap' && n.data?.leftovers?.length > 0 && (
                <Btn primary disabled={busy} onClick={() => act('/me/leftovers/move-to-tomorrow', undefined, 'Bache kaam kal pe shift ho gaye')}>
                  Bache kaam kal karo
                </Btn>
              )}

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
      className={`rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95 disabled:opacity-50 ${primary ? 'bg-gold text-ink hover:brightness-110' : 'bg-surface-2 text-text hover:bg-line'}`}
    />
  );
}
