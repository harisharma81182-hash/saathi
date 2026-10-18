import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { Face } from './Face.jsx';
import { ConfirmCard, ReceiptSlip, ToolActivity, TypingDots } from './ChatParts.jsx';

const QUICK_ACTIONS = [
  { label: 'Study plan', text: 'Exam aa raha hai, study plan bana do' },
  { label: 'Plan my day', text: 'Aaj ka din plan kar do' },
  { label: 'Reminder', text: 'Kal subah 9 baje yaad dila dena ' },
  { label: 'Aaj kya hai?', text: 'Aaj kya kya karna hai?' },
];

export function ChatPanel({ chat }) {
  const { messages, loading, loadError, sending, send, undoReceipt, answerConfirm, reload } = chat;
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const reduce = useReducedMotion();

  // Follow new messages only if the user is already at the bottom; otherwise offer a button.
  const onScroll = () => {
    const el = scroller.current;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setUnseen(false);
  };
  const toBottom = (smooth = true) => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };
  const last = messages.at(-1);
  useLayoutEffect(() => {
    if (atBottom) toBottom(messages.length > 0);
    else setUnseen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, last?.text, last?.receipts?.length, last?.confirms?.length]);
  useEffect(() => {
    toBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const submit = (text = draft) => {
    if (!text.trim() || sending) return;
    send(text);
    setDraft('');
    setAtBottom(true);
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Chat with Saathi">
      <div ref={scroller} onScroll={onScroll} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6" aria-live="polite">
        {loading && <ChatSkeleton />}
        {loadError && (
          <div className="mx-auto mt-10 max-w-sm text-center text-muted">
            <p>{loadError.message}</p>
            <button onClick={reload} className="mt-3 rounded-full border border-line px-4 py-1.5 text-sm text-text hover:border-gold/50">
              Dobara load karo
            </button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && <EmptyChat onPick={(t) => setDraft(t)} />}
        <ol className="mx-auto flex max-w-2xl flex-col gap-5 pt-2">
          {messages.map((m, i) => (
            <Message
              key={m.id}
              m={m}
              showTime={i === 0 || new Date(m.createdAt) - new Date(messages[i - 1].createdAt) > 30 * 60_000}
              onUndo={(rid) => undoReceipt(m.id, rid)}
              onAnswer={(aid, answer) => answerConfirm(m.id, aid, answer)}
              onRetry={() => submit(messages[i - 1]?.text ?? '')}
            />
          ))}
        </ol>
      </div>

      <AnimatePresence>
        {unseen && !atBottom && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => toBottom()}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-1.5 text-sm text-text shadow-lg shadow-black/40"
          >
            Naye messages ↓
          </motion.button>
        )}
      </AnimatePresence>

      <Composer draft={draft} setDraft={setDraft} sending={sending} onSubmit={submit} showQuick={messages.length > 0} />
    </section>
  );
}

function Message({ m, showTime, onUndo, onAnswer, onRetry }) {
  const mine = m.role === 'user';
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
    >
      {showTime && <time className="mb-2 self-center text-xs text-faint">{when(m.createdAt)}</time>}
      {mine ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5">{m.text}</p>
      ) : (
        <div className="flex max-w-[92%] gap-3">
          <Face size={30} expression={m.expression ?? 'happy'} state={m.streaming && !m.text ? 'thinking' : 'idle'} followCursor={false} />
          <div className="min-w-0 flex-1 pt-0.5">
            {m.origin && <p className="mb-0.5 text-xs text-gold/80">{m.origin === 'recap' ? 'Aaj ka hisaab' : 'Saathi ne yaad kiya'}</p>}
            {m.text ? <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p> : m.streaming && !m.tools?.length ? <TypingDots /> : null}
            <ToolActivity tools={m.tools ?? []} />
            {m.receipts?.map((r) => (
              <ReceiptSlip key={r.id} receipt={r} onUndo={() => onUndo(r.id)} />
            ))}
            {m.confirms?.map((c) => (
              <ConfirmCard key={c.id} confirm={c} onAnswer={(a) => onAnswer(c.id, a)} />
            ))}
            {m.error && (
              <div role="alert" className="mt-2 rounded-xl bg-vermilion/10 px-3 py-2 text-sm text-text">
                {m.error.message}
                {m.error.code !== 'AI_DAILY_LIMIT' && (
                  <button onClick={onRetry} className="ml-2 font-semibold text-gold hover:underline">
                    Dobara bhejo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.li>
  );
}

function Composer({ draft, setDraft, sending, onSubmit, showQuick }) {
  const area = useRef(null);
  const [hints, setHints] = useState([]);

  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = area.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // "Guide while typing": open tasks related to what is being typed (no AI call, instant).
  useEffect(() => {
    const q = draft.trim();
    if (q.length < 3) return setHints([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api(`/me/hints?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => setHints(r.matches.slice(0, 3)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draft]);

  return (
    <div className="border-t border-line bg-ink/80 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-2xl">
        <AnimatePresence>
          {hints.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Pehle se hai:</span>
              {hints.map((h) => (
                <span key={h.id} className="rounded-full bg-surface px-2.5 py-1 text-text">
                  {h.title}
                  {h.dueAt && <span className="text-faint"> · {when(h.dueAt)}</span>}
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {showQuick && !draft && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {QUICK_ACTIONS.map((q) => (
              <button key={q.label} onClick={() => setDraft(q.text)} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-gold/40 hover:text-text">
                {q.label}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-end gap-2 rounded-3xl border border-line bg-surface p-1.5 pl-4 focus-within:border-gold/40"
        >
          <label htmlFor="chat-input" className="sr-only">
            Saathi ko likho
          </label>
          <textarea
            id="chat-input"
            ref={area}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Saathi ko kuch bhi bolo..."
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-text outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Bhejo"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-ink transition hover:brightness-110 disabled:bg-surface-2 disabled:text-faint"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function EmptyChat({ onPick }) {
  return (
    <div className="mx-auto mt-6 max-w-md text-center">
      <p className="text-muted">Kuch bhi bolo, Saathi kaam kar dega. Shuruaat ke liye:</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-left">
        {QUICK_ACTIONS.map((q) => (
          <button key={q.label} onClick={() => onPick(q.text)} className="rounded-2xl border border-line bg-surface p-3 transition hover:border-gold/40">
            <span className="font-display text-base font-semibold">{q.label}</span>
            <span className="mt-0.5 block text-xs text-faint">{q.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pt-4" aria-label="Loading chat">
      <div className="skeleton ml-auto h-10 w-2/5" />
      <div className="flex gap-3">
        <div className="skeleton h-8 w-8 rounded-full" />
        <div className="skeleton h-16 flex-1" />
      </div>
      <div className="skeleton ml-auto h-10 w-1/3" />
    </div>
  );
}
