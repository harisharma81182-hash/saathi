import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PlusSquare, Share } from 'lucide-react';
import { needsHomeScreen } from '../lib/push.js';
import { Face } from './Face.jsx';

// iPhone only allows notifications for web apps added to the Home Screen. Shown once, on iPhones
// using Saathi inside Safari: three short steps, then it never comes back.

const KEY = 'saathi.iosGuide.seen';
const seen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function IosGuide() {
  const [open, setOpen] = useState(() => needsHomeScreen() && !seen());
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: it may show again next time */
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="iPhone par notifications"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="glass fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-50 rounded-3xl bg-ink/85 p-5 shadow-[0_12px_40px_-8px_rgb(242_165_65/0.35)]"
        >
          <div className="flex items-start gap-3">
            <Face size={44} expression="happy" followCursor={false} />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold leading-snug">iPhone par reminders ke liye Saathi ko Home Screen par daalo</p>
              <ol className="mt-3 space-y-2 text-sm text-muted">
                <li className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-text">1</span>
                  Safari mein neeche <Share size={16} className="text-gold" aria-label="Share" /> Share dabao
                </li>
                <li className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-text">2</span>
                  <PlusSquare size={16} className="text-gold" aria-hidden /> "Add to Home Screen" chuno
                </li>
                <li className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-text">3</span>
                  Home Screen se Saathi kholo, phir kahin bhi tap karke notifications allow karo
                </li>
              </ol>
              <button onClick={close} className="btn-gold mt-4">
                Samajh gaya
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
