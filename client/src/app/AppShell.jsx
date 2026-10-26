import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, BellRing, CheckSquare, LogOut, MessageCircle, NotebookPen, Settings, Timer } from 'lucide-react';
import { useLiveEvents } from '../hooks/useLiveEvents.js';
import { LiveContext } from './live.js';
import { Toasts } from '../components/Toasts.jsx';
import { UndoToast } from '../components/UndoToast.jsx';
import { CursorGlow } from '../components/CursorGlow.jsx';
import { SpaceBackdrop } from '../components/SpaceBackdrop.jsx';
import { I18nProvider, useI18n } from '../lib/i18n.js';
import { setupPush } from '../lib/push.js';
import { IosGuide } from '../components/IosGuide.jsx';
import { FocusContext, useFocus, useFocusState } from './focus.js';
import { FocusBar } from '../components/FocusBar.jsx';
import { FocusView } from '../components/FocusView.jsx';
import { FocusStart } from '../components/FocusStart.jsx';
import { chime } from '../lib/chime.js';
import { HomeScreen } from '../screens/HomeScreen.jsx';
import { TasksScreen } from '../screens/TasksScreen.jsx';
import { NotesScreen } from '../screens/NotesScreen.jsx';
import { RemindersScreen } from '../screens/RemindersScreen.jsx';
import { ActivityScreen } from '../screens/ActivityScreen.jsx';
import { SettingsScreen } from '../screens/SettingsScreen.jsx';

// The frame around every screen after login: navigation (top bar on desktop, bottom bar on phones),
// the one live-updates stream, notification toasts, and the 10-second Undo toast after a change.
// Screens are picked by the URL hash (#/tasks, #/notes ...), so the browser's Back button works.
// Labels come from lib/i18n.js in the language picked in Settings.

export const SCREENS = [
  { id: 'home', label: 'Saathi', icon: MessageCircle },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'reminders', label: 'Reminders', icon: BellRing },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'activity', label: 'Activity', icon: Activity },
];
const ALL = [...SCREENS.map((s) => s.id), 'settings'];

// The space photo behind each screen (lib/photos.js has the credits). Reminders gets the black hole:
// it is mostly black, so it sits under the lighter veil and stays visible above the list.
const BACKDROPS = { home: 'westerlund2', tasks: 'antennae', reminders: 'blackhole', notes: 'am0500', activity: 'andromeda', settings: 'carina' };
const SOFT_VEIL = ['notes', 'reminders'];

const screenFromHash = () => {
  const id = location.hash.replace(/^#\/?/, '');
  return ALL.includes(id) ? id : 'home'; // "#focus" (from a timer notification) opens Home + the timer
};

export function AppShell({ user: initialUser, onLogout }) {
  const [screen, setScreen] = useState(screenFromHash);
  const [user, setUser] = useState(initialUser);
  const [counts, setCounts] = useState({ changes: 0, notices: 0 });
  const [toasts, setToasts] = useState([]);
  const [undo, setUndo] = useState(null);
  const focus = useFocusState();
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Opened from a timer notification (#focus): show the big timer.
  useEffect(() => {
    if (location.hash === '#focus') {
      focusRef.current.openBig();
      history.replaceState(null, '', location.pathname);
    }
  }, []);

  // The timer ran out while Saathi is open: a soft chime and the big view asking "Ho gaya?".
  const wasTimeUp = useRef(false);
  useEffect(() => {
    if (focus.timeUp && !wasTimeUp.current) {
      if (document.visibilityState === 'visible') chime();
      focusRef.current.openBig();
    }
    wasTimeUp.current = focus.timeUp;
  }, [focus.timeUp]);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id) => {
    location.hash = id === 'home' ? '' : `/${id}`;
    setScreen(id);
  }, []);

  // Notifications on this device: always on, the browser asks on the first tap (lib/push.js).
  useEffect(() => setupPush(), []);

  const status = useLiveEvents({
    changed: (a) => {
      setCounts((c) => ({ ...c, changes: c.changes + 1 }));
      // Your own change (not Saathi's: those show receipts in the chat) gets 10 seconds of Undo.
      if (a.undoneAt) setUndo((u) => (u?.id === a.id ? null : u));
      else if (a.actor === 'user' && a.canUndo) setUndo(a);
    },
    notification: (n) => {
      setCounts((c) => ({ changes: c.changes + 1, notices: c.notices + 1 }));
      // The timer's own notification: the big timer view says it already (no second card).
      if (n.kind === 'timer') {
        focusRef.current.reload();
        return;
      }
      // In the app: a card. Outside it (tab in the background or closed): the push from the server.
      setToasts((all) => [n, ...all.filter((t) => t.id !== n.id)].slice(0, 3));
    },
  });

  const live = { ...counts, status };
  const props = { user, go };
  return (
    <I18nProvider language={user.language}>
      <FocusContext.Provider value={focus}>
        <LiveContext.Provider value={live}>
          <div className="ambient flex h-full flex-col">
            <AnimatePresence initial={false}>
              <motion.div
                key={BACKDROPS[screen] ?? 'none'}
                className="pointer-events-none absolute inset-0 -z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.9 } }}
                exit={{ opacity: 0, transition: { duration: 0.6 } }}
              >
                <SpaceBackdrop photo={BACKDROPS[screen]} className="absolute" strength={SOFT_VEIL.includes(screen) ? 'soft' : 'strong'} />
              </motion.div>
            </AnimatePresence>
            <CursorGlow />
            <TopBar screen={screen} go={go} user={user} live={status} onLogout={onLogout} />
            <FocusBar />
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
            <Toasts items={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} onChanged={() => setCounts((c) => ({ ...c, changes: c.changes + 1 }))} go={go} />
            <IosGuide />
            <UndoToast activity={undo} onClose={() => setUndo(null)} />
            <FocusView user={user} />
            <FocusStart />
          </div>
        </LiveContext.Provider>
      </FocusContext.Provider>
    </I18nProvider>
  );
}

/** Timer in the top bar: start one, or open the running one. */
function FocusButton() {
  const f = useFocus();
  const label = f.focus ? 'Timer dekho' : 'Timer lagao';
  return (
    <button
      onClick={() => (f.focus ? f.openBig() : f.openStart())}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-colors hover:bg-surface ${f.focus ? 'text-gold' : 'text-faint hover:text-text'}`}
    >
      <Timer size={17} />
      <span className="hidden sm:inline">{f.focus ? 'Focus' : 'Timer'}</span>
    </button>
  );
}

function TopBar({ screen, go, user, live, onLogout }) {
  const { t } = useI18n();
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
            <span className="relative">{t(`nav.${s.id}`)}</span>
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-1">
        <FocusButton />
        <button
          onClick={() => go('settings')}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
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
  const { t } = useI18n();
  return (
    <nav className="relative z-20 grid grid-cols-5 border-t border-line bg-ink/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Screens">
      {SCREENS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          onClick={() => go(id)}
          aria-current={screen === id ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-1 py-2.5 text-xs transition-colors active:scale-95 ${screen === id ? 'text-text' : 'text-faint'}`}
        >
          {screen === id && <motion.span layoutId="bottom-nav" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-gold" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
          <Icon size={19} strokeWidth={screen === id ? 2.2 : 1.8} />
          {t(`nav.${id}`)}
        </button>
      ))}
    </nav>
  );
}
