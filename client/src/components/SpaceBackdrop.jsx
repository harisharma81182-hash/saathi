import { useState } from 'react';
import { photoUrl } from '../lib/photos.js';

// A real space photo behind a screen. The phone gets its own small portrait file, the laptop the
// wide one (the browser downloads only the one it needs, and only when this screen is shown).
// The photo fades in once loaded, drifts in a very slow zoom (off with reduced motion), and sits
// under a dark gradient so text and glass panels on top stay easy to read.
// `strength` is how dark the overlay is: 'strong' for screens full of text, 'soft' for sparse ones.

export function SpaceBackdrop({ photo, strength = 'strong', position = 'center', className = 'fixed' }) {
  const [loaded, setLoaded] = useState(false);
  if (!photo) return null;
  return (
    <div aria-hidden className={`pointer-events-none inset-0 -z-10 overflow-hidden ${className}`}>
      <picture>
        <source media="(max-width: 640px)" srcSet={photoUrl(photo, 'phone')} type="image/webp" />
        <img
          src={photoUrl(photo, 'desktop')}
          alt=""
          decoding="async"
          fetchPriority="low"
          onLoad={() => setLoaded(true)}
          style={{ objectPosition: position }}
          className={`space-photo h-full w-full object-cover transition-opacity duration-[1400ms] ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </picture>
      <div className={`absolute inset-0 ${strength === 'soft' ? 'space-veil-soft' : 'space-veil'}`} />
    </div>
  );
}
