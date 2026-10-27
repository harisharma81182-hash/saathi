import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { MailCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { AuthShell, Field, PASSWORD_HINT, lastEmail } from './AuthScreen.jsx';

// "Password bhool gaye?" in two screens:
//  ForgotScreen  enter your email; the answer is the same whether or not it has an account
//  ResetScreen   opened from the emailed link (#reset=...): choose a new password, twice

export function ForgotScreen({ onBack, onLogin }) {
  const [email, setEmail] = useState(lastEmail);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(res.message);
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell photo="mysticmountain" onBack={onBack} title="Inbox check karo">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-leaf/15 text-leaf">
            <MailCheck size={22} />
          </span>
          <p className="mt-4 text-muted">{sent}</p>
          <p className="mt-2 text-sm text-faint">Link 30 minute tak chalega. Email na aaye to 2 minute baad phir se maango.</p>
          <button onClick={onLogin} className="btn-ghost mt-6">
            Login par wapas jao
          </button>
        </motion.div>
      </AuthShell>
    );
  }

  return (
    <AuthShell photo="mysticmountain" onBack={onBack} busy={busy} failed={Boolean(error)} title="Password bhool gaye?" subtitle="Account ka email likho. Naya password set karne ka link wahan bhej denge.">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Email" name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} error={error} autoComplete="username" autoFocus />
        <button type="submit" disabled={busy || !email.trim()} className="btn-gold btn-lg mt-3 w-full">
          {busy ? 'Ek second...' : 'Link bhejo'}
        </button>
      </form>
    </AuthShell>
  );
}

export function ResetScreen({ token, onLogin, onForgot }) {
  const [status, setStatus] = useState('checking'); // checking | ready | invalid | done
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  // Ask first whether the link still works, so an old link shows what to do instead of a form.
  useEffect(() => {
    api('/auth/reset-password/check', { method: 'POST', body: { token } })
      .then((r) => setStatus(r.valid ? 'ready' : 'invalid'))
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) return setErrors({ confirm: 'Dono password ek jaise nahi hain.' });
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await api('/auth/reset-password', { method: 'POST', body: { token, password: form.password } });
      setMessage(res.message);
      setStatus('done');
    } catch (err) {
      if (err.code === 'RESET_LINK_INVALID') {
        setStatus('invalid');
      } else {
        const field = err.details?.find((d) => d.field === 'password');
        if (field) setErrors({ password: field.message });
        else setMessage(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === 'checking') {
    return (
      <AuthShell photo="mysticmountain" busy title="Link check ho raha hai">
        <div className="skeleton mx-auto h-11 w-full" />
      </AuthShell>
    );
  }
  if (status === 'invalid') {
    return (
      <AuthShell photo="mysticmountain" failed title="Yeh link ab kaam nahi karta" subtitle="Link 30 minute tak aur sirf ek baar chalta hai. Naya link maango, ek minute lagega.">
        <button onClick={onForgot} className="btn-gold btn-lg w-full">
          Naya link maango
        </button>
        <button onClick={onLogin} className="btn-ghost mt-3 w-full">
          Login par jao
        </button>
      </AuthShell>
    );
  }
  if (status === 'done') {
    return (
      <AuthShell photo="mysticmountain" title="Password badal gaya" subtitle={message}>
        <p className="mb-6 text-center text-sm text-faint">Baaki saare devices se bhi logout kar diya hai, safety ke liye.</p>
        <button onClick={onLogin} className="btn-gold btn-lg w-full">
          Login karo
        </button>
      </AuthShell>
    );
  }

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: null }));
  };
  return (
    <AuthShell photo="mysticmountain" busy={busy} failed={Boolean(message || errors.password || errors.confirm)} title="Naya password set karo" subtitle="Isse purane saare logins band ho jaayenge.">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Naya password" name="new-password" type="password" value={form.password} onChange={set('password')} error={errors.password} hint={PASSWORD_HINT} autoComplete="new-password" autoFocus />
        <Field label="Naya password dobara" name="confirm-password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        {message && (
          <p role="alert" className="border-l-2 border-vermilion/60 pl-3 text-sm text-text">
            {message}
          </p>
        )}
        <button type="submit" disabled={busy || !form.password || !form.confirm} className="btn-gold btn-lg mt-3 w-full">
          {busy ? 'Ek second...' : 'Password set karo'}
        </button>
      </form>
    </AuthShell>
  );
}
