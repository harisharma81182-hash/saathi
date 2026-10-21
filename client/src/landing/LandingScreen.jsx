import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { BellRing, ListChecks, Mic } from 'lucide-react';
import { createOrbitScene } from './orbitScene.js';
import { useSmoothScroll } from './useSmoothScroll.js';
import { FeatureFold, foldScrollY } from './FeatureFold.jsx';
import { ChatSnippet, MemorySnippet, ReminderSnippet, StudyPlanSnippet, VoiceSnippet } from './Snippets.jsx';
import { Face } from '../components/Face.jsx';

// The landing page (before login): the Saathi Orbit scene as a full-screen hero, then sections
// that explain Saathi while you scroll (word-by-word intro, the 3D feature fold, how it works, a
// final call to action). Smooth scrolling (Lenis) and a sticky header whose links smooth-jump to
// each feature, with the one on screen highlighted. Loaded only for visitors who are logged out.

const FEATURES = [
  { id: 'tasks', name: 'Tasks', color: '#5aa8ff', title: 'Bolo, aur kaam list mein.', text: 'Normal baat ki tarah likho. Saathi task, deadline aur priority khud samajh leta hai, aur har badlaav Undo ho sakta hai.', snippet: <ChatSnippet /> },
  { id: 'reminders', name: 'Reminders', color: '#ff9d5c', title: 'Time pe, dost ki tarah yaad.', text: 'Reminder bajne par Saathi apne andaaz mein yaad dilata hai. Abhi time nahi? Ek tap mein 10 minute baad.', snippet: <ReminderSnippet /> },
  { id: 'study-plan', name: 'Study plan', color: '#9b7bff', photo: 'cosmicreef', title: 'Exam ka plan, ek line mein.', text: '"25 ko DBMS exam hai" bolo. Topics roz ke sessions mein bant jaate hain, har session ka reminder bhi.', snippet: <StudyPlanSnippet /> },
  { id: 'memory', name: 'Memory', color: '#47d6c3', title: 'Tumhe yaad rakhta hai.', text: 'Classes ka time, mushkil subject, padhne ka pasandida waqt. Saathi yaad rakhta hai, aur Settings mein sab dikhta hai.', snippet: <MemorySnippet /> },
  { id: 'voice', name: 'Voice', color: '#ff6fb5', title: 'Type nahi, bas bolo.', text: 'Hindi, English ya Hinglish mein bolo. Saathi sunta hai, kaam karta hai, aur jawab bhi bolke deta hai.', snippet: <VoiceSnippet /> },
];

export default function LandingScreen({ onLogin, onSignup }) {
  const scrollTo = useSmoothScroll();
  const foldRef = useRef(null);
  const introRef = useRef(null);
  const [active, setActive] = useState(-1);
  const foldInView = useInView(foldRef, { margin: '-45% 0px -45% 0px' });

  const goToFeature = (i) => scrollTo(foldScrollY(foldRef.current, i, FEATURES.length));

  return (
    <div className="ambient min-h-full text-text">
      <Header active={foldInView ? active : -1} onFeature={goToFeature} onTop={() => scrollTo(0)} onLogin={onLogin} onSignup={onSignup} />
      <Hero onSignup={onSignup} onLogin={onLogin} onNext={() => scrollTo(introRef.current)} />
      <Intro sectionRef={introRef} />
      <FeatureFold features={FEATURES} sectionRef={foldRef} onActiveChange={setActive} />
      <HowItWorks />
      <FinalCall onSignup={onSignup} onLogin={onLogin} />
    </div>
  );
}

