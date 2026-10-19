import { Component, lazy, Suspense, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Face, HUES } from './Face.jsx';

// The big face on Home: the 3D orb (React Three Fiber) when the device can do it, otherwise the 2D
// SVG face with the same expressions. The 3D code is downloaded only here, and while it loads (or
// if WebGL fails) the 2D face is shown, so there is never an empty space.
const Face3D = lazy(() => import('./Face3D.jsx'));

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // give the test context back at once
    return Boolean(gl);
  } catch {
    return false;
  }
}

class Fallback extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn('3D face could not start, using the 2D face:', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function HeroFace({ expression = 'happy', state = 'idle', size = 148, aura = true }) {
  const reduce = useReducedMotion();
  const [use3D] = useState(() => !reduce && webglAvailable());
  const flat = <Face size={size} expression={expression} state={state} />;
  const mood = state === 'listening' || state === 'error' ? state : state === 'thinking' ? 'thinking' : expression;
  const hue = (HUES[mood] ?? HUES.happy)[1];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* The wide soft light around the orb, breathing slowly (pure CSS, costs nothing). */}
      {aura && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{ inset: -size * 0.75, filter: `blur(${size * 0.22}px)` }}
          animate={{ background: `radial-gradient(circle, ${hue}5c 0%, ${hue}22 38%, ${hue}00 68%)`, scale: reduce ? 1 : [1, 1.07, 1] }}
          transition={{ background: { duration: 0.8 }, scale: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
        />
      )}
      {use3D ? (
        <Fallback fallback={flat}>
          <Suspense fallback={flat}>
            <Face3D size={size} expression={expression} state={state} />
          </Suspense>
        </Fallback>
      ) : (
        flat
      )}
    </div>
  );
}
