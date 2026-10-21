import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Check, LogOut, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { PHOTOS } from '../lib/photos.js';
import { EmptyState, ErrorState, ListSkeleton, ScreenFrame } from '../components/ScreenParts.jsx';

// Settings: your name and timezone (Saathi uses them in every reply, and "kal 9 baje" depends on
// the timezone), what Saathi remembers about you (see, add, forget), notifications and logout.

const KINDS = {
  fact: 'Baat',
  preference: 'Pasand',
  routine: 'Routine',
  goal: 'Goal',
  person: 'Log',
};

export function SettingsScreen({ user, onUserChange, onLogout }) {
  return (
    <ScreenFrame title="Settings" description="Tumhari jaankari, aur Saathi ko tumhare baare mein kya yaad hai.">
      <Section title="Profile" text="Saathi tumhe isi naam se bulata hai. Timezone se pata chalta hai ki tumhare liye 'kal 9 baje' kab hai.">
        <Profile user={user} onUserChange={onUserChange} />
      </Section>
      <Section title="Saathi ko kya yaad hai" text="Yeh baatein Saathi har jawab mein yaad rakhta hai. Jo galat ya purani ho, hata do.">
        <Memories />
      </Section>
      <Section title="Notifications" text="Tab band ho tab bhi reminder ka popup aaye, iske liye browser se permission chahiye.">
        <NotificationSetting />
      </Section>
      <Section title="Account" text={`${user.email} se login ho.`}>
        <button onClick={onLogout} className="btn-ghost -ml-3 text-vermilion">
          <LogOut size={16} /> Logout karo
        </button>
      </Section>
      <PhotoCredits />
    </ScreenFrame>
  );
}

function Section({ title, text, children }) {
  return (
    <section className="mt-12 grid gap-4 border-t border-line pt-8 sm:grid-cols-[220px_1fr] sm:gap-10">
      <div>
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {text && <p className="mt-1.5 text-sm text-faint">{text}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Profile({ user, onUserChange }) {
  const [form, setForm] = useState({ name: user.name, timezone: user.timezone });
  const [state, setState] = useState('idle'); // idle | saving | saved
  const [error, setError] = useState(null);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Kolkata', 'UTC'];
    }
  }, []);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const changed = form.name.trim() !== user.name || form.timezone !== user.timezone;

  async function save(e) {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const { user: updated } = await api('/auth/me', { method: 'PATCH', body: { name: form.name.trim(), timezone: form.timezone } });
      onUserChange(updated);
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
      setState('idle');
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Naam</span>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={60}
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-text outline-none transition focus:border-gold/60 focus-visible:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Timezone</span>
        <select
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-text outline-none [color-scheme:dark] focus:border-gold/60 focus-visible:outline-none"
        >
          {zones.map((z) => (
            <option key={z} value={z} className="bg-ink">
              {z}
            </option>
          ))}
        </select>
        {browserZone !== form.timezone && (
          <button type="button" onClick={() => setForm({ ...form, timezone: browserZone })} className="self-start text-xs text-faint hover:text-gold">
            Is device ka timezone use karo ({browserZone})
          </button>
        )}
      </label>
      {error && <p className="text-sm text-vermilion">{error}</p>}
      <div>
        <button type="submit" disabled={!changed || state === 'saving' || !form.name.trim()} className="btn-gold">
          {state === 'saved' ? (
            <>
              <Check size={15} /> Save ho gaya
            </>
          ) : state === 'saving' ? (
            'Save ho raha hai'
          ) : (
            'Save karo'
          )}
        </button>
      </div>
    </form>
  );
}

function Memories() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('fact');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api('/agent/memories')).memories);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await api('/agent/memories', { method: 'POST', body: { text: text.trim(), kind } });
      setText('');
      load();
    } catch (err) {
      setAddError(err.details?.[0]?.message ?? err.message);
    } finally {
      setAdding(false);
    }
  }

  async function forget(id) {
    setItems((all) => all.filter((m) => m.id !== id)); // feels instant; reload restores it if it failed
    try {
      await api(`/agent/memories/${id}`, { method: 'DELETE' });
    } catch (err) {
      setError(err);
      load();
    }
  }

  return (
    <div>
      <form onSubmit={add} className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 pl-4">
        <label className="sr-only" htmlFor="memory-text">
          Saathi ko kya yaad rakhna hai
        </label>
        <input
          id="memory-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jaise: Meri classes 9 se 4 baje tak hoti hain"
          className="min-w-0 flex-1 basis-56 bg-transparent text-text outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <label className="sr-only" htmlFor="memory-kind">
          Kis tarah ki baat
        </label>
        <select id="memory-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg bg-ink/50 px-2 py-1.5 text-sm text-text outline-none [color-scheme:dark] focus-visible:outline-none">
          {Object.entries(KINDS).map(([k, l]) => (
            <option key={k} value={k} className="bg-ink">
              {l}
            </option>
          ))}
        </select>
        <button type="submit" disabled={adding || text.trim().length < 3} className="btn-ghost text-gold">
          <Plus size={15} /> Yaad rakho
        </button>
      </form>
      {addError && <p className="mt-2 text-sm text-vermilion">{addError}</p>}

      {error && <ErrorState error={error} onRetry={load} />}
      {!items && !error && <ListSkeleton rows={3} />}
      {items?.length === 0 && <EmptyState title="Abhi kuch yaad nahi" text="Chat mein apne baare mein batao, ya upar likho. Saathi har jawab mein yeh baatein dhyan rakhega." expression="thinking" />}
      <ul className="mt-3">
        <AnimatePresence initial={false}>
          {items?.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 12 }} className="group flex items-start gap-3 border-b border-line/60 py-3 last:border-0">
              <span className="mt-0.5 w-16 shrink-0 text-xs text-faint">{KINDS[m.kind] ?? m.kind}</span>
              <p className="min-w-0 flex-1">{m.text}</p>
              <button
                onClick={() => forget(m.id)}
                aria-label={`"${m.text}" bhool jao`}
                title="Bhool jao"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint opacity-100 transition hover:bg-vermilion/10 hover:text-vermilion lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** One small line, opening into where every background photo comes from. */
function PhotoCredits() {
  return (
    <details className="group mt-12 border-t border-line pt-6 text-xs text-faint">
      <summary className="cursor-pointer list-none hover:text-muted">
        Space photos: NASA, ESA/Hubble aur Chandra ke asli photos. <span className="underline underline-offset-2">Credits dekho</span>
      </summary>
      <ul className="mt-4 flex flex-col gap-3">
        {Object.entries(PHOTOS).map(([id, p]) => (
          <li key={id}>
            <a href={p.source} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
              {p.title}
            </a>
            <span className="text-faint"> ({p.usedFor}). Credit: {p.credit}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NotificationSetting() {
  const supported = 'Notification' in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported');
  if (!supported) return <p className="text-muted">Is browser mein notifications nahi chalte. Microsoft Edge ya Chrome try karo.</p>;
  if (perm === 'granted') {
    return (
      <p className="inline-flex items-center gap-2 text-muted">
        <Check size={16} className="text-leaf" /> On hain. Reminders tab band hone par bhi aayenge.
      </p>
    );
  }
  if (perm === 'denied') return <p className="text-muted">Browser ne notifications block kiye hain. Address bar ke lock icon se "Notifications: Allow" karo, phir page reload karo.</p>;
  return (
    <button onClick={() => Notification.requestPermission().then(setPerm)} className="btn-gold">
      <Bell size={15} /> Notifications on karo
    </button>
  );
}
