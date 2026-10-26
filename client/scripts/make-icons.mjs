// Makes Saathi's app and notification icons from one SVG (the glowing orb face), into public/icons:
//   icon-192.png, icon-512.png   app icon (install, notifications, email logo)
//   maskable-512.png             Android adaptive icon (face kept inside the safe zone)
//   apple-touch-icon.png         iPhone home screen (180 px)
//   badge-96.png                 small monochrome badge in the Android status bar
// Run from client/: node scripts/make-icons.mjs
import sharp from 'sharp';

const face = (cx, cy, r) => `
  <circle cx="${cx}" cy="${cy}" r="${r * 1.35}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#orb)"/>
  <ellipse cx="${cx - r * 0.29}" cy="${cy - r * 0.07}" rx="${r * 0.11}" ry="${r * 0.16}" fill="#2A1A0A"/>
  <ellipse cx="${cx + r * 0.29}" cy="${cy - r * 0.07}" rx="${r * 0.11}" ry="${r * 0.16}" fill="#2A1A0A"/>
  <path d="M${cx - r * 0.29} ${cy + r * 0.29} C${cx - r * 0.14} ${cy + r * 0.47} ${cx + r * 0.14} ${cy + r * 0.47} ${cx + r * 0.29} ${cy + r * 0.29}" stroke="#2A1A0A" stroke-width="${r * 0.1}" fill="none" stroke-linecap="round"/>`;

const defs = `<defs>
  <radialGradient id="orb" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFE3A8"/><stop offset=".55" stop-color="#F2A541"/><stop offset="1" stop-color="#B8641A"/></radialGradient>
  <radialGradient id="glow"><stop offset=".55" stop-color="#F2A541" stop-opacity=".45"/><stop offset="1" stop-color="#F2A541" stop-opacity="0"/></radialGradient>
  <radialGradient id="sky" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#1E2452"/><stop offset="1" stop-color="#070914"/></radialGradient>
</defs>`;

const stars = [[0.18, 0.2], [0.8, 0.16], [0.86, 0.72], [0.12, 0.78], [0.3, 0.88], [0.72, 0.9]]
  .map(([x, y], i) => `<circle cx="${x * 512}" cy="${y * 512}" r="${i % 2 ? 2.2 : 3}" fill="#FFF3DC" opacity=".7"/>`)
  .join('');

const appIcon = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#sky)"/>${stars}${face(256, 256, rounded ? 150 : 118)}</svg>`;

// Badge: Android shows only the alpha channel, so a white orb with the face cut out.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs><mask id="m"><rect width="96" height="96" fill="#fff"/>
    <ellipse cx="36" cy="44" rx="5" ry="7" fill="#000"/><ellipse cx="60" cy="44" rx="5" ry="7" fill="#000"/>
    <path d="M35 60 C42 68 54 68 61 60" stroke="#000" stroke-width="5" fill="none" stroke-linecap="round"/></mask></defs>
  <circle cx="48" cy="48" r="42" fill="#fff" mask="url(#m)"/></svg>`;

const out = 'public/icons/';
await sharp(Buffer.from(appIcon(true))).resize(512).png().toFile(`${out}icon-512.png`);
await sharp(Buffer.from(appIcon(true))).resize(192).png().toFile(`${out}icon-192.png`);
await sharp(Buffer.from(appIcon(false))).resize(512).png().toFile(`${out}maskable-512.png`);
await sharp(Buffer.from(appIcon(false))).resize(180).png().toFile(`${out}apple-touch-icon.png`);
await sharp(Buffer.from(badge)).png().toFile(`${out}badge-96.png`);
console.log('icons written to public/icons');
