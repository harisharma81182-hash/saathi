// Voice for Saathi, using the browser's own Web Speech API (no extra service, no cost):
//   listen()      speech to text, in the chosen language (SpeechRecognition)
//   speak()       text to speech, with the best local voice for the reply's language (speechSynthesis)
// Edge has the best Indian voices (Hindi, Tamil, Bengali, Indian English); Chrome works too.
// Firefox has no speech recognition, so voice mode shows a clear message there.

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const canListen = Boolean(Recognition);
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Thrown by listen(): code is 'denied' (no mic permission), 'no-speech', 'aborted' or 'failed'. */
export class SpeechError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * Listens once and resolves with what was said. onInterim(text) gets the words as they come.
 * Returns { promise, stop }: stop() ends listening early and keeps what was heard so far.
 */
export function listen({ lang, onInterim }) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let latest = '';

  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      latest = (finalText + interim).trim();
      onInterim?.(latest);
    };
    rec.onerror = (e) => {
      const code = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'no-speech' : e.error === 'aborted' ? 'aborted' : 'failed';
      reject(new SpeechError(code, e.message || e.error));
    };
    rec.onend = () => {
      const text = (finalText || latest).trim();
      if (text) resolve(text);
      else reject(new SpeechError('no-speech'));
    };
  });
  promise.catch(() => {}); // the caller handles it; avoid an "unhandled" warning when it doesn't
  rec.start();
  return { promise, stop: () => rec.stop(), abort: () => rec.abort() };
}

// ---- speaking ------------------------------------------------------------------------------

/** The language to speak a reply in: the reply's own script wins (Saathi answers in the user's language). */
export function speechLangFor(text, fallback) {
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ঀ-৿]/.test(text)) return 'bn-IN';
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';
  // Latin script: English or Hinglish. The Indian English voice reads Hinglish naturally.
  return fallback === 'hi-IN' || fallback === 'ta-IN' || fallback === 'bn-IN' ? 'en-IN' : fallback;
}

let voicesReady;
function loadVoices() {
  if (!canSpeak) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesReady ??= new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500); // some browsers never fire the event
  });
  return voicesReady;
}

/** The nicest installed voice for a language: Edge's "Natural"/"Online" neural voices first. */
export async function pickVoice(lang) {
  const voices = await loadVoices();
  const norm = (l) => l.replace('_', '-').toLowerCase();
  const exact = voices.filter((v) => norm(v.lang) === lang.toLowerCase());
  const base = voices.filter((v) => norm(v.lang).split('-')[0] === lang.split('-')[0].toLowerCase());
  const pool = exact.length ? exact : base;
  return pool.find((v) => /natural|online|neural/i.test(v.name)) ?? pool.find((v) => !v.localService) ?? pool[0] ?? null;
}

/** Text to read aloud: no emoji, symbols or markdown. */
export function speakable(text) {
  return text
    .replace(/[*_#`>~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Speaks the text and resolves when done (or when stopped). Long text is spoken sentence by
 * sentence, because some browsers cut off a single long utterance after about 15 seconds.
 * Resolves false if no voice for that language is installed.
 */
export async function speak(text, { lang }) {
  if (!canSpeak) return false;
  const clean = speakable(text);
  if (!clean) return true;
  const voice = await pickVoice(lang);
  if (!voice) return false;
  speechSynthesis.cancel();
  const parts = clean.match(/[^.!?।]+[.!?।]*/g) ?? [clean];
  for (const part of parts) {
    const ok = await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(part.trim());
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1.02;
      u.onend = () => resolve(true);
      u.onerror = (e) => resolve(e.error !== 'interrupted' && e.error !== 'canceled');
      speechSynthesis.speak(u);
    });
    if (!ok) break; // stopped
  }
  return true;
}

export const stopSpeaking = () => canSpeak && speechSynthesis.cancel();
