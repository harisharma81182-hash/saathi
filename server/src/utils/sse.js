// Server-Sent Events: one HTTP response that stays open while the server writes small events into it.
// The browser reads them with EventSource (or fetch). Each event is "event: name\ndata: {json}\n\n".

/**
 * Turns `res` into an event stream. Returns `send(event, data)` and `close()`.
 * A comment line every 15 s keeps proxies and load balancers from closing a quiet connection.
 */
export function openSse(res, { heartbeatMs = 15_000 } = {}) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // ask proxies not to hold the stream back
  });
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, heartbeatMs);
  const close = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };
  res.on('close', () => clearInterval(heartbeat));
  return { send, close };
}
