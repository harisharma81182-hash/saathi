import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from './lib/api.js';
import { Face } from './components/Face.jsx';
import { AuthScreen } from './screens/AuthScreen.jsx';
import { HomeScreen } from './screens/HomeScreen.jsx';

// Who is logged in decides the screen. The cookie is httpOnly, so the only way to know is to ask.
export function App() {
  const [session, setSession] = useState({ status: 'loading', user: null });

  useEffect(() => {
    api('/auth/me')
      .then(({ user }) => setSession({ status: 'in', user }))
      .catch((err) => setSession({ status: err.status === 401 ? 'out' : 'offline', user: null, error: err }));
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession({ status: 'out', user: null });
  };

  return (
    <AnimatePresence mode="wait">
      {session.status === 'loading' && (
        <motion.div key="loading" className="ambient grid h-full place-items-center" exit={{ opacity: 0 }}>
          <Face state="thinking" size={96} label="Saathi is waking up" />
        </motion.div>
      )}
      {session.status === 'offline' && (
        <motion.div key="offline" className="ambient grid h-full place-items-center px-6 text-center">
          <div className="flex max-w-sm flex-col items-center gap-4">
            <Face state="error" size={96} />
            <h1 className="font-display text-2xl font-semibold">Saathi tak pahunch nahi pa rahe</h1>
            <p className="text-muted">{session.error?.message}</p>
            <button className="rounded-full bg-gold px-5 py-2 font-semibold text-ink" onClick={() => window.location.reload()}>
              Dobara try karo
            </button>
          </div>
        </motion.div>
      )}
      {session.status === 'out' && (
        <motion.div key="auth" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <AuthScreen onAuthed={(user) => setSession({ status: 'in', user })} />
        </motion.div>
      )}
      {session.status === 'in' && (
        <motion.div key="home" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <HomeScreen user={session.user} onLogout={logout} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
