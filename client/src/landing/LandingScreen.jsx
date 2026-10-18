import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { createOrbitScene } from './orbitScene.js';

// The first page a visitor sees: the Saathi Orbit space scene (Saathi's gold core with its
// features as planets) with the headline and the two ways in. Loaded only before login, so the
// 3D library never weighs down the app itself.
export default function LandingScreen({ onLogin, onSignup }) {
  const stage = useRef(null);
  const labels = useRef(null);
  const [failed, setFailed] = useState(false);

  // A fresh canvas for every mount: dispose() hands the old one's GPU memory back (context loss),
  // and a lost context cannot be used again.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Saathi ka chamakta sona core, aur uske features (Tasks, Reminders, Study plan, Memory, Voice) planets ki tarah ghoomte hue');
    stage.current.appendChild(canvas);
    let scene;
    try {
      scene = createOrbitScene({ canvas, labels: labels.current });
    } catch (err) {
      console.warn('Saathi Orbit could not start, showing the plain sky instead:', err);
      setFailed(true); // no WebGL: the page still works, just without the 3D scene
    }
    return () => {
      scene?.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div className="landing fixed inset-0 overflow-hidden bg-[#05060d] text-text">
      <div ref={stage} className="absolute inset-0" hidden={failed} />
      <div ref={labels} aria-hidden className="pointer-events-none absolute inset-0" />
      {/* Darkens the edges and the bottom, so the headline stays readable over the stars. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 55%, transparent 55%, rgba(5,6,13,0.85) 100%), linear-gradient(to top, rgba(5,6,13,0.92), transparent 42%)',
        }}
      />
      {failed && <div aria-hidden className="night-sky absolute inset-0" />}

      <div className="relative flex h-full flex-col justify-between px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),16px)] sm:px-8 sm:pb-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 font-display text-xl font-semibold">
            <span aria-hidden className="h-3.5 w-3.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#ffe2a8,#f2a541_55%,#b5651d)] shadow-[0_0_18px_4px_rgba(242,165,65,0.5)]" />
            Saathi
          </div>
          <nav className="flex items-center gap-2" aria-label="Account">
            <button
              onClick={onLogin}
              className="rounded-full px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-white/8 active:scale-[0.98]"
            >
              Login
            </button>
            <button
              onClick={onSignup}
              className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink shadow-[0_0_24px_rgba(242,165,65,0.35)] transition hover:brightness-110 active:scale-[0.98]"
            >
              Shuru karo
            </button>
          </nav>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl"
        >
          <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-tight text-balance sm:text-4xl">
            Tumhara din, <span className="text-gold [text-shadow:0_0_28px_rgba(242,165,65,0.45)]">tumhare saath.</span>
          </h1>
          <p className="mt-3 max-w-md text-muted sm:text-lg">
            Tasks, reminders, study plans aur yaadein, sab ek dost ke paas. Bolo, aur Saathi kaam kar deta hai.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={onSignup}
              className="rounded-full bg-gold px-6 py-3 font-display text-lg font-semibold text-ink shadow-[0_0_32px_rgba(242,165,65,0.35)] transition hover:brightness-110 active:scale-[0.98]"
            >
              Shuru karo, free hai
            </button>
            <button onClick={onLogin} className="rounded-full px-4 py-3 text-sm font-semibold text-muted transition-colors hover:text-text">
              Pehle se account hai? Login
            </button>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
