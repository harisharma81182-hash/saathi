import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
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
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pointer-events-auto w-full max-w-sm rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl shadow-black/50 backdrop-blur"
    >
      <div className="flex gap-3">
        <Face size={36} expression={n.expression ?? (n.kind === 'nudge' ? 'concerned' : 'happy')} followCursor={false} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold leading-tight">{n.title}</p>
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
              <Btn onClick={onDismiss}>Theek hai</Btn>
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
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${primary ? 'bg-gold text-ink hover:brightness-110' : 'bg-surface-2 text-text hover:bg-line'}`}
    />
  );
}
