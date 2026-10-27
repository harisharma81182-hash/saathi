import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from './lib/api.js';
import { forgetThisDevice } from './lib/push.js';
import { Face } from './components/Face.jsx';
import { SpaceBackdrop } from './components/SpaceBackdrop.jsx';
import { WarpFlash } from './components/WarpFlash.jsx';
import { AuthScreen } from './screens/AuthScreen.jsx';
import { AppShell } from './app/AppShell.jsx';
import { ForgotScreen, ResetScreen } from './screens/PasswordScreens.jsx';

// The landing page carries the 3D library, so it is loaded only for visitors who are not logged in.
const LandingScreen = lazy(() => import('./landing/LandingScreen.jsx'));

// Logged out, the page is the landing scene, or the login/signup form (#login, #signup), so the
// browser's Back button goes from the form back to the landing page.
// Moving between landing, login and Home: the old screen softly blurs away, the new one comes into
// focus. One shared transition, so the whole app feels like one place.
const PAGE = {
  initial: { opacity: 0, scale: 0.985, filter: 'blur(8px)' },
  // transitionEnd removes the filter and transform afterwards: a leftover filter (even blur(0px))
  // would keep the whole screen on a costly layer and stop the glass panels' backdrop blur working.
  animate: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
    transitionEnd: { filter: 'none', transform: 'none' },
  },
  exit: { opacity: 0, scale: 1.01, filter: 'blur(8px)', transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } },
};

// #reset=<token> comes from the "Password bhool gaye?" email; it opens the reset page whether or
// not someone is logged in (the token stays in the #fragment, never sent to any server log).
const VIEWS = { '#login': 'login', '#signup': 'signup', '#forgot': 'forgot' };
const authViewFromHash = () => (location.hash.startsWith('#reset=') ? 'reset' : (VIEWS[location.hash] ?? 'landing'));
// (Logged in, #/tasks, #/notes ... pick the screen inside the app shell.)
const resetToken = () => (location.hash.startsWith('#reset=') ? location.hash.slice('#reset='.length) : null);

// Who is logged in decides the screen. The cookie is httpOnly, so the only way to know is to ask.
export function App() {
  const [session, setSession] = useState({ status: 'loading', user: null });
  const [authView, setAuthView] = useState(authViewFromHash);
  useEffect(() => {
    const onHash = () => setAuthView(authViewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (view) => {
    location.hash = view === 'landing' ? '' : view;
    setAuthView(view);
  };

  useEffect(() => {
    api('/auth/me')
      .then(({ user }) => setSession({ status: 'in', user }))
      .catch((err) => setSession({ status: err.status === 401 ? 'out' : 'offline', user: null, error: err }));
  }, []);

  const logout = async () => {
    await forgetThisDevice(); // while still logged in, so the server accepts it
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    go('landing');
    setSession({ status: 'out', user: null });
  };
  const authed = (user) => {
    history.replaceState(null, '', location.pathname); // drop #login / #signup
    setSession({ status: 'in', user });
  };

  return (
    <>
      <WarpFlash routeKey={session.status === 'in' ? 'app' : `${session.status}:${authView}`} />
      <AnimatePresence mode="wait">
        {authView === 'reset' && (
          <motion.div key="reset" className="h-full" {...PAGE}>
            <ResetScreen
              token={resetToken()}
              onForgot={() => go('forgot')}
              onLogin={() => {
                // Every session was logged out by the reset, this one included.
                setSession({ status: 'out', user: null });
                go('login');
              }}
            />
          </motion.div>
        )}
        {authView !== 'reset' && session.status === 'loading' && (
          <motion.div key="loading" className="ambient grid h-full place-items-center" exit={{ opacity: 0 }}>
            <SpaceBackdrop photo="antennae-hubble" strength="soft" />
            <Face state="thinking" size={96} label="Saathi is waking up" />
          </motion.div>
        )}
        {authView !== 'reset' && session.status === 'offline' && (
          <motion.div key="offline" className="ambient grid h-full place-items-center px-6 text-center">
            <SpaceBackdrop photo="andromeda-visible" />
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
        {session.status === 'out' && authView === 'landing' && (
          <motion.div key="landing" className="min-h-full" {...PAGE}>
            <Suspense fallback={<div className="night-sky h-full" />}>
              <LandingScreen onLogin={() => go('login')} onSignup={() => go('signup')} />
            </Suspense>
          </motion.div>
        )}
        {session.status === 'out' && authView === 'forgot' && (
          <motion.div key="forgot" className="h-full" {...PAGE}>
            <ForgotScreen onBack={() => go('login')} onLogin={() => go('login')} />
          </motion.div>
        )}
        {session.status === 'out' && (authView === 'login' || authView === 'signup') && (
          <motion.div key="auth" className="h-full" {...PAGE}>
            <AuthScreen key={authView} initialMode={authView} onBack={() => go('landing')} onForgot={() => go('forgot')} onAuthed={authed} />
          </motion.div>
        )}
        {authView !== 'reset' && session.status === 'in' && (
          <motion.div key="home" className="h-full" {...PAGE}>
            <AppShell user={session.user} onLogout={logout} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
