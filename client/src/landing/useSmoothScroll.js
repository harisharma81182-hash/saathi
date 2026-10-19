import { useEffect, useRef } from 'react';
import Lenis from 'lenis';

/**
 * Buttery smooth page scrolling (Lenis) while the landing page is open. Off for people who asked
 * for reduced motion: they get the browser's normal scrolling. Returns scrollTo(target), which
 * smooth-jumps to an element or a y position (and jumps instantly without Lenis).
 */
export function useSmoothScroll() {
  const lenis = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const instance = new Lenis({ autoRaf: true, lerp: 0.09, smoothWheel: true });
    lenis.current = instance;
    return () => {
      instance.destroy();
      lenis.current = null;
    };
  }, []);

  return (target, { offset = 0 } = {}) => {
    const y = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY;
    if (lenis.current) lenis.current.scrollTo(y + offset, { duration: 1.4 });
    else window.scrollTo({ top: y + offset });
  };
}
