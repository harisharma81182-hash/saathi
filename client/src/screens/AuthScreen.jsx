import { useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../lib/api.js';
import { Face } from '../components/Face.jsx';

// Login and signup on one calm screen, with Saathi's face reacting to what happens.
export function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('signup');
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
    <main className="ambient flex min-h-full items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Face size={112} state={busy ? 'thinking' : 'idle'} expression={failed ? 'concerned' : 'happy'} />
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight">Saathi</h1>
          <p className="mt-1 text-muted">Tumhara dost jo din sambhalne mein saath deta hai.</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-full bg-surface p-1" role="tablist">
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
              className={`relative rounded-full py-2 text-sm font-semibold transition-colors ${mode === m ? 'text-ink' : 'text-muted hover:text-text'}`}
            >
              {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-gold" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
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
            hint={mode === 'signup' ? 'Kam se kam 8 characters, ek letter aur ek number.' : null}
          />
          {message && (
            <p role="alert" className="rounded-xl bg-vermilion/10 px-3 py-2 text-sm text-vermilion">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-full bg-gold py-3 font-display text-lg font-semibold text-ink transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Ek second...' : mode === 'signup' ? 'Shuru karte hain' : 'Andar chalo'}
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({ label, error, hint, ...input }) {
  const id = `f-${label}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <input
        id={id}
        {...input}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={`rounded-xl border bg-surface px-4 py-3 text-text outline-none transition placeholder:text-faint focus:border-gold/60 ${error ? 'border-vermilion/70' : 'border-line'}`}
      />
      {(error || hint) && (
        <span id={`${id}-msg`} className={`text-xs ${error ? 'text-vermilion' : 'text-faint'}`}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
