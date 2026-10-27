import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { startGoogleSignIn, takeGoogleError } from '../lib/googleAuth.js';

// "Continue with Google" on login and signup, in Saathi's look (dark glass, a thin glowing gold
// edge, a shimmer on hover) while keeping Google's branding rules: the official four-colour "G" on a
// white circle, never recoloured, stretched or animated, and the words "Continue with Google".
// A tap goes to Google's own sign-in page (lib/googleAuth.js); the server checks the signed token.
// If the server has no Google client id, nothing is shown and email + password work as before.

let configPromise = null;
function loadConfig() {
  configPromise ??= api('/auth/config').catch(() => ({ googleClientId: null }));
  return configPromise;
}

// Google's official "G": its own four colours and shape.
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ mode }) {
  const [clientId, setClientId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(takeGoogleError);

  useEffect(() => {
    let cancelled = false;
    loadConfig().then(({ googleClientId }) => !cancelled && setClientId(googleClientId));
    // Coming back with the browser's Back button from Google's page: not busy any more.
    const onShow = () => setBusy(false);
    window.addEventListener('pageshow', onShow);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  if (!clientId) return null;
  return (
    <div className="mb-5">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          startGoogleSignIn(clientId, mode);
        }}
        className="google-btn relative flex h-12 w-full items-center justify-center gap-3 overflow-hidden rounded-full px-4 disabled:cursor-wait"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)]">
          <GoogleG />
        </span>
        {busy ? (
          <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-text" role="status">
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
            Google se jud rahe hain...
          </span>
        ) : (
          <span className="text-[15px] font-semibold tracking-wide text-text">Continue with Google</span>
        )}
        <span aria-hidden className="google-shimmer pointer-events-none" />
      </button>
      {error && (
        <p role="alert" className="mt-2 border-l-2 border-vermilion/60 pl-3 text-sm text-text">
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-3 text-xs text-faint" aria-hidden>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold/25 to-gold/45" />
        ya email se
        <span className="h-px flex-1 bg-gradient-to-l from-transparent via-gold/25 to-gold/45" />
      </div>
    </div>
  );
}
