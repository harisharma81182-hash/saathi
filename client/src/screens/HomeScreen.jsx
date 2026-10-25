import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../lib/api.js';
import { useChat } from '../hooks/useChat.js';
import { useLiveRefresh } from '../app/live.js';
import { HeroFace } from '../components/HeroFace.jsx';
import { useVoice } from '../hooks/useVoice.js';
import { ChatPanel } from '../components/ChatPanel.jsx';
import { TodayPanel } from '../components/TodayPanel.jsx';

// Home: Saathi's face and a fresh greeting on top, the chat in the middle, the Today panel on the
// right (on phones, Chat and Aaj switch with a small toggle). The app shell (app/AppShell.jsx) owns
// the navigation, the live-updates stream and the toasts; this screen just refreshes when told.
export function HomeScreen({ user }) {
  const chat = useChat();
  const [greeting, setGreeting] = useState(null);
  const [today, setToday] = useState(null);
  const [todayError, setTodayError] = useState(null);
  const [tab, setTab] = useState('chat');

  useEffect(() => {
    api('/agent/greeting')
      .then(setGreeting)
      .catch(() => setGreeting({ text: null, expression: 'happy' }));
  }, []);

  const loadToday = useCallback(() => {
    api('/me/today')
      .then((t) => {
        setToday(t);
        setTodayError(null);
      })
      .catch(setTodayError);
  }, []);
  useEffect(loadToday, [loadToday]);

  // Something changed anywhere (Saathi, another tab, a reminder firing): refresh the panel. When
  // Saathi wrote first (a nudge or the evening recap), its message also appears in the chat.
  useLiveRefresh(loadToday);
  useLiveRefresh(chat.reload, { on: 'notify' });

  // Mic and speaker in the chat box (hooks/useVoice.js); while either is busy, the face shows it.
  const voice = useVoice(chat);
  const faceState = voice.phase !== 'idle' ? voice.phase : chat.face.state;
  const expression = chat.sending || chat.messages.length ? chat.face.expression : (greeting?.expression ?? 'happy');

  return (
    <div className="flex h-full flex-col">
      <PhoneToggle tab={tab} setTab={setTab} badge={today?.counts?.overdue} />
      <div className="flex min-h-0 flex-1">
        <main className={`min-h-0 flex-1 flex-col ${tab === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
          <Hero user={user} greeting={greeting} expression={expression} state={faceState} compact={chat.messages.length > 0} />
          <ChatPanel chat={{ ...chat, send: voice.send }} voice={voice} />
        </main>
        {/* The Today panel floats as a soft glass sheet over the sky, not a hard column. */}
        <aside className={`min-h-0 w-full px-3 pb-3 lg:w-[380px] lg:py-2 lg:pl-0 lg:pr-6 ${tab === 'today' ? 'block' : 'hidden lg:block'}`}>
          <div className="glass h-full overflow-hidden rounded-3xl">
            <TodayPanel today={today} error={todayError} onRetry={loadToday} onChanged={loadToday} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** True on phone-sized screens; the hero face is smaller there. */
function useSmallScreen() {
  const query = '(max-width: 639px)';
  const [small, setSmall] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setSmall(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return small;
}

function Hero({ user, greeting, expression, state, compact }) {
  const text = greeting?.text;
  const small = useSmallScreen();
  const faceSize = compact ? 48 : small ? 104 : 148;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <motion.div layout transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className={`px-4 sm:px-8 ${compact ? 'pb-2 pt-2' : 'pb-6 pt-8 sm:pb-8 sm:pt-16'}`}>
      <div className={`mx-auto flex w-full max-w-2xl items-center ${compact ? 'gap-4' : 'gap-6 sm:gap-10'}`}>
        <motion.div layout className="relative">
          <HeroFace size={faceSize} expression={expression} state={state} aura={!compact} />
        </motion.div>
        <div className="min-w-0 flex-1">
          {!compact && <p className="mb-1.5 text-sm text-faint">{today}</p>}
          <AnimatePresence mode="wait">
            {greeting ? (
              <motion.h1
                key="greeting"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className={`font-display font-semibold tracking-tight text-balance ${compact ? 'line-clamp-1 text-lg text-muted' : 'text-xl sm:text-3xl'}`}
              >
                {text ?? `Hi ${user.name}, aaj kya karna hai?`}
              </motion.h1>
            ) : (
              <motion.div key="skeleton" exit={{ opacity: 0 }} className="flex flex-col gap-2" aria-label="Saathi greeting likh raha hai">
                <div className="skeleton h-7 w-4/5" />
                <div className="skeleton h-7 w-1/2" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/** Phones only: switch between the chat and today's panel. */
function PhoneToggle({ tab, setTab, badge }) {
  return (
    <div className="flex justify-center px-4 pb-1 lg:hidden">
      <div className="grid grid-cols-2 rounded-full bg-surface p-1" role="tablist" aria-label="Home">
        {[
          ['chat', 'Chat'],
          ['today', 'Aaj'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`relative rounded-full px-6 py-1.5 text-sm font-semibold transition-colors ${tab === id ? 'text-text' : 'text-faint'}`}
          >
            {tab === id && <motion.span layoutId="home-toggle" className="absolute inset-0 rounded-full bg-surface-2" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
            <span className="relative">
              {label}
              {id === 'today' && badge > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-1.5 rounded-full bg-vermilion" aria-label={`${badge} pending`} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
