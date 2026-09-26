// Concept sheets for each zombie style, drawn by the Codex CLI's built-in image
// tool (the user's Codex login; no API key). One `codex exec` per style, in
// parallel. Codex saves images under ~/.codex/generated_images/<session-id>/
// and cannot write into this folder, so the session id is read from the log.
//   node art/zombies/concepts.mjs [id ...]
// Output: output/art/zombies/concepts/<id>.png (git-ignored); keepers are
// copied to art/zombies/concepts/<id>.jpg by build-gallery.

import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, readdirSync, statSync, copyFileSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CODEX = join(homedir(), 'AppData/Local/OpenAI/Codex/bin/codex.exe');
const GEN = join(homedir(), '.codex/generated_images');
const OUT = 'output/art/zombies/concepts';
mkdirSync(OUT, { recursive: true });

const only = new Set(process.argv.slice(2));
const styles = JSON.parse(readFileSync('art/zombies/styles.json', 'utf8')).filter((s) => !only.size || only.has(s.id));

const PREAMBLE = `You are a character concept artist for an original indie zombie game set in a
boarded-up 1940s airfield bunker at night. Call your image generation tool exactly
once, in landscape 16:9, for a character concept sheet: the same character shown
full body from the front and in three-quarter view side by side, with a small head
close-up, on a plain backdrop. No text, no logos, no watermark. Do not run shell
commands or edit files. When the image is done, reply "done".

Character and style:`;

function run(style) {
  return new Promise((resolve) => {
    const log = join(OUT, `${style.id}.log`);
    const out = createWriteStream(log);
    const p = spawn(CODEX, ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
      '-C', homedir(), `${PREAMBLE}\n${style.prompt}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(out); p.stderr.pipe(out);
    p.on('close', () => {
      const text = readFileSync(log, 'utf8');
      const m = text.match(/session id: ([0-9a-f-]+)/);
      if (!m) { console.log(`${style.id}: no session id (see ${log})`); return resolve(false); }
      let imgs = [];
      try {
        imgs = readdirSync(join(GEN, m[1])).filter((f) => f.endsWith('.png'))
          .map((f) => join(GEN, m[1], f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
      } catch { /* no folder */ }
      if (!imgs.length) { console.log(`${style.id}: no image in session ${m[1]}`); return resolve(false); }
      copyFileSync(imgs.at(-1), join(OUT, `${style.id}.png`));
      console.log(`${style.id}: ok`);
      resolve(true);
    });
  });
}

const res = await Promise.all(styles.map(run));
console.log(`${res.filter(Boolean).length}/${styles.length} concepts`);
