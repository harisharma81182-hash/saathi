import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Bell, BellRing, CheckSquare, LogOut, MessageCircle, NotebookPen, Settings } from 'lucide-react';
import { useLiveEvents } from '../hooks/useLiveEvents.js';
import { LiveContext } from './live.js';
import { Toasts } from '../components/Toasts.jsx';
import { UndoToast } from '../components/UndoToast.jsx';
import { CursorGlow } from '../components/CursorGlow.jsx';
import { HomeScreen } from '../screens/HomeScreen.jsx';
import { TasksScreen } from '../screens/TasksScreen.jsx';
import { NotesScreen } from '../screens/NotesScreen.jsx';
import { RemindersScreen } from '../screens/RemindersScreen.jsx';
import { ActivityScreen } from '../screens/ActivityScreen.jsx';
import { SettingsScreen } from '../screens/SettingsScreen.jsx';

// The frame around every screen after login: navigation (top bar on desktop, bottom bar on phones),
// the one live-updates stream, notification toasts, and the 10-second Undo toast after a change.
// Screens are picked by the URL hash (#/tasks, #/notes ...), so the browser's Back button works.

export const SCREENS = [
  { id: 'home', label: 'Saathi', icon: MessageCircle },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'reminders', label: 'Reminders', icon: BellRing },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'activity', label: 'Activity', icon: Activity },
];
const ALL = [...SCREENS.map((s) => s.id), 'settings'];

const screenFromHash = () => {
  const id = location.hash.replace(/^#\/?/, '');
  return ALL.includes(id) ? id : 'home';
};

export function AppShell({ user: initialUser, onLogout }) {
  const [screen, setScreen] = useState(screenFromHash);
  const [user, setUser] = useState(initialUser);
  const [counts, setCounts] = useState({ changes: 0, notices: 0 });
  const [toasts, setToasts] = useState([]);
  const [undo, setUndo] = useState(null);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id) => {
    location.hash = id === 'home' ? '' : `/${id}`;
    setScreen(id);
  }, []);

  const status = useLiveEvents({
    changed: (a) => {
      setCounts((c) => ({ ...c, changes: c.changes + 1 }));
      // Your own change (not Saathi's: those show receipts in the chat) gets 10 seconds of Undo.
      if (a.undoneAt) setUndo((u) => (u?.id === a.id ? null : u));
      else if (a.actor === 'user' && a.canUndo) setUndo(a);
    },
    notification: (n) => {
      setCounts((c) => ({ changes: c.changes + 1, notices: c.notices + 1 }));
      setToasts((all) => [n, ...all.filter((t) => t.id !== n.id)].slice(0, 3));
      // The tab is in the background: a system notification too, if the user allowed it.
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(n.title, { body: n.body || undefined, icon: '/favicon.svg', tag: n.id });
      }
    },
  });

  const live = { ...counts, status };
  const props = { user, go };
  return (
    <LiveContext.Provider value={live}>
      <div className="ambient flex h-full flex-col">
        <CursorGlow />
        <TopBar screen={screen} go={go} user={user} live={status} onLogout={onLogout} />
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {screen === 'home' && <HomeScreen {...props} />}
              {screen === 'tasks' && <TasksScreen {...props} />}
              {screen === 'notes' && <NotesScreen {...props} />}
              {screen === 'reminders' && <RemindersScreen {...props} />}
              {screen === 'activity' && <ActivityScreen {...props} />}
              {screen === 'settings' && <SettingsScreen {...props} onUserChange={setUser} onLogout={onLogout} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <BottomNav screen={screen} go={go} />
        <Toasts items={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} onChanged={() => setCounts((c) => ({ ...c, changes: c.changes + 1 }))} />
        <UndoToast activity={undo} onClose={() => setUndo(null)} />
      </div>
    </LiveContext.Provider>
  );
}

function TopBar({ screen, go, user, live, onLogout }) {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  return (
    <header className="relative z-20 flex items-center justify-between gap-4 px-4 pb-1 pt-[max(env(safe-area-inset-top),12px)] sm:px-8">
      <button onClick={() => go('home')} className="flex items-center gap-2 rounded-lg" aria-label="Saathi, Home">
        <span className="font-display text-lg font-semibold tracking-tight">Saathi</span>
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors ${live === 'live' ? 'bg-leaf' : 'bg-faint'}`}
          title={live === 'live' ? 'Live: updates turant aayenge' : 'Dobara jud raha hai...'}
        />
      </button>

      <nav aria-label="Screens" className="hidden items-center gap-1 lg:flex">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            aria-current={screen === s.id ? 'page' : undefined}
            className={`relative rounded-full px-3.5 py-1.5 text-sm transition-colors ${screen === s.id ? 'text-text' : 'text-faint hover:text-text'}`}
          >
            {screen === s.id && <motion.span layoutId="top-nav" className="absolute inset-0 rounded-full bg-surface-2" transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />}
            <span className="relative">{s.label}</span>
          </button>
        ))}
      </nav>

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
        <button
          onClick={() => go('settings')}
          aria-label="Settings"
          title="Settings"
          aria-current={screen === 'settings' ? 'page' : undefined}
          className={`inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-3 text-sm transition-colors hover:bg-surface ${screen === 'settings' ? 'bg-surface-2 text-text' : 'text-faint hover:text-text'}`}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 font-display text-sm font-semibold text-text">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="hidden sm:inline">{user.name}</span>
          <Settings size={15} className="sm:hidden" />
        </button>
        <button onClick={onLogout} aria-label="Logout" title="Logout" className="grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-text">
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

function BottomNav({ screen, go }) {
  return (
    <nav className="relative z-20 grid grid-cols-5 border-t border-line bg-ink/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Screens">
      {SCREENS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => go(id)}
          aria-current={screen === id ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-1 py-2.5 text-xs transition-colors active:scale-95 ${screen === id ? 'text-text' : 'text-faint'}`}
        >
          {screen === id && <motion.span layoutId="bottom-nav" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-gold" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
          <Icon size={19} strokeWidth={screen === id ? 2.2 : 1.8} />
          {label}
        </button>
      ))}
    </nav>
  );
}
