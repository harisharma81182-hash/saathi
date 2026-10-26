// The real space photos behind the screens, with where each one comes from. The same list is in
// CREDITS.md and is shown in Settings. Files: public/bg/<id>-desktop.webp and <id>-phone.webp,
// made from the original HD downloads by scripts/make-backgrounds.mjs.
// `match`: 'exact' = the same photo as Himanshu's reference screenshot; 'similar' = the exact
// original could not be found, so this is the closest free photo.

export const PHOTOS = {
  westerlund2: {
    title: 'Westerlund 2',
    credit: 'NASA, ESA, the Hubble Heritage Team (STScI/AURA), A. Nota (ESA/STScI), and the Westerlund 2 Science Team',
    source: 'https://esahubble.org/images/heic1509a/',
    usedFor: 'Home',
    match: 'exact',
  },
  pillars: {
    title: 'Pillars of Creation',
    credit: 'NASA, ESA/Hubble and the Hubble Heritage Team',
    source: 'https://esahubble.org/images/heic1501a/',
    usedFor: 'Login aur signup',
    match: 'exact',
  },
  mysticmountain: {
    title: 'Mystic Mountain',
    credit: 'NASA, ESA, M. Livio and the Hubble 20th Anniversary Team (STScI)',
    source: 'https://esahubble.org/images/heic1007a/',
    usedFor: 'Password bhool gaye',
    match: 'exact',
  },
  antennae: {
    title: 'Antennae galaxies (Chandra, Hubble, Spitzer)',
    credit: 'NASA, ESA, SAO, CXC, JPL-Caltech, and STScI. Acknowledgment: G. Fabbiano and Z. Wang (Harvard-Smithsonian CfA), and B. Whitmore (STScI)',
    source: 'https://esahubble.org/images/opo1025a/',
    usedFor: 'Tasks',
    match: 'exact',
  },
  blackhole: {
    title: 'Black hole accretion disk visualization (2019, frame 1 of the 360 orbit, placed on a wider black background)',
    credit: "NASA's Goddard Space Flight Center / Jeremy Schnittman",
    source: 'https://svs.gsfc.nasa.gov/13326',
    usedFor: 'Reminders',
    match: 'exact',
  },
  am0500: {
    title: 'AM 0500-620',
    credit: 'NASA, ESA, the Hubble Heritage Team (STScI/AURA)-ESA/Hubble Collaboration and W. Keel (University of Alabama, Tuscaloosa)',
    source: 'https://esahubble.org/images/heic0810bv/',
    usedFor: 'Notes',
    match: 'exact',
  },
  andromeda: {
    title: 'Cool Andromeda (Herschel, far infrared; turned and cropped to landscape)',
    credit: 'ESA/Herschel/PACS & SPIRE Consortium, O. Krause, HSC, H. Linz',
    source: 'https://sci.esa.int/web/herschel/-/57934-cool-andromeda',
    usedFor: 'Activity',
    match: 'similar',
  },
  carina: {
    title: 'Carina Nebula',
    credit: 'NASA, ESA, N. Smith (University of California, Berkeley), and The Hubble Heritage Team (STScI/AURA)',
    source: 'https://esahubble.org/images/heic0707a/',
    usedFor: 'Settings',
    match: 'exact',
  },
  cosmicreef: {
    title: 'Cosmic Reef (NGC 2014 and NGC 2020)',
    credit: 'NASA, ESA, and STScI',
    source: 'https://esahubble.org/images/heic2007a/',
    usedFor: 'Study plan (landing page)',
    match: 'exact',
  },
  ngc2207: {
    title: 'NGC 2207 and IC 2163',
    credit: 'NASA/ESA and The Hubble Heritage Team (STScI)',
    source: 'https://esahubble.org/images/opo9941a/',
    usedFor: 'Khaali screens',
    match: 'exact',
  },
  'andromeda-visible': {
    title: 'Andromeda galaxy (turned 180 degrees, as in the reference)',
    credit: 'Luis Felipe Alburquerque Briganti on Pexels',
    source: 'https://www.pexels.com/photo/stunning-view-of-andromeda-galaxy-in-space-34362735/',
    usedFor: 'Error aur offline screens',
    match: 'exact',
  },
  'antennae-hubble': {
    title: 'Antennae galaxies (Hubble)',
    credit: 'NASA, ESA, and the Hubble Heritage Team (STScI/AURA)-ESA/Hubble Collaboration. Acknowledgement: B. Whitmore (STScI) and James Long (ESA/Hubble)',
    source: 'https://esahubble.org/images/heic0615a/',
    usedFor: 'Loading',
    match: 'exact',
  },
  milkyway: {
    title: 'Milky Way in dark sky',
    credit: 'Alicia Zinn on Pexels',
    source: 'https://www.pexels.com/photo/milky-way-in-dark-sky-11564053/',
    usedFor: 'Landing page (intro)',
    match: 'similar',
  },
  'milkyway-mountains': {
    title: 'Starry night sky over mountains',
    credit: 'Adi K on Pexels',
    source: 'https://www.pexels.com/photo/starry-night-sky-over-starry-night-3222255/',
    usedFor: 'Landing page (teen kadam)',
    match: 'exact',
  },
  startrails: {
    title: 'Long exposure photo of stars on night sky',
    credit: 'Daria Rohova on Pexels',
    source: 'https://www.pexels.com/photo/long-exposure-photo-of-stars-on-night-sky-19824838/',
    usedFor: 'Page transitions',
    match: 'similar',
  },
  aurora: {
    title: 'Nordlichter (northern lights)',
    credit: 'Oliver Schröder on Pexels',
    source: 'https://www.pexels.com/photo/nordlichter-28237726/',
    usedFor: 'Landing page (Voice: Hindi, English, Hinglish)',
    match: 'similar',
  },
  'earth-horizon': {
    title: "Earth's horizon at sunset from the International Space Station (iss068e022267)",
    credit: 'NASA',
    source: 'https://images.nasa.gov/details/iss068e022267',
    usedFor: 'Landing page (aakhri hissa)',
    match: 'similar',
  },
  'earth-night': {
    title: 'The Nile and its delta at night from the International Space Station (iss030e112822)',
    credit: 'NASA',
    source: 'https://images.nasa.gov/details/iss030e112822',
    usedFor: 'Notifications aur raat ka recap',
    match: 'similar',
  },
};

export const photoUrl = (id, variant) => `/bg/${id}-${variant}.webp`;
