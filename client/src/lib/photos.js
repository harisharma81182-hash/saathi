// The real space photos behind the screens, with where each one comes from. The same list is in
// CREDITS.md and is shown in Settings. Files: public/bg/<id>-desktop.webp and <id>-phone.webp,
// made from the original HD downloads by scripts/make-backgrounds.mjs.

export const PHOTOS = {
  westerlund2: {
    title: 'Westerlund 2',
    credit: 'NASA, ESA, the Hubble Heritage Team (STScI/AURA), A. Nota (ESA/STScI), and the Westerlund 2 Science Team',
    source: 'https://esahubble.org/images/heic1509a/',
    usedFor: 'Home',
  },
  pillars: {
    title: 'Pillars of Creation',
    credit: 'NASA, ESA/Hubble and the Hubble Heritage Team',
    source: 'https://esahubble.org/images/heic1501a/',
    usedFor: 'Login aur signup',
  },
  mysticmountain: {
    title: 'Mystic Mountain',
    credit: 'NASA, ESA, M. Livio and the Hubble 20th Anniversary Team (STScI)',
    source: 'https://esahubble.org/images/heic1007a/',
    usedFor: 'Password bhool gaye',
  },
  antennae: {
    title: 'Antennae galaxies (Chandra, Hubble, Spitzer)',
    credit: 'NASA, ESA, SAO, CXC, JPL-Caltech, and STScI. Acknowledgment: G. Fabbiano and Z. Wang (Harvard-Smithsonian CfA), and B. Whitmore (STScI)',
    source: 'https://esahubble.org/images/opo1025a/',
    usedFor: 'Tasks',
  },
  am0500: {
    title: 'AM 0500-620',
    credit: 'NASA, ESA, the Hubble Heritage Team (STScI/AURA)-ESA/Hubble Collaboration and W. Keel (University of Alabama, Tuscaloosa)',
    source: 'https://esahubble.org/images/heic0810bv/',
    usedFor: 'Notes',
  },
  carina: {
    title: 'Carina Nebula',
    credit: 'NASA, ESA, N. Smith (University of California, Berkeley), and The Hubble Heritage Team (STScI/AURA)',
    source: 'https://esahubble.org/images/heic0707a/',
    usedFor: 'Settings',
  },
  cosmicreef: {
    title: 'Cosmic Reef (NGC 2014 and NGC 2020)',
    credit: 'NASA, ESA, and STScI',
    source: 'https://esahubble.org/images/heic2007a/',
    usedFor: 'Study plan (landing page)',
  },
  ngc2207: {
    title: 'NGC 2207 and IC 2163',
    credit: 'NASA/ESA and The Hubble Heritage Team (STScI)',
    source: 'https://esahubble.org/images/opo9941a/',
    usedFor: 'Khaali screens',
  },
  'antennae-hubble': {
    title: 'Antennae galaxies (Hubble)',
    credit: 'NASA, ESA, and the Hubble Heritage Team (STScI/AURA)-ESA/Hubble Collaboration. Acknowledgement: B. Whitmore (STScI) and James Long (ESA/Hubble)',
    source: 'https://esahubble.org/images/heic0615a/',
    usedFor: 'Loading',
  },
};

export const photoUrl = (id, variant) => `/bg/${id}-${variant}.webp`;
