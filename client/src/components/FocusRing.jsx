// The timer ring: a golden arc that empties as time passes, with a small glowing "planet" riding its
// end (the orbit theme of the landing page). `fraction` = time left / total, 0..1.

export function FocusRing({ size = 280, stroke = 10, fraction = 1, glow = true, children, flash = false }) {
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const angle = -Math.PI / 2 + 2 * Math.PI * f;
  const dot = { x: size / 2 + r * Math.cos(angle), y: size / 2 + r * Math.sin(angle) };
  const id = `ring-${size}`;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={`absolute inset-0 ${flash ? 'ring-flash' : ''}`} aria-hidden>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFE3A8" />
            <stop offset="0.5" stopColor="#F2A541" />
            <stop offset="1" stopColor="#C46A1C" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={stroke * 0.8} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* the track: a faint orbit line */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" strokeDasharray="2 7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter={glow ? `url(#${id}-glow)` : undefined}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
        {f > 0.001 && <circle cx={dot.x} cy={dot.y} r={stroke * 0.75} fill="#FFF3DC" filter={glow ? `url(#${id}-glow)` : undefined} style={{ transition: 'cx 1s linear, cy 1s linear' }} />}
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}
