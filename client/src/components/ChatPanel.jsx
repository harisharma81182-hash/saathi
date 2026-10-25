import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ChevronDown, Mic, RotateCw, Square, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.js';
import { when } from '../lib/format.js';
import { Face } from './Face.jsx';
import { SpaceBackdrop } from './SpaceBackdrop.jsx';
import { ConfirmCard, ReceiptSlip, ToolActivity, TypingDots } from './ChatParts.jsx';

// Things to try, shown while the chat is empty. Full sentences, so it is obvious they can be said as is.
const SUGGESTIONS = [
  '25 ko DBMS exam hai, study plan bana do',
  'Kal subah 9 baje lab file yaad dila dena',
  'Aaj ka din plan kar do',
  'Roz raat 10 baje 20 minute reading',
];

export function ChatPanel({ chat, voice }) {
  const { messages, loading, loadError, sending, send, undoReceipt, answerConfirm, reload } = chat;
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const input = useRef(null);
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
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Saathi se baat">
      <div ref={scroller} onScroll={onScroll} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8" aria-live="polite">
        {loading && <ChatSkeleton />}
        {loadError && (
          <div className="mx-auto mt-12 max-w-sm text-center">
            <p className="text-muted">{loadError.message}</p>
            <button onClick={reload} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gold hover:text-text">
              <RotateCw size={14} /> Dobara load karo
            </button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && (
          <EmptyChat
            onPick={(t) => {
              setDraft(t);
              input.current?.focus();
            }}
          />
        )}
        <ol className="mx-auto flex max-w-2xl flex-col gap-6 pt-2">
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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={() => toBottom()}
            className="glass absolute bottom-24 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/70 px-3.5 py-1.5 text-sm text-text transition hover:bg-ink/90"
          >
            Naye messages <ChevronDown size={15} />
          </motion.button>
        )}
      </AnimatePresence>

      <Composer inputRef={input} draft={draft} setDraft={setDraft} sending={sending} onSubmit={submit} voice={voice} />
    </section>
  );
}

function Message({ m, showTime, onUndo, onAnswer, onRetry }) {
  const mine = m.role === 'user';
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
    >
      {showTime && <time className="mb-3 self-center text-xs text-faint">{when(m.createdAt)}</time>}
      {mine ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-line bg-surface-2 px-4 py-2.5 backdrop-blur-md">{m.text}</p>
      ) : (
        <div className="flex max-w-[94%] gap-3">
          <Face size={28} expression={m.expression ?? 'happy'} state={m.streaming && !m.text ? 'thinking' : 'idle'} followCursor={false} />
          <div className={`min-w-0 flex-1 ${m.origin === 'recap' ? 'relative isolate overflow-hidden rounded-2xl border border-line px-4 py-3' : 'pt-0.5'}`}>
            {/* The evening recap sits on Earth at night, seen from the space station */}
            {m.origin === 'recap' && <SpaceBackdrop photo="earth-night" className="absolute" />}
            {m.origin && <p className="mb-1 text-xs text-faint">{m.origin === 'recap' ? 'Aaj ka hisaab' : 'Saathi ne khud yaad kiya'}</p>}
            {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : m.streaming && !m.tools?.length ? <TypingDots /> : null}
            <ToolActivity tools={m.tools ?? []} />
            {m.receipts?.map((r) => (
              <ReceiptSlip key={r.id} receipt={r} onUndo={() => onUndo(r.id)} />
            ))}
            {m.confirms?.map((c) => (
              <ConfirmCard key={c.id} confirm={c} onAnswer={(a) => onAnswer(c.id, a)} />
            ))}
            {m.error && (
              <div role="alert" className="mt-2 border-l-2 border-vermilion/60 pl-3 text-sm">
                <p className="text-text">{m.error.message}</p>
                {m.error.code !== 'AI_DAILY_LIMIT' && (
                  <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-gold hover:text-text">
                    <RotateCw size={12} /> Dobara bhejo
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

function Composer({ inputRef, draft, setDraft, sending, onSubmit, voice }) {
  const { t } = useI18n();
  const [hints, setHints] = useState([]);

  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft, inputRef]);

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

  const listening = voice?.phase === 'listening';
  const canSend = draft.trim() && !sending && !listening;
  return (
    <div className="px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <AnimatePresence>
          {hints.length > 0 && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-faint"
            >
              <span>Pehle se list mein:</span>
              {hints.map((h) => (
                <span key={h.id} className="text-muted">
                  {h.title}
                  {h.dueAt && <span className="text-faint"> · {when(h.dueAt)}</span>}
                </span>
              ))}
            </motion.p>
          )}
        </AnimatePresence>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="glass flex items-end gap-2 rounded-3xl p-1.5 pl-4 transition-colors focus-within:border-gold/40"
        >
          <label htmlFor="chat-input" className="sr-only">
            Saathi ko likho
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={listening ? voice.interim : draft}
            readOnly={listening}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={listening ? t('voice.listening') : t('chat.placeholder')}
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-text outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {voice?.canSpeak && (
            <button
              type="button"
              onClick={() => voice.setSpeakerOn(!voice.speakerOn)}
              aria-pressed={voice.speakerOn}
              aria-label={voice.speakerOn ? t('voice.mute') : t('voice.unmute')}
              title={voice.speakerOn ? t('voice.mute') : t('voice.unmute')}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-surface-2 active:scale-95 ${voice.speakerOn ? 'text-gold' : 'text-faint hover:text-text'}`}
            >
              {voice.speakerOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          )}
          {/* No mic button where the browser can't do speech recognition (Firefox): typing still works. */}
          {voice?.canListen && (listening || !draft.trim()) && (
            <button
              type="button"
              onClick={voice.toggleListen}
              disabled={sending}
              aria-pressed={listening}
              aria-label={listening ? t('voice.stop') : t('voice.start')}
              title={listening ? t('voice.stop') : t('voice.start')}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-40 ${listening ? 'motion-safe:animate-pulse bg-[#A77BF3] text-ink' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
            >
              {listening ? <Square size={15} fill="currentColor" /> : <Mic size={19} />}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Bhejo"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-ink transition hover:brightness-110 active:scale-95 disabled:bg-surface-2 disabled:text-faint"
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        </form>
        {voice?.notice && (
          <p role="status" className="mt-2 px-1 text-xs text-gold">
            {voice.notice}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyChat({ onPick }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto mt-4 max-w-2xl sm:mt-8">
      <p className="text-muted">{t('chat.intro')}</p>
      <p className="mt-6 text-sm text-faint">{t('chat.examples')}</p>
      <ul className="mt-2 flex flex-col">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              onClick={() => onPick(s)}
              className="group -mx-2 w-full rounded-lg px-2 py-2 text-left text-text transition-colors hover:bg-surface"
            >
              <span className="text-faint transition-colors group-hover:text-gold">“</span>
              {s}
              <span className="text-faint transition-colors group-hover:text-gold">”</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-4" aria-label="Chat load ho rahi hai">
      <div className="skeleton ml-auto h-10 w-2/5" />
      <div className="flex gap-3">
        <div className="skeleton h-7 w-7 rounded-full" />
        <div className="skeleton h-16 flex-1" />
      </div>
      <div className="skeleton ml-auto h-10 w-1/3" />
    </div>
  );
}
