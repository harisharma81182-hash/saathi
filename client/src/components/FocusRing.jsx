import { useId } from 'react';
import { useReducedMotion } from 'motion/react';

// The focus timer as a "cosmic clock": Saathi's face is the sun in the middle, the golden arc is
// an orbit that empties as time passes, and a small glowing planet rides its end with a comet
// trail. Around it: hour numbers 12, 1 ... 11 like a clock, a small star at each hour, brighter
// "planet dots" at 12, 3, 6 and 9, faint minute ticks, a second faint orbit for depth and two tiny
// far planets drifting slowly (index.css .far-orbit). `fraction` = time left / total, 0..1.
// detail="mini" is the small version for the sticky bar: just the orbit, the arc and the planet.
// With reduced motion nothing moves except the arc itself (once a second, no easing).

const TAU = Math.PI * 2;
const at = (cx, r, angle) => ({ x: cx + r * Math.cos(angle), y: cx + r * Math.sin(angle) });
// Clock angle: 0 at 12 o'clock, going clockwise.
const clock = (turn) => -Math.PI / 2 + TAU * turn;

export function FocusRing({ size = 280, stroke = 10, fraction = 1, glow = true, detail = 'full', children, flash = false }) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const full = detail === 'full';
  const cx = size / 2;
  // Small, faint hour numbers sit OUTSIDE the orbit (full); the mini version only needs room for the planet's glow.
  const fontSize = Math.max(10, Math.round(size / 28));
  const r = full ? cx - stroke / 2 - fontSize * 2 - 6 : cx - stroke / 2 - 2;
  const c = TAU * r;
  const f = Math.max(0, Math.min(1, fraction));
  const ease = reduce ? 'none' : '1s linear';
  const numberR = r + stroke / 2 + fontSize + 3;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} overflow="visible" className={`absolute inset-0 overflow-visible ${flash ? 'ring-flash' : ''}`} aria-hidden>
        <defs>
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFE3A8" />
            <stop offset="0.5" stopColor="#F2A541" />
            <stop offset="1" stopColor="#C46A1C" />
          </linearGradient>
          <radialGradient id={`${uid}-p`}>
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.45" stopColor="#FFE3A8" />
            <stop offset="1" stopColor="#F2A541" />
          </radialGradient>
          <filter id={`${uid}-glow`} filterUnits="userSpaceOnUse" x={-size} y={-size} width={size * 3} height={size * 3}>
            <feGaussianBlur stdDeviation={Math.max(1.5, stroke * 0.8)} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {full && (
          <>
            {/* two tiny far planets on wide, tilted orbits: barely there, just depth */}
            <g opacity="0.55">
              <circle cx={cx} cy={cx} r={cx + 30} fill="none" stroke="rgb(226 232 255 / 0.05)" />
              <g className={reduce ? '' : 'far-orbit'} style={{ transformBox: 'view-box', transformOrigin: `${cx}px ${cx}px`, animationDuration: '70s' }}>
                <circle cx={cx + cx + 30} cy={cx} r="2.6" fill="#6C8CFF" opacity="0.7" />
              </g>
              <g className={reduce ? '' : 'far-orbit far-orbit-reverse'} style={{ transformBox: 'view-box', transformOrigin: `${cx}px ${cx}px`, animationDuration: '110s' }}>
                <circle cx={cx} cy={-22} r="1.8" fill="#E879B9" opacity="0.6" />
              </g>
            </g>
            {/* tiny stars between the hour numbers, outside the orbit */}
            {Array.from({ length: 12 }, (_, i) => {
              const p = at(cx, numberR, clock((i + 0.5) / 12));
              return <circle key={i} cx={p.x} cy={p.y} r={i % 2 ? 0.9 : 1.3} fill="rgb(255 243 220 / 0.5)" />;
            })}
          </>
        )}

        {/* the orbit track */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgb(255 227 168 / 0.16)" strokeWidth="1" />

        {full && (
          <>
            {/* minute ticks, faint, just inside the orbit */}
            {Array.from({ length: 60 }, (_, i) => {
              if (i % 5 === 0) return null;
              const a = clock(i / 60);
              const p1 = at(cx, r - stroke / 2 - 4, a);
              const p2 = at(cx, r - stroke / 2 - 7, a);
              return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgb(255 248 235 / 0.16)" strokeWidth="1" strokeLinecap="round" />;
            })}
            {/* hour numbers like a clock, small and faint, outside the orbit */}
            {Array.from({ length: 12 }, (_, i) => {
              const p = at(cx, numberR, clock(i / 12));
              const quarter = i % 3 === 0;
              return (
                <text
                  key={i}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="'Baloo 2', sans-serif"
                  fontWeight={quarter ? 600 : 500}
                  fontSize={fontSize}
                  fill={quarter ? 'rgb(255 227 168 / 0.7)' : 'rgb(245 239 230 / 0.38)'}
                >
                  {i === 0 ? 12 : i}
                </text>
              );
            })}
          </>
        )}

        {/* the time left: a golden arc from 12 o'clock */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={`url(#${uid}-g)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${cx} ${cx})`}
          filter={glow ? `url(#${uid}-glow)` : undefined}
          style={{ transition: `stroke-dashoffset ${ease}` }}
        />

        {full &&
          /* a small star at every hour; brighter planet dots at 12, 3, 6 and 9 (on top of the arc) */
          Array.from({ length: 12 }, (_, i) => {
            const p = at(cx, r, clock(i / 12));
            return i % 3 === 0 ? (
              <circle key={i} cx={p.x} cy={p.y} r={Math.max(2.6, stroke * 0.3)} fill="#FFF6E4" filter={glow ? `url(#${uid}-glow)` : undefined} />
            ) : (
              <circle key={i} cx={p.x} cy={p.y} r="1.3" fill="rgb(255 248 235 / 0.75)" />
            );
          })}

        {/* the time planet with a comet trail behind it (where it came from) */}
        {/* Drawn at 12 o'clock and turned into place, so any change (+5 min, resume) slides
            along the orbit instead of cutting across it. */}
        {f > 0.001 && (
          <g style={{ transformBox: 'view-box', transformOrigin: `${cx}px ${cx}px`, transform: `rotate(${f * 360}deg)`, transition: `transform ${ease}` }}>
            {full &&
              Array.from({ length: 9 }, (_, i) => {
                const t = (i + 1) / 9;
                const p = at(cx, r, clock(0) + t * 0.32);
                return <circle key={i} cx={p.x} cy={p.y} r={stroke * 0.42 * (1 - t * 0.85)} fill="#FFE3A8" opacity={0.55 * (1 - t)} />;
              })}
            <circle cx={cx} cy={cx - r} r={full ? stroke * 0.8 : Math.max(2.4, stroke * 0.85)} fill={`url(#${uid}-p)`} filter={glow ? `url(#${uid}-glow)` : undefined} />
          </g>
        )}
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}
