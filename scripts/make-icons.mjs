// Renders the app icons (chalk round tally on a dark bunker wall) to PNG with
// headless Chromium. Output is committed under public/icons/.
//   node scripts/make-icons.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });

// `pad` is the fraction of the canvas kept clear (maskable icons need ~10% each side).
const svg = (size, pad, rounded) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <filter id="chalk" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/>
    </filter>
    <radialGradient id="wall" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#2a241d"/>
      <stop offset="1" stop-color="#0b0d10"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="${rounded ? 18 : 0}" fill="url(#wall)"/>
  <g transform="translate(50 50) scale(${1 - pad * 2}) translate(-50 -50)" filter="url(#chalk)" stroke-linecap="round" fill="none">
    <g stroke="#c8231b" stroke-width="7.5">
      <path d="M24 22 L22 78"/><path d="M40 21 L39 79"/><path d="M56 22 L57 78"/><path d="M72 21 L74 79"/>
    </g>
    <path d="M14 70 L86 30" stroke="#ece6d6" stroke-width="7"/>
  </g>
</svg>`;

const jobs = [
  ['icon-192.png', 192, 0.08, false],
  ['icon-512.png', 512, 0.08, false],
  ['maskable-512.png', 512, 0.16, false],
  ['apple-touch-icon.png', 180, 0.1, false],
];

const browser = await chromium.launch({ headless: true });
for (const [name, size, pad, rounded] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:#0b0d10">${svg(size, pad, rounded)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('icons written');
