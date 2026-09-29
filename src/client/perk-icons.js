// Perk icons for the HUD: a small pixel-art roundel per perk in the 1997 style
// (art/STYLE.md), the perk's colour with a simple symbol. Each is painted on a
// 32 x 32 grid, scaled up with hard pixels and cached as a data URL.
//
// PERK_SYMBOLS and perkRamp() are shared with the machines (render/machines.js):
// the same symbol sits in each machine's lit window and on its bottles.

import { PERKS } from '../shared/perks.js';

// 16 x 16 symbols: '#' body, 'o' shade, '+' highlight, '.' empty. The icon adds
// a dark outline around them.
export const PERK_SYMBOLS = {
  // a riveted heater shield
  ironclad: [
    '................',
    '.oooooooooooooo.',
    '.o+##########+o.',
    '.o############o.',
    '.o#####oo#####o.',
    '.o#####oo#####o.',
    '.o+####oo####+o.',
    '.o#####oo#####o.',
    '..o####oo####o..',
    '..o####oo####o..',
    '...o###oo###o...',
    '...o+##oo##+o...',
    '....o##oo##o....',
    '.....o#oo#o.....',
    '......oooo......',
    '................',
  ],
  // a phoenix feather: the quill runs corner to corner
  lazarus: [
    '................',
    '............##..',
    '..........###o..',
    '.........###+oo.',
    '........###+ooo.',
    '.......###+ooo..',
    '......###+ooo...',
    '.....##.+ooo....',
    '....###+oo.o....',
    '...###+ooo......',
    '...##+ooo.......',
    '....+oo.........',
    '...+............',
    '..+.............',
    '.+..............',
    '................',
  ],
  // a mercury drop with a hard highlight
  quicksilver: [
    '................',
    '.......##.......',
    '.......##.......',
    '......####......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '...#++######o...',
    '..#++########o..',
    '..#+#########o..',
    '..###########o..',
    '...#######ooo...',
    '....##oooooo....',
    '......oooo......',
    '................',
  ],
  // a double chevron
  hairtrigger: [
    '................',
    '.....++++++.....',
    '....###..###....',
    '...###....###...',
    '..###......###..',
    '.###........###.',
    'ooo..........ooo',
    '................',
    '.....++++++.....',
    '....###..###....',
    '...###....###...',
    '..###......###..',
    '.###........###.',
    'ooo..........ooo',
    '................',
    '................',
  ],
};

// --- Colour ----------------------------------------------------------------------------------

function hexRGB(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hsl2rgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// Move hue h toward `target` by at most d (the short way round).
function toward(h, target, d) {
  const diff = ((target - h + 1.5) % 1) - 0.5;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), d) + 1) % 1;
}

/**
 * A ramp of `n` colours (0..255 RGB, dark to light) from a perk colour, hue-
 * shifted like the world ramps: cool shadows, warm highlights, and a little
 * less saturated than the source so nothing out-shouts the blood or the chalk.
 */
export function perkRamp(hex, n = 8, { lo = 0.08, hi = 0.64, sat = 0.82 } = {}) {
  const [h, s] = rgb2hsl(hexRGB(hex));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const hh = t < 0.5 ? toward(h, 0.66, (0.5 - t) * 0.09) : toward(h, 0.14, (t - 0.5) * 0.07);
    out.push(hsl2rgb(hh, Math.min(1, s * sat * (0.78 + 0.3 * t)), lo + (hi - lo) * t));
  }
  return out;
}

// --- Icons -----------------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const BRASS = [[46, 36, 22], [70, 55, 32], [96, 76, 42], [122, 98, 54], [148, 122, 70], [174, 147, 90], [198, 172, 116], [222, 202, 156]];
const INK = [18, 14, 13];
const CREAM = { '#': [226, 214, 182], o: [168, 150, 118], '+': [252, 246, 226] };

const pick = (ramp, v) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];

// The 32 x 32 roundel as RGBA bytes.
function paintIcon(id) {
  const N = 32, px = new Uint8ClampedArray(N * N * 4);
  const ramp = perkRamp(PERKS[id].color, 8, { lo: 0.1, hi: 0.7, sat: 0.9 });
  const sym = PERK_SYMBOLS[id];
  const put = (x, y, c, a = 255) => { const i = (y * N + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a; };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - 16, dy = y + 0.5 - 16, r = Math.hypot(dx, dy);
      const d = BAYER4[(y & 3) * 4 + (x & 3)];
      const lit = (-dx * 0.6 - dy * 0.8) / Math.max(r, 1); // lamp above-left
      if (r > 15.6) continue;
      if (r > 14.6) put(x, y, INK);
      else if (r > 12.4) put(x, y, pick(BRASS, 0.52 + 0.32 * lit + d * 0.14));     // brass bezel
      else if (r > 11.5) put(x, y, pick(ramp, 0.02));                               // groove
      else put(x, y, pick(ramp, 0.5 + 0.2 * lit * (r / 11.5) - 0.18 * (r / 11.5) ** 2 + d * 0.16));
    }
  }
  // the symbol, centred, with a hard dark outline
  const at = (x, y) => (x >= 0 && y >= 0 && x < 16 && y < 16 ? sym[y][x] : '.');
  for (let y = -1; y <= 16; y++) {
    for (let x = -1; x <= 16; x++) {
      const c = at(x, y);
      if (c !== '.') put(x + 8, y + 8, CREAM[c] || CREAM['#']);
      else if (at(x - 1, y) !== '.' || at(x + 1, y) !== '.' || at(x, y - 1) !== '.' || at(x, y + 1) !== '.') put(x + 8, y + 8, pick(ramp, 0));
    }
  }
  return px;
}

const cache = new Map();

/** A data URL for perk `perkId`'s roundel at `size` pixels (hard-edged, cached). */
export function perkIcon(perkId, size = 64) {
  const key = `${perkId}:${size}`;
  if (cache.has(key)) return cache.get(key);
  if (!PERKS[perkId] || !PERK_SYMBOLS[perkId] || typeof document === 'undefined') return '';
  const src = document.createElement('canvas');
  src.width = src.height = 32;
  src.getContext('2d').putImageData(new ImageData(paintIcon(perkId), 32, 32), 0, 0);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, size, size);
  const url = out.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
