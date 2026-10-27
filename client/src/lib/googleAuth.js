// "Continue with Google" with our own button: a full-page trip to Google's official sign-in page
// (OpenID Connect, response_type=id_token) and back. Google returns a signed ID token in the URL
// #fragment (never sent to any server log); the server checks its signature, audience and nonce.
//   state: a random value we remember in this tab; the answer must carry it back (blocks forged returns)
//   nonce: a random value Google puts inside the signed token; the server checks it (blocks replays)

const KEY = 'saathi.google';

function random() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

/** Goes to Google's sign-in page. The address must be listed in Google Cloud as a redirect URI. */
export function startGoogleSignIn(clientId, mode) {
  const state = random();
  const nonce = random();
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ state, nonce, mode }));
  } catch {
    // Without storage the return cannot be checked; the answer below will say so.
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${location.origin}/`,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/**
 * On page load: if we just came back from Google, read the answer once and clean the address bar.
 * Returns null (not a Google return), { credential, nonce } or { error }.
 */
export function readGoogleReturn() {
  const hash = location.hash.slice(1);
  if (!/(^|&)(id_token|error)=/.test(hash)) return null;
  const params = new URLSearchParams(hash);
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  const mode = saved?.mode === 'signup' ? 'signup' : 'login';
  history.replaceState(null, '', `${location.pathname}#${mode}`);
  if (params.get('error')) {
    return { mode, error: params.get('error') === 'access_denied' ? 'Google sign-in beech mein band ho gaya. Phir se try karo.' : 'Google sign-in nahi ho paaya. Phir se try karo.' };
  }
  if (!saved || params.get('state') !== saved.state) {
    return { mode, error: 'Yeh Google sign-in purana tha. Phir se "Continue with Google" dabao.' };
  }
  return { mode, credential: params.get('id_token'), nonce: saved.nonce };
}

// An error from the return trip, shown once under the Google button.
let pendingError = null;
export const setGoogleError = (message) => {
  pendingError = message;
};
export function takeGoogleError() {
  const e = pendingError;
  pendingError = null;
  return e;
}
