import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { photoUrl } from '../lib/photos.js';

// Page transition: when the page changes (landing, login, the app), a star-trails photo flashes
// over the screen for a moment and pulls back, like a short jump through space. The photo is
// fetched once the first page is shown, so the first flash is not empty. Off with reduced motion.

export function WarpFlash({ routeKey }) {
  const reduce = useReducedMotion();
  const first = useRef(true);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    const img = new Image();
    img.src = photoUrl('startrails', window.matchMedia('(max-width: 640px)').matches ? 'phone' : 'desktop');
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) return;
    setFlash((n) => n + 1);
    const t = setTimeout(() => setFlash(0), 900);
    return () => clearTimeout(t);
  }, [routeKey, reduce]);

  return (
    <AnimatePresence>
      {flash > 0 && (
        <motion.div
          key={flash}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.55, 0], transition: { duration: 0.85, times: [0, 0.35, 1], ease: 'easeOut' } }}
          exit={{ opacity: 0 }}
        >
          <picture>
            <source media="(max-width: 640px)" srcSet={photoUrl('startrails', 'phone')} />
            <motion.img
              src={photoUrl('startrails', 'desktop')}
              alt=""
              className="h-full w-full object-cover"
              initial={{ scale: 1.25 }}
              animate={{ scale: 1, transition: { duration: 0.85, ease: [0.22, 1, 0.36, 1] } }}
            />
          </picture>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
