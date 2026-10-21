import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { photoUrl } from '../lib/photos.js';

// Page transition: when the page changes (landing, login, the app), a star-trails photo flashes
// over the screen for a moment and pulls back, like a short jump through space. The photo is
// fetched once the first page is shown, so the first flash is not empty. Off with reduced motion.
// A CSS animation (index.css), not a JS one: while the old page unmounts (the landing page frees
// its 3D scene) the browser may paint no frames for a moment; the flash is removed only when its
// animation has really played (animationend), never by a timer that could beat it.

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
    if (!reduce) setFlash((n) => n + 1);
  }, [routeKey, reduce]);

  if (!flash) return null;
  return (
    <div
      key={flash}
      aria-hidden
      onAnimationEnd={(e) => e.target === e.currentTarget && setFlash(0)}
      className="warp-flash pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      <picture>
        <source media="(max-width: 640px)" srcSet={photoUrl('startrails', 'phone')} />
        <img src={photoUrl('startrails', 'desktop')} alt="" className="warp-zoom h-full w-full object-cover" />
      </picture>
    </div>
  );
}
