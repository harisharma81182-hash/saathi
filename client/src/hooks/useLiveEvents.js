import { useEffect, useRef, useState } from 'react';

/**
 * Keeps the live-updates stream (/api/me/events) open while the page is open and calls
 * handlers.notification / handlers.changed as things happen. The browser's EventSource reconnects
 * by itself after a network drop; `status` says whether we are currently connected.
 */
export function useLiveEvents(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const source = new EventSource('/api/me/events', { withCredentials: true });
    const on = (name, fn) => source.addEventListener(name, (e) => fn(JSON.parse(e.data)));
    on('ready', (d) => {
      setStatus('live');
      ref.current.ready?.(d);
    });
    on('notification', (d) => ref.current.notification?.(d.notification));
    on('changed', (d) => ref.current.changed?.(d.activity));
    source.onerror = () => setStatus('reconnecting');
    return () => source.close();
  }, []);

  return status;
}
