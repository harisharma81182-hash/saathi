// Saathi's service worker. It lives in the browser even when Saathi's tab is closed, so it can show
// notifications that the server sends with Web Push (server/src/services/delivery.service.js).
//
//   push               show the notification (title with emoji, Saathi's icon, a space photo, buttons);
//                      skipped when Saathi is open on screen, because the app shows its own card then
//   notificationclick  a button ("Ho gaya", "10 min baad") runs on the server; anything else opens the
//                      right screen, reusing an open Saathi tab when there is one
//
// No offline caching: the app needs the server for everything, and a stale cache would only confuse.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Saathi', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const onScreen = windows.some((w) => w.visibilityState === 'visible' && w.focused);
      // Safari (iPhone) may cancel the subscription if a push shows nothing, so it always shows one.
      const ua = self.navigator.userAgent;
      const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
      if (onScreen && !safari) return; // the open app already shows this as an in-app card
      await self.registration.showNotification(data.title || 'Saathi', {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: data.badge || '/icons/badge-96.png',
        image: data.image,
        tag: data.tag,
        renotify: Boolean(data.tag),
        requireInteraction: Boolean(data.requireInteraction),
        actions: (data.actions || []).slice(0, 2),
        data: { url: data.url || '/', notificationId: data.notificationId },
      });
    })(),
  );
});

/** Opens Saathi at a path: focuses an open Saathi window if there is one. */
async function openApp(path) {
  const url = new URL(path || '/', self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
  if (existing) {
    await existing.focus();
    return existing.navigate ? existing.navigate(url) : null;
  }
  return self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const { url, notificationId } = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  if ((action === 'done' || action === 'snooze') && notificationId) {
    event.waitUntil(
      (async () => {
        try {
          const res = await fetch('/api/push/action', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notificationId, action }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const { message } = await res.json();
          // A small, quiet confirmation, so the tap clearly worked.
          await self.registration.showNotification(action === 'done' ? '✅ Saathi' : '😴 Saathi', {
            body: message || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-96.png',
            tag: 'saathi:action',
            silent: true,
          });
        } catch {
          // Logged out or offline: open the app instead, where the user can do it.
          await openApp(url);
        }
      })(),
    );
    return;
  }
  event.waitUntil(openApp(url));
});
