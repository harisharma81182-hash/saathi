import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
        <aside className={`min-h-0 w-full border-line lg:w-[380px] lg:border-l ${tab === 'today' ? 'block' : 'hidden lg:block'}`}>
          <TodayPanel today={today} error={todayError} onRetry={loadToday} onChanged={loadToday} />
        </aside>
      </div>

      <MobileTabs tab={tab} setTab={setTab} badge={today?.counts?.overdue} />
      <Toasts items={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} onChanged={loadToday} />
    </div>
  );
}

function Hero({ user, greeting, expression, state, compact }) {
  const text = greeting?.text;
  return (
    <motion.div layout className={`flex items-center gap-4 px-4 sm:px-6 ${compact ? 'py-3' : 'py-6 sm:py-8'}`}>
      <div className="mx-auto flex w-full max-w-2xl items-center gap-4 sm:gap-6">
        <motion.div layout>
          <Face size={compact ? 64 : 112} expression={expression} state={state} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            {greeting ? (
              <motion.h1
                key="greeting"
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`font-display font-bold leading-tight tracking-tight ${compact ? 'line-clamp-2 text-lg sm:text-xl' : 'text-2xl sm:text-4xl'}`}
              >
                {text ?? `Hi ${user.name}!`}
              </motion.h1>
            ) : (
              <motion.div key="skeleton" exit={{ opacity: 0 }} className="flex flex-col gap-2">
                <div className="skeleton h-8 w-4/5" />
                <div className="skeleton h-8 w-1/2" />
              </motion.div>
            )}
          </AnimatePresence>
          {!compact && (
            <p className="mt-2 text-sm text-faint">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function TopBar({ user, live, onLogout }) {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  return (
    <header className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),10px)] pb-2 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="font-display text-xl font-bold tracking-tight">Saathi</span>
        <span
          className={`h-2 w-2 rounded-full ${live === 'live' ? 'bg-leaf' : 'bg-faint'}`}
          title={live === 'live' ? 'Live: updates turant aayenge' : 'Reconnect ho raha hai...'}
        />
      </div>
      <div className="flex items-center gap-1 text-sm">
        {perm === 'default' && (
          <button onClick={() => Notification.requestPermission().then(setPerm)} className="rounded-full px-3 py-1.5 text-muted hover:bg-surface hover:text-text">
            Notifications on karo
          </button>
        )}
        <span className="hidden px-2 text-faint sm:inline">{user.name}</span>
        <button onClick={onLogout} className="rounded-full px-3 py-1.5 text-muted hover:bg-surface hover:text-text">
          Logout
        </button>
      </div>
    </header>
  );
}

function MobileTabs({ tab, setTab, badge }) {
  return (
    <nav className="grid grid-cols-2 border-t border-line bg-ink pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Sections">
      {[
        ['chat', 'Chat'],
        ['today', 'Aaj'],
      ].map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={`relative py-3 font-display font-semibold ${tab === id ? 'text-gold' : 'text-muted'}`}>
          {label}
          {id === 'today' && badge > 0 && <span className="ml-1.5 rounded-full bg-vermilion px-1.5 text-xs text-ink">{badge}</span>}
          {tab === id && <motion.span layoutId="tab-line" className="absolute inset-x-10 top-0 h-0.5 rounded-full bg-gold" />}
        </button>
      ))}
    </nav>
  );
}
