// Small wrapper around fetch for the Saathi API. The login lives in an httpOnly cookie, so requests
// only need `credentials: 'include'`; the page never sees the token.
//
// Every API error has the same shape ({ error: { code, message } }), and becomes an ApiError whose
// message is already written for the user ("That time has already passed. Pick a time in the future.").

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const NETWORK_MESSAGE = "Can't reach Saathi right now. Check your internet and try again.";

export async function api(path, { method = 'GET', body, signal, headers } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Try again in a moment.', e?.details);
  }
  return data;
}

/**
 * Sends a chat message and reads Saathi's reply as it streams in (Server-Sent Events over a POST,
 * which EventSource cannot do, so the stream is read by hand). `onEvent(name, data)` is called for
 * every event: start, expression, text, reset, tool, receipt, confirm, error, done.
 */
export async function streamChat({ message, conversationId, voice = false, signal, onEvent }) {
  let res;
  try {
    res = await fetch('/api/agent/chat', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...(conversationId && { conversationId }), ...(voice && { voice }) }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Saathi could not answer. Try again.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}
