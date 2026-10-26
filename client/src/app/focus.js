import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// The focus timer, shared by every screen: the small bar at the top, the big view, the start
// dialog and the task rows all use useFocus(). The server keeps the real times; this hook only
// shows them, corrected for the difference between this device's clock and the server's.

export const FocusContext = createContext(null);
export const useFocus = () => useContext(FocusContext);

export function useFocusState() {
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState(null); // null | 'big' | 'start'
  const [startFor, setStartFor] = useState(null); // { taskId?, label? } for the start dialog
  const [celebration, setCelebration] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0); // server time minus device time

  const apply = useCallback((f) => {
    if (f?.serverNow) skew.current = new Date(f.serverNow).getTime() - Date.now();
    setFocus(f ?? null);
  }, []);

  const load = useCallback(() => api('/focus/current').then((r) => apply(r.focus)).catch(() => {}), [apply]);

  // On open, when the tab comes back, and once a minute (another device may have changed it).
  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(load, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [load]);

  // One tick a second while a timer is running.
  useEffect(() => {
    if (focus?.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [focus?.status]);

  const remainingMs =
    focus?.status === 'running' ? Math.max(0, new Date(focus.endsAt).getTime() - (now + skew.current)) : (focus?.remainingMs ?? 0);
  const timeUp = focus?.status === 'timeup' || (focus?.status === 'running' && remainingMs === 0);

  const call = useCallback(
    async (path, body) => {
      const r = await api(path, { method: 'POST', body });
      if ('focus' in r) apply(r.focus);
      return r;
    },
    [apply],
  );

  const actions = useMemo(
    () => ({
      openStart: (target = null) => {
        setStartFor(target);
        setView('start');
      },
      openBig: () => setView('big'),
      close: () => setView(null),
      start: async ({ minutes, taskId, label }) => {
        const r = await call('/focus', { minutes, ...(taskId && { taskId }), ...(label && { label }) });
        setView('big');
        return r;
      },
      pause: () => call(`/focus/${focus.id}/pause`),
      resume: () => call(`/focus/${focus.id}/resume`),
      extend: (minutes = 5) => call(`/focus/${focus.id}/extend`, { minutes }),
      cancel: async () => {
        await call(`/focus/${focus.id}/cancel`);
        setFocus(null);
        setView(null);
      },
      /** Ends it with the celebration (the AI line replaces the local one when it arrives). */
      finish: async (name) => {
        const ended = focus;
        setCelebration({ label: ended.label, focusedMs: ended.focusedMs + (ended.status === 'running' ? ended.remainingMs - remainingMs : 0), message: null, name });
        setView('big');
        const r = await api(`/focus/${ended.id}/finish`, { method: 'POST', body: { done: true } });
        setFocus(null);
        setCelebration((c) => c && { ...c, focusedMs: r.focus.focusedMs, message: r.message, label: r.focus.label });
        return r;
      },
      endCelebration: () => {
        setCelebration(null);
        setView(null);
      },
      reload: load,
    }),
    [call, focus, load, remainingMs],
  );

  return { focus, view, startFor, celebration, remainingMs, timeUp, ...actions };
}

/** 2:05:09 or 25:00, for the timer display. */
export function clockText(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** "2 ghante 5 min" / "45 min", for how long someone focused. */
export function spokenLength(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  if (!h) return `${m} min`;
  return `${h} ghanta${h > 1 ? 'e' : ''}${m % 60 ? ` ${m % 60} min` : ''}`.replace('ghantae', 'ghante');
}
