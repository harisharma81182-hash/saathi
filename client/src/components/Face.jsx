import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';

// Saathi's face, 2D version: a glowing orb with eyes and a mouth, drawn in SVG and animated with
// Motion. It is the fallback for the 3D face (Step 6) and the small face next to chat replies.
//
//   expression  what the AI chose for its reply (happy, thinking, proud, ...)
//   state       what Saathi is doing: idle | thinking (waiting for the AI) | speaking (reply streaming)
//               | listening (voice) | error
//
// Eyes and mouth are closed paths with the same number of points in every expression, so Motion can
// morph smoothly between them instead of jumping.

// Orb colours by mood. All stay in Saathi's warm family (no stock purple/blue): bright gold when
// happy, a dimmer ember while thinking, a muted dusk when concerned or sorry. Violet only while
// listening in voice mode.
const HUES = {
  happy: ['#FFE6B0', '#F2A541', '#B8641A'],
  excited: ['#FFF0C2', '#FFB547', '#C8661B'],
  laughing: ['#FFF0C2', '#FFB547', '#C8661B'],
  proud: ['#FFE6B0', '#F2A541', '#A9581A'],
  surprised: ['#FFF3D1', '#FFC15E', '#C77A24'],
  thinking: ['#F1D3A0', '#B47A33', '#4E3114'],
  concerned: ['#EADFCD', '#A99173', '#4A3D2E'],
  sorry: ['#E4DCD0', '#998B79', '#433A31'],
  sleepy: ['#E9D3A8', '#B88A4A', '#5E431F'],
  listening: ['#F1D2FF', '#A77BF3', '#5A2C9C'],
  error: ['#FFD2C4', '#E4572E', '#7E2512'],
};

// Eye: a closed shape made of a top arc and a bottom arc (heights in px; negative bottom = crescent).
function eyePath(cx, cy, rx, top, bottom) {
  const k = 1.33;
  return `M ${cx - rx} ${cy} C ${cx - rx} ${cy - top * k} ${cx + rx} ${cy - top * k} ${cx + rx} ${cy} C ${cx + rx} ${cy + bottom * k} ${cx - rx} ${cy + bottom * k} ${cx - rx} ${cy} Z`;
}

// Mouth: the same idea; `top` bends the upper lip, `bottom` the lower one (positive = downwards).
function mouthPath(w, y, top, bottom) {
  return `M ${50 - w} ${y} C ${50 - w / 2} ${y + top} ${50 + w / 2} ${y + top} ${50 + w} ${y} C ${50 + w / 2} ${y + bottom} ${50 - w / 2} ${y + bottom} ${50 - w} ${y} Z`;
}

// Per expression: eye [rx, top, bottom], gaze offset, mouth [width, y, top, bottom], brow tilt.
const FACES = {
  happy: { eye: [3.4, 4.6, 4.6], mouth: [9, 60, 1.5, 7.5] },
  excited: { eye: [3.8, 5.6, 5.6], mouth: [10.5, 59, -0.5, 11] },
  laughing: { eye: [4, 4.2, -1.8], mouth: [11.5, 58.5, -1, 13] },
  proud: { eye: [4, 3.8, -1.6], mouth: [9.5, 60, 1, 8] },
  surprised: { eye: [3.9, 6, 6], mouth: [3.6, 61, -4.2, 4.2] },
  thinking: { eye: [3.3, 4.4, 4.4], gaze: [-2.6, -2.4], mouth: [5, 62, 0.6, 1.6] },
  concerned: { eye: [3.3, 4.4, 4.4], gaze: [0, 1], mouth: [7, 63, -3.2, -1], brow: 1 },
  sorry: { eye: [3.2, 3.4, 4], gaze: [0, 2], mouth: [6, 63.5, -3, -1.2], brow: 1 },
  sleepy: { eye: [3.6, 1.2, 2.6], gaze: [0, 1.5], mouth: [4, 62, 0.5, 2] },
  listening: { eye: [3.6, 5, 5], mouth: [5.5, 61, -2, 3.5] },
  error: { eye: [3.3, 4.4, 4.4], mouth: [7, 63, -3, -1], brow: 1 },
};

const SPRING = { type: 'spring', stiffness: 260, damping: 22 };

