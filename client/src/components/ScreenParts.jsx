import { motion } from 'motion/react';
import { RotateCw } from 'lucide-react';
import { Face } from './Face.jsx';
import { photoUrl } from '../lib/photos.js';

// Pieces every screen after Home is built from, so they all read as one product:
// a calm page frame with a big title, tabs, and the loading / empty / error states.

/** The page: a scroll area with a centred column, the title and one plain sentence under it. */
export function ScreenFrame({ title, description, actions, children, wide = false }) {
  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className={`mx-auto px-4 pb-28 pt-6 sm:px-8 sm:pt-10 lg:pb-16 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            {description && <p className="mt-1.5 max-w-xl text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Two or three views of the same list (Open / Completed). */
export function Tabs({ value, onChange, options, label }) {
  return (
    <div className="inline-grid auto-cols-fr grid-flow-col rounded-full bg-surface p-1" role="tablist" aria-label={label}>
      {options.map(([id, text, count]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`relative rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${value === id ? 'text-text' : 'text-faint hover:text-text'}`}
        >
          {value === id && <motion.span layoutId={`tabs-${label}`} className="absolute inset-0 rounded-full bg-surface-2" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
          <span className="relative">
            {text}
            {count > 0 && <span className="ml-1.5 text-faint tabular-nums">{count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Nothing here yet: Saathi's face in front of two galaxies (NGC 2207), one friendly line, and what to do. */
export function EmptyState({ title, text, action, expression = 'happy' }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-12 text-center">
      <PhotoHalo photo="ngc2207">
        <Face size={64} expression={expression} followCursor={false} />
      </PhotoHalo>
      <p className="mt-5 font-display text-xl font-semibold">{title}</p>
      {text && <p className="mt-1.5 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

/** A space photo melting into the page around Saathi's face (empty and error states). */
function PhotoHalo({ photo, children }) {
  return (
    <div className="relative grid h-40 w-72 max-w-full place-items-center">
      <picture aria-hidden>
        <source media="(max-width: 640px)" srcSet={photoUrl(photo, 'phone')} />
        <img
          src={photoUrl(photo, 'desktop')}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-70 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_35%,transparent_100%)]"
        />
      </picture>
      <span className="relative">{children}</span>
    </div>
  );
}

/** Loading failed: what went wrong (Saathi in front of Andromeda), and a way to try again. */
export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center py-12 text-center">
      <PhotoHalo photo="andromeda-visible">
        <Face size={56} expression="sorry" followCursor={false} />
      </PhotoHalo>
      <p className="mt-5 max-w-sm text-muted">{error?.message ?? 'Yeh load nahi ho paaya.'}</p>
      <button onClick={onRetry} className="btn-ghost mt-4 text-gold">
        <RotateCw size={15} /> Dobara load karo
      </button>
    </div>
  );
}

/** Rows of grey bars while a list loads (never a spinner). */
export function ListSkeleton({ rows = 5 }) {
  return (
    <div className="flex flex-col gap-3 py-2" aria-label="Load ho raha hai">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-5 w-5 rounded-full" />
          <div className="skeleton h-5" style={{ width: `${80 - ((i * 13) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** A small heading inside a screen ("Aaj", "Kal", "Mon 20 Oct"). */
export function GroupTitle({ children, tone = 'text-faint' }) {
  return <h2 className={`mb-1 mt-8 text-sm font-medium ${tone}`}>{children}</h2>;
}
