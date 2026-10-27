import { api } from './api.js';

// Notifications on this device (Web Push). There is no setting and no button: after login, the
// browser's permission prompt is shown on the user's first tap anywhere in the app (browsers only
// allow asking during a tap or key press). Once allowed, the device is registered with the server
// on every visit, so it stays registered. If the user says no, notifications still reach them in
// the app and, for important ones, by email.

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
/** iPhone Safari can only receive push after "Add to Home Screen". */
export const needsHomeScreen = () => isIos() && !isStandalone();

function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : isIos() ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Registers this device with the server (when notifications are allowed). Never throws. */
async function subscribe() {
  try {
    const { publicKey } = await api('/push/key');
    if (!publicKey) return; // push not set up on this server: in-app and email still work
    const registration = await navigator.serviceWorker.ready;
    const key = urlBase64ToUint8Array(publicKey);
    let sub = await registration.pushManager.getSubscription();
    // A subscription made with another server key (keys were changed) must be replaced.
    const sameKey = sub && sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
    if (sub && !sameKey) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON();
    await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys, device: deviceName() } });
  } catch (err) {
    console.warn('Saathi: this device could not be registered for notifications', err);
  }
}

/**
 * Before logout: forget this device on the server and in the browser, so a shared computer (a
 * college lab) stops getting the previous user's reminders. The next login registers it again.
 * Never throws and never takes more than a few seconds.
 */
export async function forgetThisDevice() {
  if (!supported()) return;
  const work = (async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  })().catch(() => {});
  await Promise.race([work, new Promise((r) => setTimeout(r, 3000))]);
}

/**
 * Called once after login: registers the service worker, keeps an existing permission's device
 * registered, and otherwise asks on the first tap. Returns a cleanup function.
 */
export function setupPush() {
  if (!supported()) return () => {};
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (Notification.permission === 'granted') {
    subscribe();
    return () => {};
  }
  if (Notification.permission === 'denied' || needsHomeScreen()) return () => {};

  const ask = () => {
    remove();
    // Called straight from the tap, as browsers require.
    Notification.requestPermission().then((result) => result === 'granted' && subscribe());
  };
  const remove = () => {
    window.removeEventListener('click', ask, true);
    window.removeEventListener('keydown', ask, true);
  };
  window.addEventListener('click', ask, true);
  window.addEventListener('keydown', ask, true);
  return remove;
}
