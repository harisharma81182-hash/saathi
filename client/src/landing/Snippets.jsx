import { motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { Face } from '../components/Face.jsx';

// Small "live" pieces of the real app, shown inside the landing page's feature panels instead of
// stock photos. They reuse the app's own look (receipt slip, toast, Today rows, the face).

export function ChatSnippet() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-line bg-surface-2 px-3.5 py-2">Kal subah 9 baje lab file submit karni hai, yaad dila dena</p>
      <div className="flex gap-2.5">
        <Face size={24} expression="happy" followCursor={false} />
        <div className="min-w-0 flex-1">
          <p>Ho gaya! Kal 9 baje yaad dila dunga. Aaj raat 15 min de de, subah tension nahi rahegi.</p>
          <p className="mt-2.5 flex items-start gap-2 border-t border-dashed border-line pt-2 text-muted">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-leaf/15 text-leaf">
              <Check size={11} strokeWidth={3} />
            </span>
            <span className="flex-1">Task "Lab file submit" aur reminder, kal 9:00 AM</span>
            <span className="text-xs font-semibold text-gold">Undo</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReminderSnippet() {
  return (
    <div className="glass rounded-2xl bg-ink/60 p-4 text-sm">
      <div className="flex gap-3">
        <Face size={34} expression="excited" followCursor={false} />
        <div className="min-w-0">
          <p className="font-display font-semibold">Lab file submit karni hai</p>
          <p className="mt-0.5 text-muted">Himanshu, 9 baj gaye! Bas ek baar check karke submit kar de, 5 minute ka kaam hai.</p>
          <div className="mt-3 flex gap-2">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold">10 min baad</span>
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold">1 ghanta</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudyPlanSnippet() {
  const rows = [
    ['Mon', 'ER model', true],
    ['Tue', 'Normalization', true],
    ['Wed', 'SQL joins', false],
    ['Thu', 'Transactions', false],
    ['Fri', 'Revision', false],
  ];
  return (
    <div className="text-sm">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-4xl font-semibold leading-none text-gold tabular-nums">6</span>
        <span className="text-muted">din bache DBMS exam mein</span>
      </div>
      <ul className="mt-4 flex flex-col">
        {rows.map(([day, topic, done]) => (
          <li key={day} className="flex items-center gap-3 py-1.5">
            <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] ${done ? 'border-leaf bg-leaf text-ink' : 'border-faint'}`}>
              {done && <Check size={11} strokeWidth={3.2} />}
            </span>
            <span className={`flex-1 ${done ? 'text-faint line-through' : ''}`}>{topic}</span>
            <span className="text-faint tabular-nums">{day} 7:00 PM</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MemorySnippet() {
  const facts = ['Classes 9 se 4 baje tak', 'DBMS thoda mushkil lagta hai', 'Raat 10 baje padhna pasand hai', 'Didi ki shaadi 12 Dec ko'];
  return (
    <div className="text-sm">
      <p className="text-faint">Saathi ko yaad hai:</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {facts.map((f) => (
          <li key={f} className="rounded-full border border-line bg-surface px-3 py-1.5 text-muted">
            {f}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-muted">"DBMS ka plan raat 10 baje rakha hai, tumhe tab padhna pasand hai na."</p>
    </div>
  );
}

export function VoiceSnippet() {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col items-center text-center text-sm">
      <Face size={92} state="listening" followCursor={false} />
      <div className="mt-4 flex h-8 items-center gap-1" aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => (
          <motion.span
            key={i}
            className="w-1 rounded-full bg-violet/80"
            animate={reduce ? { height: 8 } : { height: [6, 10 + ((i * 7) % 18), 6] }}
            transition={{ duration: 0.9 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.04 }}
          />
        ))}
      </div>
      <p className="mt-3 text-muted">Sun raha hoon...</p>
      <p className="mt-1">"25 ko DBMS exam hai, plan bana do"</p>
    </div>
  );
}