// aura: the big hero version gets a wide, soft light around it that breathes slowly (AI Common feel).
export function Face({ expression = 'happy', state = 'idle', size = 120, followCursor = true, label, aura = false }) {
  const reduce = useReducedMotion();
  const mood = state === 'listening' || state === 'error' ? state : state === 'thinking' ? 'thinking' : expression;
  const face = FACES[mood] ?? FACES.happy;
  const hue = HUES[mood] ?? HUES.happy;
  const ref = useRef(null);

  // Blinking: every 3 to 6 seconds, a quick close and open. Not while the eyes are already shut.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduce) return;
    let t;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        loop();
      }, 3000 + Math.random() * 3000);
    };
    loop();
    return () => clearTimeout(t);
  }, [reduce]);

  // Eyes follow the cursor a little when idle (springs keep it soft).
  const gx = useSpring(0, { stiffness: 120, damping: 18 });
  const gy = useSpring(0, { stiffness: 120, damping: 18 });
  useEffect(() => {
    const [fx, fy] = face.gaze ?? [0, 0];
    if (face.gaze || !followCursor || reduce || state !== 'idle') {
      gx.set(fx);
      gy.set(fy);
      return;
    }
    const onMove = (e) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
      const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
      gx.set(Math.max(-1, Math.min(1, dx * 2)) * 2.6);
      gy.set(Math.max(-1, Math.min(1, dy * 2)) * 2);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [face.gaze, followCursor, reduce, state, gx, gy]);

  // Speaking: the mouth opens and closes while the reply streams in (approximate, not lip-sync).
  const [talk, setTalk] = useState(0);
  useEffect(() => {
    if (state !== 'speaking' || reduce) return setTalk(0);
    const id = setInterval(() => setTalk(Math.random()), 120);
    return () => clearInterval(id);
  }, [state, reduce]);

  const [rx, top, bottom] = face.eye;
  const eyeTop = blink ? 0.4 : top;
  const eyeBottom = blink ? 0.4 : bottom;
  const [mw, my, mt, mb] = face.mouth;
  const mouth = state === 'speaking' ? mouthPath(mw * 0.85, my, mt - talk * 2, mb + 2 + talk * 6) : mouthPath(mw, my, mt, mb);
  const id = useRef(`f${Math.random().toString(36).slice(2, 8)}`).current;

  const floating = !reduce && state !== 'error';
  return (
    <motion.div
      ref={ref}
      role="img"
      aria-label={label ?? `Saathi looks ${mood}`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
      animate={floating ? { y: [0, -size * 0.025, 0] } : { y: 0 }}
      transition={floating ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
    >
      {aura && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{ inset: -size * 0.75, filter: `blur(${size * 0.22}px)` }}
          animate={{
            background: `radial-gradient(circle, ${hue[1]}66 0%, ${hue[1]}26 38%, ${hue[1]}00 68%)`,
            scale: reduce ? 1 : [1, 1.07, 1],
          }}
          transition={{ background: { duration: 0.8 }, scale: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
        />
      )}
      {/* Soft glow behind the orb; brighter while thinking or speaking. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        animate={{
          background: `radial-gradient(circle, ${hue[1]}55 0%, ${hue[1]}00 66%)`,
          scale: state === 'speaking' ? [1.25, 1.33, 1.25] : 1.25,
          opacity: state === 'idle' ? 0.6 : 0.85,
        }}
        transition={{ duration: reduce ? 0 : 2.4, repeat: !reduce && state === 'speaking' ? Infinity : 0, ease: 'easeInOut' }}
        style={{ filter: `blur(${size * 0.12}px)` }}
      />
      <svg viewBox="0 0 100 100" width={size} height={size} className="relative">
        <defs>
          <radialGradient id={`${id}-orb`} cx="38%" cy="32%" r="72%">
            <motion.stop offset="0%" animate={{ stopColor: hue[0] }} transition={{ duration: 0.8 }} />
            <motion.stop offset="55%" animate={{ stopColor: hue[1] }} transition={{ duration: 0.8 }} />
            <motion.stop offset="100%" animate={{ stopColor: hue[2] }} transition={{ duration: 0.8 }} />
          </radialGradient>
          {/* Light on the rim, like a glass sphere lit from inside. */}
          <radialGradient id={`${id}-rim`} cx="50%" cy="50%" r="50%">
            <stop offset="78%" stopColor="#fff" stopOpacity="0" />
            <stop offset="95%" stopColor="#fff4dc" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-shine`} cx="34%" cy="26%" r="30%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Breathing orb */}
        <motion.g
          style={{ originX: '50px', originY: '50px' }}
          animate={reduce ? {} : { scale: [1, 1.025, 1] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <circle cx="50" cy="50" r="42" fill={`url(#${id}-orb)`} />
          <circle cx="50" cy="50" r="42" fill={`url(#${id}-shine)`} />
          <circle cx="50" cy="50" r="42" fill={`url(#${id}-rim)`} />
          {/* Thinking: a slow swirl inside the orb */}
          {state === 'thinking' && !reduce && (
            <motion.circle
              cx="50"
              cy="50"
              r="30"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.12"
              strokeWidth="1.2"
              strokeDasharray="10 14"
              animate={{ rotate: 360 }}
              style={{ originX: '50px', originY: '50px' }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </motion.g>

        {/* Features */}
        <motion.g style={{ x: gx, y: gy }} fill="#2a190b">
          {face.brow && (
            <>
              <motion.path d="M 31 36 L 41 39" stroke="#2a190b" strokeWidth="2" strokeLinecap="round" initial={false} animate={{ opacity: 1 }} />
              <motion.path d="M 69 36 L 59 39" stroke="#2a190b" strokeWidth="2" strokeLinecap="round" initial={false} animate={{ opacity: 1 }} />
            </>
          )}
          <motion.path initial={false} animate={{ d: eyePath(37, 47, rx, eyeTop, eyeBottom) }} transition={blink ? { duration: 0.06 } : SPRING} />
          <motion.path initial={false} animate={{ d: eyePath(63, 47, rx, eyeTop, eyeBottom) }} transition={blink ? { duration: 0.06 } : SPRING} />
          <motion.path initial={false} animate={{ d: mouth }} transition={state === 'speaking' ? { duration: 0.1 } : SPRING} />
          {/* Rosy cheeks when happy */}
          <motion.g
            initial={false}
            animate={{ opacity: ['happy', 'excited', 'laughing', 'proud'].includes(mood) ? 0.35 : 0 }}
            fill="#ff8a5c"
          >
            <ellipse cx="28" cy="57" rx="4.5" ry="2.6" />
            <ellipse cx="72" cy="57" rx="4.5" ry="2.6" />
          </motion.g>
        </motion.g>
      </svg>
    </motion.div>
  );
}
