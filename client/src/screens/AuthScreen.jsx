import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api.js';
import { Face } from '../components/Face.jsx';
import { SpaceBackdrop } from '../components/SpaceBackdrop.jsx';

// Login and signup on one calm screen, with Saathi's face reacting to what happens.
export function AuthScreen({ onAuthed, onBack, onForgot, initialMode = 'signup' }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: null }));
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const body =
        mode === 'signup'
          ? { ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : { email: form.email, password: form.password };
      const { user } = await api(`/auth/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body });
      onAuthed(user);
    } catch (err) {
      // Field errors go under their field; anything else above the button.
      const byField = Object.fromEntries((err.details ?? []).filter((d) => d.field).map((d) => [d.field, d.message]));
      setErrors(byField);
      if (!Object.keys(byField).length) setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const failed = Boolean(message || Object.keys(errors).some((k) => errors[k]));
  return (
    <AuthShell onBack={onBack} busy={busy} failed={failed} title="Saathi" subtitle="Tumhara dost, jo din sambhalne mein saath deta hai.">

        <div className="mb-6 grid grid-cols-2 rounded-full bg-surface p-1" role="tablist">
          {[
            ['signup', 'Naya account'],
            ['login', 'Login'],
          ].map(([m, text]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setErrors({});
                setMessage(null);
              }}
              className={`relative rounded-full py-2 text-sm font-semibold transition-colors ${mode === m ? 'text-text' : 'text-faint hover:text-text'}`}
            >
              {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-surface-2" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
              <span className="relative">{text}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {mode === 'signup' && <Field label="Naam" value={form.name} onChange={set('name')} error={errors.name} autoComplete="given-name" />}
          <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? PASSWORD_HINT : null}
          />
          {mode === 'login' && onForgot && (
            <button type="button" onClick={onForgot} className="-mt-1 self-end rounded px-1 text-sm text-faint transition-colors hover:text-gold">
              Password bhool gaye?
            </button>
          )}
          {message && (
            <p role="alert" className="border-l-2 border-vermilion/60 pl-3 text-sm text-text">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn-gold btn-lg mt-3 w-full"
          >
            {busy ? 'Ek second...' : mode === 'signup' ? 'Account banao' : 'Login karo'}
          </button>
        </form>
    </AuthShell>
  );
}

export const PASSWORD_HINT = 'Kam se kam 8 characters, ek letter aur ek number.';

/** The frame shared by login, signup, "Password bhool gaye?" and the reset page. */
export function AuthShell({ onBack, busy, failed, title, subtitle, photo = 'pillars', children }) {
  return (
    <main className="ambient relative flex min-h-full items-center justify-center px-5 py-10">
      <SpaceBackdrop photo={photo} strength={photo === 'pillars' ? 'soft' : 'strong'} position="50% 30%" />
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-3 top-[max(env(safe-area-inset-top),12px)] inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm text-faint transition-colors hover:bg-surface hover:text-text sm:left-6"
        >
          <ChevronLeft size={16} /> Wapas
        </button>
      )}
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Face size={112} state={busy ? 'thinking' : 'idle'} expression={failed ? 'concerned' : 'happy'} />
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function Field({ label, error, hint, type = 'text', ...input }) {
  const id = `f-${label.replace(/\s+/g, '-')}`;
  const isPassword = type === 'password';
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...input}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={`w-full rounded-xl border bg-surface px-4 py-3 text-text outline-none transition placeholder:text-faint focus:border-gold/60 ${isPassword ? 'pr-12' : ''} ${error ? 'border-vermilion/70' : 'border-line'}`}
        />
        {isPassword && <PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} controls={id} />}
      </div>
      {(error || hint) && (
        <span id={`${id}-msg`} className={`text-xs ${error ? 'text-vermilion' : 'text-faint'}`}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

// The eye button inside a password field: shows the password while "on", hides it again on a
// second click. A 44px touch target, so it is easy to hit on a phone.
function PasswordToggle({ visible, onToggle, controls }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? 'Password chhupao' : 'Password dikhao'}
      aria-pressed={visible}
      aria-controls={controls}
      title={visible ? 'Password chhupao' : 'Password dikhao'}
      className={`absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl transition-colors ${visible ? 'text-gold' : 'text-faint hover:text-gold'}`}
    >
      {visible ? <Eye size={19} aria-hidden /> : <EyeOff size={19} aria-hidden />}
    </button>
  );
}
