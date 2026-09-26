// Assemble the zombie style gallery from the final renders.
//   node art/zombies/build-gallery.mjs [--record] [--styles other-styles.json]
// Reads output/art/zombies/<id>/{three_quarter,front,side,back}.png, turntable/f_NN.png,
// meta.json and concepts/<id>.png, plus art/zombies/styles.json and notes.json.
// Writes output/art/zombies/gallery/index.html and a/<id>/*.jpg (a spin sprite of
// 24 frames in a 6x4 grid). --record also copies the hero render and concept into
// art/zombies/renders/ so the chosen looks live in the repo.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'output/art/zombies';
const OUT = join(SRC, 'gallery');
const record = process.argv.includes('--record');
const si = process.argv.indexOf('--styles');
const styles = JSON.parse(readFileSync(si > 0 ? process.argv[si + 1] : 'art/zombies/styles.json', 'utf8'));
const notes = existsSync('art/zombies/notes.json') ? JSON.parse(readFileSync('art/zombies/notes.json', 'utf8')) : {};
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' });

const data = [];
for (const s of styles) {
  const dir = join(SRC, s.id);
  if (!existsSync(join(dir, 'three_quarter.png'))) { console.log(`skip ${s.id}: no final renders yet`); continue; }
  const n = notes[s.id] || {};
  const out = join(OUT, 'a', s.id);
  mkdirSync(out, { recursive: true });
  const pixel = !!n.pixel;
  // Pixel-art styles keep their native 300x400 pixel grid as PNG (the page scales
  // them up with image-rendering: pixelated); everything else is JPEG.
  const ext = pixel ? 'png' : 'jpg';
  const size = pixel ? ['-vf', 'scale=300:400:flags=neighbor'] : ['-q:v', '3'];
  const img = {};
  for (const v of ['three_quarter', 'front', 'side', 'back']) {
    const p = join(dir, `${v}.png`);
    if (!existsSync(p)) continue;
    ff('-i', p, ...size, join(out, `${v}.${ext}`));
    img[v] = `a/${s.id}/${v}.${ext}`;
  }
  const frames = existsSync(join(dir, 'turntable')) ? readdirSync(join(dir, 'turntable')).filter((f) => /^f_\d\d\.png$/.test(f)) : [];
  if (frames.length === 24) {
    ff('-framerate', '1', '-i', join(dir, 'turntable', 'f_%02d.png'),
      '-vf', pixel ? 'scale=300:400:flags=neighbor,tile=6x4' : 'scale=450:600:flags=lanczos,tile=6x4',
      '-frames:v', '1', ...(pixel ? [] : ['-q:v', '4']), join(out, `spin.${ext}`));
    img.spin = `a/${s.id}/spin.${ext}`;
  } else {
    console.log(`${s.id}: ${frames.length} turntable frames (need 24), spin disabled`);
  }
  const concept = join(SRC, 'concepts', `${s.id}.png`);
  if (existsSync(concept)) {
    ff('-i', concept, '-vf', 'scale=1600:-2:flags=lanczos', '-q:v', '4', join(out, 'concept.jpg'));
    img.concept = `a/${s.id}/concept.jpg`;
  }
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
  data.push({
    id: s.id, name: s.name, tagline: s.tagline.replace(/\s*\(bonus\)/, ''), bonus: /bonus/.test(s.tagline), pixel,
    pitch: n.pitch, axes: n.axes, tech: n.tech, strong: n.strong, weak: n.weak, game: n.game,
    meta: { tris: meta.tris, height_m: meta.height_m, engine: meta.engine === 'CYCLES' ? 'CYCLES' : 'EEVEE', render_s: meta.render_s },
    img,
  });
  if (record) {
    mkdirSync('art/zombies/renders', { recursive: true });
    copyFileSync(join(out, `three_quarter.${ext}`), `art/zombies/renders/${s.id}.${ext}`);
    if (img.concept) copyFileSync(join(out, 'concept.jpg'), `art/zombies/renders/${s.id}-concept.jpg`);
  }
  console.log(`${s.id}: ${Object.keys(img).join(', ')}`);
}

const tpl = readFileSync('art/zombies/gallery.html', 'utf8');
const json = JSON.stringify(data).replace(/</g, '\\u003c');
writeFileSync(join(OUT, 'index.html'), tpl.replace('/*__DATA__*/null', json));
console.log(`gallery: ${data.length} styles -> ${join(OUT, 'index.html')}`);