function Header({ active, onFeature, onTop, onLogin, onSignup }) {
  // Transparent over the hero; a glass bar once the page has scrolled.
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 40));
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-[background,border-color,backdrop-filter] duration-500 ${solid ? 'border-b border-line bg-ink/55 backdrop-blur-xl' : 'border-b border-transparent'}`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] sm:px-8">
        <button onClick={onTop} className="flex items-center gap-2.5 font-display text-xl font-semibold" aria-label="Saathi, upar jao">
          <span aria-hidden className="h-3.5 w-3.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#ffe2a8,#f2a541_55%,#b5651d)] shadow-[0_0_18px_4px_rgba(242,165,65,0.5)]" />
          Saathi
        </button>
        <nav aria-label="Features" className="hidden items-center gap-1 lg:flex">
          {FEATURES.map((f, i) => (
            <button
              key={f.id}
              onClick={() => onFeature(i)}
              aria-current={active === i ? 'true' : undefined}
              className={`relative rounded-full px-3 py-1.5 text-sm transition-colors ${active === i ? 'text-text' : 'text-faint hover:text-text'}`}
            >
              {active === i && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-surface-2" transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />}
              <span className="relative">{f.name}</span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={onLogin} className="btn-ghost">
            Login
          </button>
          <button onClick={onSignup} className="btn-gold">
            Account banao
          </button>
        </div>
      </div>
    </header>
  );
}

function Hero({ onSignup, onLogin, onNext }) {
  const stage = useRef(null);
  const labels = useRef(null);
  const hero = useRef(null);
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();

  // A fresh canvas for every mount: dispose() hands the old one's GPU memory back (context loss),
  // and a lost context cannot be used again. The scene stops rendering once the hero scrolls away.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Saathi ka chamakta sona core, aur uske features (Tasks, Reminders, Study plan, Memory, Voice) planets ki tarah ghoomte hue');
    stage.current.appendChild(canvas);
    let scene;
    try {
      scene = createOrbitScene({ canvas, labels: labels.current });
    } catch (err) {
      console.warn('Saathi Orbit could not start, showing the plain sky instead:', err);
      setFailed(true);
    }
    return () => {
      scene?.dispose();
      canvas.remove();
    };
  }, []);

  // As you scroll down, the headline drifts up and fades: the scene stays the backdrop.
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -80]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section ref={hero} className="relative h-[100svh] min-h-[560px] overflow-hidden bg-[#05060d]">
      <div ref={stage} className="absolute inset-0" hidden={failed} />
      <div ref={labels} aria-hidden className="pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 55%, transparent 55%, rgba(5,6,13,0.85) 100%), linear-gradient(to top, rgba(8,11,24,1), rgba(5,6,13,0.6) 30%, transparent 55%)' }}
      />
      {failed && <div aria-hidden className="night-sky absolute inset-0" />}

      <motion.div style={{ y: textY, opacity: textOpacity }} className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-24 sm:px-8 sm:pb-28">
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl font-display text-[2.75rem] font-bold leading-[0.98] tracking-tight text-balance sm:text-[3.75rem] lg:text-[4.75rem]"
        >
          Tumhara din, tumhare saath.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 max-w-lg text-lg text-muted"
        >
          Saathi ek AI dost hai jo sirf baat nahi karta, kaam karta hai. Tasks, reminders, study plans aur yaadein, sab ek jagah.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <button onClick={onSignup} className="btn-gold btn-lg">
            Account banao
          </button>
          <button onClick={onLogin} className="btn-ghost btn-lg">
            Login
          </button>
        </motion.div>
      </motion.div>

      <ScrollCue onClick={onNext} />
    </section>
  );
}

/** The little mouse at the bottom of the hero, with a dot rolling down: "there is more below". */
function ScrollCue({ onClick }) {
  const reduce = useReducedMotion();
  return (
    <button onClick={onClick} aria-label="Neeche scroll karo" className="group absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-xs text-faint transition-colors hover:text-text">
      <span className="relative h-9 w-[22px] rounded-full border border-current">
        <motion.span
          className="absolute left-1/2 top-2 h-1.5 w-1 -translate-x-1/2 rounded-full bg-gold"
          animate={reduce ? {} : { y: [0, 10, 0], opacity: [1, 0.2, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </span>
      <span className="hidden sm:block">Scroll karo</span>
    </button>
  );
}

/** One sentence that lights up word by word as you scroll through it. */
function Intro({ sectionRef }) {
  const words = 'Saathi wo dost hai jo yaad rakhta hai, time pe yaad dilata hai, aur tumhari baat sunke kaam khud kar deta hai.'.split(' ');
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start 0.8', 'end 0.45'] });
  return (
    <section ref={sectionRef} className="mx-auto max-w-5xl px-4 py-32 sm:px-8 sm:py-44">
      <p className="font-display text-[clamp(1.75rem,4.2vw,3.25rem)] font-semibold leading-[1.15] tracking-tight">
        {words.map((w, i) => (
          <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
            {w}
          </Word>
        ))}
      </p>
    </section>
  );
}

function Word({ progress, range, children }) {
  const opacity = useTransform(progress, range, [0.16, 1]);
  return (
    <motion.span style={{ opacity }}>
      {children}{' '}
    </motion.span>
  );
}

const STEPS = [
  { icon: Mic, title: 'Bolo ya likho', text: 'Jaise dost ko WhatsApp karte ho: "kal 9 baje lab file yaad dila dena".' },
  { icon: ListChecks, title: 'Saathi kaam karta hai', text: 'Task aur reminder ban jaate hain. Har badlaav ki receipt milti hai, Undo ke saath.' },
  { icon: BellRing, title: 'Time pe yaad', text: 'Sahi waqt par notification, raat ko din ka hisaab, aur bache kaam kal ke liye.' },
];

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.12 } } };
const rise = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } } };

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-28 sm:px-8 sm:py-36">
      <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-15%' }}>
        <motion.h2 variants={rise} className="max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Teen kadam. Koi form nahi, koi setting nahi.
        </motion.h2>
        <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <motion.div key={title} variants={rise}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-gold">
                  <Icon size={18} />
                </span>
                <span className="font-display text-sm text-faint tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-muted">{text}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

function FinalCall({ onSignup, onLogin }) {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-24 sm:px-8 sm:pt-32">
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-15%' }}
        className="mx-auto flex max-w-3xl flex-col items-center text-center"
      >
        <motion.div variants={rise}>
          <Face size={120} expression="happy" aura followCursor />
        </motion.div>
        <motion.h2 variants={rise} className="mt-10 font-display text-[clamp(2.25rem,5.5vw,4rem)] font-bold leading-[1.02] tracking-tight text-balance">
          Aaj ka din Saathi ke saath shuru karo.
        </motion.h2>
        <motion.p variants={rise} className="mt-4 max-w-md text-muted">
          Account banane mein 30 second lagte hain. Uske baad bas baat karo.
        </motion.p>
        <motion.div variants={rise} className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={onSignup} className="btn-gold btn-lg">
            Account banao
          </button>
          <button onClick={onLogin} className="btn-ghost btn-lg">
            Pehle se account hai? Login
          </button>
        </motion.div>
      </motion.div>
      <footer className="mx-auto mt-28 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-faint">
        <span className="font-display font-semibold text-muted">Saathi</span>
        <span>Ek college project, 2026 mein banaya gaya</span>
      </footer>
    </section>
  );
}
