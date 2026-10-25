// The languages a user can pick in Settings ("Bhasha"). The id is stored on the user; `prompt`
// tells the model how to write in it. Saathi still answers in whatever language the user actually
// writes or speaks in; the preferred language is for messages Saathi starts itself (greeting,
// reminder lines, nudges, recap) and for when the user's language is unclear.

export const LANGUAGES = {
  hinglish: { name: 'Hinglish', prompt: 'Hinglish (Hindi in Latin script mixed with English, the way friends text in India)' },
  en: { name: 'English', prompt: 'English (simple, friendly Indian English)' },
  hi: { name: 'Hindi', prompt: 'Hindi in Devanagari script (everyday spoken Hindi, not formal or bookish)' },
  mwr: {
    name: 'Marwari',
    prompt: 'Marwari (Rajasthani) in Devanagari script. Support is in beta: use common, everyday Marwari words, and where you are unsure of a Marwari word use simple Hindi instead of guessing',
  },
  ta: { name: 'Tamil', prompt: 'Tamil in Tamil script (everyday spoken Tamil; English words for tech terms are fine)' },
  bn: { name: 'Bengali', prompt: 'Bengali in Bengali script (everyday spoken Bengali; English words for tech terms are fine)' },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);
export const DEFAULT_LANGUAGE = 'hinglish';

export const languageOf = (user) => LANGUAGES[user?.language] ?? LANGUAGES[DEFAULT_LANGUAGE];
