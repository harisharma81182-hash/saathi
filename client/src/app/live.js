import { createContext, useContext, useEffect, useRef } from 'react';

// Live updates shared by every screen. The app shell keeps ONE /api/me/events stream open and
// counts what arrives; a screen asks to be refreshed when something changed:
//
//   useLiveRefresh(load)                   reload after any change (debounced: a study plan is 15 changes)
//   useLiveRefresh(load, { on: 'notify' }) reload when Saathi sends something (nudge, recap)

export const LiveContext = createContext({ changes: 0, notices: 0, status: 'connecting' });

export function useLive() {
  return useContext(LiveContext);
}

export function useLiveRefresh(load, { on = 'change', delayMs = 300 } = {}) {
  const live = useLive();
  const count = on === 'notify' ? live.notices : live.changes;
  const first = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (first.current) {
      first.current = false; // the screen loads itself on mount; only refresh on later changes
      return;
    }
    const t = setTimeout(() => loadRef.current(), delayMs);
    return () => clearTimeout(t);
  }, [count, delayMs]);
}
