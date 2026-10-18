import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, LogOut } from 'lucide-react';
import { api } from '../lib/api.js';
import { useChat } from '../hooks/useChat.js';
import { useLiveEvents } from '../hooks/useLiveEvents.js';
import { Face } from '../components/Face.jsx';
import { ChatPanel } from '../components/ChatPanel.jsx';
import { TodayPanel } from '../components/TodayPanel.jsx';
import { Toasts } from '../components/Toasts.jsx';

// Home: Saathi's face and a fresh greeting on top, the chat in the middle, the Today panel on the
// right (on phones, Chat and Aaj are two tabs). Live events keep everything up to date.
export function HomeScreen({ user, onLogout }) {
  const chat = useChat();
  const [greeting, setGreeting] = useState(null);
  const [today, setToday] = useState(null);
  const [todayError, setTodayError] = useState(null);
  const [toasts, setToasts] = useState([]);
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

  // Many changes can arrive at once (a study plan is 15 changes): refresh the panel once for all.
  const refreshTimer = useRef(null);
  const refreshSoon = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(loadToday, 300);
  }, [loadToday]);

  const live = useLiveEvents({
    changed: refreshSoon,
    notification: (n) => {
      setToasts((all) => [n, ...all.filter((t) => t.id !== n.id)].slice(0, 3));
      refreshSoon();
      if (n.kind === 'nudge' || n.kind === 'recap') chat.reload();
      // The tab is in the background: a system notification too, if the user allowed it.
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(n.title, { body: n.body || undefined, icon: '/favicon.svg', tag: n.id });
      }
    },
  });

  const faceState = chat.face.state;
  const expression = chat.sending || chat.messages.length ? chat.face.expression : (greeting?.expression ?? 'happy');

  return (
    <div className="ambient flex h-full flex-col">
      <TopBar user={user} live={live} onLogout={onLogout} />

      <div className="flex min-h-0 flex-1">
        <main className={`min-h-0 flex-1 flex-col ${tab === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
          <Hero user={user} greeting={greeting} expression={expression} state={faceState} compact={chat.messages.length > 0} />
          <ChatPanel chat={chat} />
        </main>
        {/* The Today panel floats as a soft glass sheet over the sky, not a hard column. */}
        <aside className={`min-h-0 w-full px-3 pb-3 lg:w-[380px] lg:py-2 lg:pl-0 lg:pr-6 ${tab === 'today' ? 'block' : 'hidden lg:block'}`}>
          <div className="glass h-full overflow-hidden rounded-3xl">
            <TodayPanel today={today} error={todayError} onRetry={loadToday} onChanged={loadToday} />
          </div>
        </aside>
      </div>

      <MobileTabs tab={tab} setTab={setTab} badge={today?.counts?.overdue} />
      <Toasts items={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} onChanged={loadToday} />
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
          <Face size={faceSize} expression={expression} state={state} aura={!compact} />
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
                className={`font-display font-semibold tracking-tight text-balance ${compact ? 'line-clamp-1 text-lg text-muted' : 'text-2xl sm:text-3xl'}`}
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

function TopBar({ user, live, onLogout }) {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  return (
    <header className="flex items-center justify-between px-4 pb-1 pt-[max(env(safe-area-inset-top),12px)] sm:px-8">
      <div className="flex items-center gap-2">
        <span className="font-display text-lg font-semibold tracking-tight">Saathi</span>
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors ${live === 'live' ? 'bg-leaf' : 'bg-faint'}`}
          title={live === 'live' ? 'Live: updates turant aayenge' : 'Dobara jud raha hai...'}
        />
      </div>
      <div className="flex items-center gap-1">
        {perm === 'default' && (
          <button
            onClick={() => Notification.requestPermission().then(setPerm)}
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm text-faint transition-colors hover:bg-surface hover:text-text"
          >
            <Bell size={16} />
            <span className="hidden sm:inline">Alerts on karo</span>
          </button>
        )}
        <span className="hidden px-2 text-sm text-faint sm:inline">{user.name}</span>
        <button
          onClick={onLogout}
          aria-label="Logout"
          title="Logout"
          className="grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-text"
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

function MobileTabs({ tab, setTab, badge }) {
  return (
    <nav className="grid grid-cols-2 border-t border-line bg-ink/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Screens">
      {[
        ['chat', 'Chat'],
        ['today', 'Aaj'],
      ].map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={`relative py-3 font-display font-semibold transition-colors ${tab === id ? 'text-text' : 'text-faint'}`}>
          {label}
          {id === 'today' && badge > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-2 rounded-full bg-vermilion" aria-label={`${badge} pending`} />}
          {tab === id && <motion.span layoutId="tab-line" className="absolute inset-x-12 top-0 h-0.5 rounded-full bg-gold" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
        </button>
      ))}
    </nav>
  );
}
