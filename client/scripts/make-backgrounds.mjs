// Turns the HD space photos in design/bg-hd/ (downloaded from their original sources, see
// CREDITS.md) into the small WebP files the app loads from public/bg/:
//   <name>-desktop.webp  1920 px wide, for laptops
//   <name>-phone.webp    900 x 1500 portrait crop, for phones
// Each file is kept under ~300 KB by lowering the quality step by step.
// Run from client/: node scripts/make-backgrounds.mjs [name ...]
import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('../design/bg-hd');
const OUT = path.resolve('public/bg');
const MAX_BYTES = 300 * 1024;
const SIZES = {
  desktop: { width: 1920, height: 1280 },
  phone: { width: 900, height: 1500 },
};

sharp.cache(false); // low-RAM laptop: do not keep decoded photos around
sharp.concurrency(1);

async function encode(input, size, file) {
  for (let quality = 70; quality >= 30; quality -= 6) {
    const info = await sharp(input, { limitInputPixels: false })
      .resize({ ...size, fit: 'cover', position: 'attention' })
      .webp({ quality, effort: 5 })
      .toFile(file);
    if (info.size <= MAX_BYTES) return { quality, size: info.size };
  }
  return { quality: 30, size: (await stat(file)).size };
}

const only = process.argv.slice(2);
const files = (await readdir(SRC)).filter((f) => f.endsWith('.jpg') && (!only.length || only.includes(path.parse(f).name)));
await mkdir(OUT, { recursive: true });
for (const f of files) {
  const name = path.parse(f).name;
  for (const [variant, size] of Object.entries(SIZES)) {
    const r = await encode(path.join(SRC, f), size, path.join(OUT, `${name}-${variant}.webp`));
    console.log(`${name}-${variant}.webp  q${r.quality}  ${Math.round(r.size / 1024)} KB`);
  }
}
