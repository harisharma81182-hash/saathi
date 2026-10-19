import { useRef } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';

// The features as a 3D accordion: five glass panels folded in a zig-zag, in perspective. While the
// section scrolls past (it is several screens tall, the stage stays pinned), the fold opens one
// panel at a time: the panel in the middle turns flat to face you, its neighbours stay folded
// away. CSS 3D transforms driven by scroll; no WebGL, so it costs almost nothing.
//
// With "reduce motion" the panels are simply shown flat, one under another.

const FOCUS_START = 0.04;
const FOCUS_END = 0.96;

/** The page scroll position at which panel `index` faces the viewer (for the nav's smooth jump). */
export function foldScrollY(section, index, count) {
  const top = section.getBoundingClientRect().top + window.scrollY;
  const range = section.offsetHeight - window.innerHeight;
  if (range <= 0 || count < 2) return top; // reduced motion: panels are just stacked
  const progress = FOCUS_START + ((FOCUS_END - FOCUS_START) * index) / (count - 1);
  return top + progress * range;
}

export function FeatureFold({ features, onActiveChange, sectionRef }) {
  const reduce = useReducedMotion();
  const local = useRef(null);
  const ref = sectionRef ?? local;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const count = features.length;
  // Which panel faces the viewer, as a number (2.4 = between the third and the fourth).
  const focus = useTransform(scrollYProgress, [FOCUS_START, FOCUS_END], [0, count - 1], { clamp: true });
  useMotionValueEvent(focus, 'change', (v) => onActiveChange?.(Math.round(v)));

  if (reduce) {
    return (
      <section ref={ref} className="mx-auto grid max-w-5xl gap-6 px-4 py-24 sm:grid-cols-2 sm:px-8">
        {features.map((f) => (
          <div key={f.id} id={f.id}>
            <Panel feature={f} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section ref={ref} className="relative" style={{ height: `${count * 90 + 30}vh` }} aria-label="Saathi kya kya karta hai">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden [perspective:1600px]">
        <div className="relative mx-auto h-[min(66svh,540px)] w-full [transform-style:preserve-3d]">
          {features.map((f, i) => (
            <FoldPanel key={f.id} feature={f} index={i} focus={focus} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FoldPanel({ feature, index, focus }) {
  // d = how far this panel is from the one facing the viewer (0 = it is the one).
  const d = useTransform(focus, (f) => index - f);
  const near = (v) => Math.min(Math.abs(v), 2);
  // Neighbours fold the opposite way of each other: that is what makes it read as an accordion.
  const side = index % 2 === 0 ? 1 : -1;
  const rotateY = useTransform(d, (v) => side * Math.min(Math.abs(v), 1.15) * 62);
  // Folded neighbours sit just beside the open panel (a folded panel is narrower), never on top of it.
  const x = useTransform(d, (v) => `calc(-50% + ${v * (100 - 16 * Math.min(Math.abs(v), 1))}%)`);
  const z = useTransform(d, (v) => -near(v) * 160);
  const opacity = useTransform(d, (v) => 1 - near(v) * 0.38);
  const brightness = useTransform(d, (v) => `brightness(${1 - near(v) * 0.3})`);

  return (
    <motion.div
      className="absolute left-1/2 top-0 h-full w-[min(84vw,460px)] [transform-style:preserve-3d]"
      style={{ x, z, rotateY, opacity, filter: brightness }}
    >
      <Panel feature={feature} />
    </motion.div>
  );
}

function Panel({ feature }) {
  return (
    <article className="glass flex h-full flex-col overflow-hidden rounded-[28px] bg-ink-2/85 p-6 sm:p-8">
      <header>
        <p className="flex items-center gap-2 text-sm text-faint">
          <span className="h-2 w-2 rounded-full" style={{ background: feature.color, boxShadow: `0 0 12px ${feature.color}` }} />
          {feature.name}
        </p>
        <h3 className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{feature.title}</h3>
        <p className="mt-2 text-muted">{feature.text}</p>
      </header>
      <div className="mt-auto pt-6">{feature.snippet}</div>
    </article>
  );
}
