import { useEffect, useRef } from 'react';

// A very soft warm light that follows the cursor over the night sky, as if Saathi's glow reached
// toward you. Desktop only (fine pointer), off with reduced motion. It moves with a CSS transform in
// one requestAnimationFrame per mouse move, so it never re-renders React.
export function CursorGlow() {
  const ref = useRef(null);
  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const onMove = (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (ref.current) {
            ref.current.style.opacity = '1';
            ref.current.style.transform = `translate3d(${x - 300}px, ${y - 300}px, 0)`;
          }
        });
    };
    const onLeave = () => ref.current && (ref.current.style.opacity = '0');
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 -z-10 h-[600px] w-[600px] rounded-full opacity-0 transition-opacity duration-500"
      style={{ background: 'radial-gradient(circle, rgb(242 165 65 / 0.07) 0%, rgb(242 165 65 / 0.025) 35%, transparent 65%)' }}
    />
  );
}
