import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamChat } from '../lib/api.js';

// The chat with Saathi: loads the ongoing conversation, sends messages and builds Saathi's reply
// live from the streamed events (text, face, receipts for every change, Confirm/Cancel requests).

function fromSaved(m) {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    expression: m.expression,
    status: m.status,
    origin: m.origin,
    createdAt: m.createdAt,
    receipts: (m.toolCalls ?? [])
      .filter((t) => t.ok && t.summary && t.activityIds.length)
      .map((t, i) => ({ id: `${m.id}-${i}`, summary: t.summary, activityIds: t.activityIds })),
    confirms: [],
    tools: [],
  };
}

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [face, setFace] = useState({ state: 'idle', expression: 'happy' });
  const conversationId = useRef(null);
  const abort = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { conversations } = await api('/agent/conversations');
      const latest = conversations[0];
      if (latest) {
        conversationId.current = latest.id;
        const { messages: rows } = await api(`/agent/conversations/${latest.id}/messages?limit=50`);
        setMessages(rows.map(fromSaved));
        const lastSaathi = [...rows].reverse().find((m) => m.role === 'assistant');
        if (lastSaathi?.expression) setFace((f) => ({ ...f, expression: lastSaathi.expression }));
      }
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, [load]);

  // Update the reply being written (the last message).
  const patchReply = (fn) => setMessages((all) => all.map((m, i) => (i === all.length - 1 && m.role === 'assistant' ? fn(m) : m)));

  /**
   * Sends a message and streams Saathi's reply into the chat. Resolves with the finished reply
   * ({ text, expression, error }) so voice mode can read it aloud; null if nothing was sent.
   * voice: true tells the server the reply will be spoken (short, no lists or emoji).
   */
  const send = useCallback(async (text, { voice = false } = {}) => {
    const message = text.trim();
    if (!message || abort.current) return null;
    const reply = { text: '', expression: null, error: null };
    const now = new Date().toISOString();
    setMessages((all) => [
      ...all,
      { id: `local-${now}`, role: 'user', text: message, createdAt: now },
      { id: `reply-${now}`, role: 'assistant', text: '', expression: null, streaming: true, receipts: [], confirms: [], tools: [], createdAt: now },
    ]);
    setSending(true);
    setFace((f) => ({ ...f, state: 'thinking' }));
    abort.current = new AbortController();

    try {
      await streamChat({
        message,
        conversationId: conversationId.current,
        voice,
        signal: abort.current.signal,
        onEvent(event, data) {
          switch (event) {
            case 'start':
              conversationId.current = data.conversationId;
              break;
            case 'expression':
              reply.expression = data.expression;
              setFace((f) => ({ ...f, expression: data.expression }));
              patchReply((m) => ({ ...m, expression: data.expression }));
              break;
            case 'text':
              setFace((f) => ({ ...f, state: 'speaking' }));
              reply.text += data.delta;
              patchReply((m) => ({ ...m, text: m.text + data.delta }));
              break;
            case 'reset':
              reply.text = data.text;
              patchReply((m) => ({ ...m, text: data.text }));
              break;
            case 'tool':
              setFace((f) => ({ ...f, state: 'thinking' }));
              patchReply((m) => ({ ...m, tools: [...m.tools.filter((t) => t.id !== data.id), data] }));
              break;
            case 'receipt':
              patchReply((m) => ({ ...m, receipts: [...m.receipts, { id: data.id, summary: data.summary, activityIds: data.activities.map((a) => a.id) }] }));
              break;
            case 'confirm':
              patchReply((m) => ({ ...m, confirms: [...m.confirms, { ...data, status: 'pending' }] }));
              break;
            case 'error':
              reply.error = data;
              setFace({ state: 'idle', expression: 'sorry' });
              patchReply((m) => ({ ...m, error: data }));
              break;
            case 'done':
              reply.text = data.message.text || reply.text;
              reply.expression = data.message.expression ?? reply.expression;
              patchReply((m) => ({ ...m, id: data.message.id, text: data.message.text || m.text, expression: data.message.expression, streaming: false, tools: [] }));
              break;
          }
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        reply.error = { code: err.code, message: err.message };
        patchReply((m) => ({ ...m, streaming: false, tools: [], error: reply.error }));
      }
      setFace({ state: 'idle', expression: 'sorry' });
    } finally {
      abort.current = null;
      setSending(false);
      setFace((f) => ({ ...f, state: 'idle' }));
      patchReply((m) => ({ ...m, streaming: false }));
    }
    return reply;
  }, []);

  /** Undo every change one receipt made (newest first). */
  const undoReceipt = useCallback(async (messageId, receiptId) => {
    const msg = messagesRef.current.find((m) => m.id === messageId);
    const receipt = msg?.receipts.find((r) => r.id === receiptId);
    if (!receipt) return;
    const set = (patch) =>
      setMessages((all) => all.map((m) => (m.id === messageId ? { ...m, receipts: m.receipts.map((r) => (r.id === receiptId ? { ...r, ...patch } : r)) } : m)));
    set({ undoing: true, undoError: null });
    try {
      for (const id of [...receipt.activityIds].reverse()) await api(`/me/activity/${id}/undo`, { method: 'POST' });
      set({ undoing: false, undone: true });
    } catch (err) {
      set({ undoing: false, undoError: err.message });
    }
  }, []);

  /** Confirm or cancel something Saathi proposed (deleting a task). */
  const answerConfirm = useCallback(async (messageId, actionId, answer) => {
    const set = (patch) =>
      setMessages((all) => all.map((m) => (m.id === messageId ? { ...m, confirms: m.confirms.map((c) => (c.id === actionId ? { ...c, ...patch } : c)) } : m)));
    set({ busy: true, error: null });
    try {
      await api(`/agent/actions/${actionId}/${answer}`, { method: 'POST' });
      set({ busy: false, status: answer === 'confirm' ? 'confirmed' : 'cancelled' });
    } catch (err) {
      set({ busy: false, error: err.message });
    }
  }, []);

  // A message Saathi started by itself (nudge, recap) arrived live: reload to show it.
  return { messages, loading, loadError, sending, face, send, undoReceipt, answerConfirm, reload: load };
}
