import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// "Continue with Google" on login and signup. The button itself is drawn by Google's own script
// (Google Identity Services), so it follows Google's branding rules exactly: the official "G" logo,
// colours and wording. We only choose the dark pill style that fits Saathi's night sky.
// After the person picks an account, Google hands us a signed ID token, which the server checks.
// If the server has no Google client id, or Google's script cannot load (offline, blocked),
// nothing is shown and email + password work as before.

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let configPromise = null;
let scriptPromise = null;
let initializedFor = null;
// The latest handler, so Google's one-time callback always reaches the screen that is open now.
let onCredential = () => {};

function loadConfig() {
  configPromise ??= api('/auth/config').catch(() => ({ googleClientId: null }));
  return configPromise;
}

function loadScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('no gsi')));
    s.onerror = () => {
      scriptPromise = null; // let a later visit try again
      reject(new Error('gsi script failed'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function GoogleButton({ mode, onAuthed }) {
  const box = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  onCredential = async ({ credential }) => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api('/auth/google', {
        method: 'POST',
        body: { credential, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      onAuthed(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { googleClientId } = await loadConfig();
      if (!googleClientId || cancelled) return;
      let gsi;
      try {
        gsi = await loadScript();
      } catch {
        return; // no button; the email form is right below
      }
      if (cancelled || !box.current) return;
      if (initializedFor !== googleClientId) {
        gsi.initialize({ client_id: googleClientId, callback: (r) => onCredential(r), ux_mode: 'popup', itp_support: true });
        initializedFor = googleClientId;
      }
      box.current.replaceChildren();
      gsi.renderButton(box.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: mode === 'signup' ? 'signup_with' : 'continue_with',
        logo_alignment: 'center',
        width: Math.min(400, Math.max(200, box.current.offsetWidth || 320)),
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    // Before the button is drawn it takes no space but keeps its width (Google needs it to size the button).
    <div className={ready ? 'mb-5' : 'pointer-events-none h-0 overflow-hidden opacity-0'} aria-hidden={!ready}>
      <div ref={box} className={`flex h-11 w-full justify-center transition-opacity ${busy ? 'pointer-events-none opacity-50' : ''}`} aria-busy={busy} />
      {error && (
        <p role="alert" className="mt-2 border-l-2 border-vermilion/60 pl-3 text-sm text-text">
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-3 text-xs text-faint" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        ya email se
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
