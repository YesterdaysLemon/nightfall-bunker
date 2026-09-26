// Run a zombie style script in headless Blender and print only the useful lines.
//   node art/zombies/blend.mjs z_plush.py [--preview|--final] [--views a,b] [--res WxH] [--frames N]
// --final runs take turns on the GPU (a lock directory), previews run freely.
// Set BLENDER to override the executable path.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('usage: node art/zombies/blend.mjs <z_style.py> [--preview|--final] [...]');
  process.exit(2);
}
const final = args.includes('--final');
const lock = join(here, '..', '..', 'output', 'art', 'zombies', '.final-lock');

async function acquire() {
  mkdirSync(dirname(lock), { recursive: true });
  for (let waited = 0; ; waited += 5) {
    try { mkdirSync(lock); return; } catch {
      // Break a lock left by a crashed run (older than 20 minutes).
      try { if (Date.now() - statSync(lock).mtimeMs > 20 * 60e3) rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ }
      if (waited % 60 === 0) console.log(`waiting for another final render (${waited}s)`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (final) await acquire();
const release = () => { if (final) rmSync(lock, { recursive: true, force: true }); };
process.on('SIGINT', () => { release(); process.exit(130); });

const path = script.includes('/') || script.includes('\\') ? script : join(here, script);
const p = spawn(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', path, '--', ...args],
  { stdio: ['ignore', 'pipe', 'pipe'] });
let tail = [];
const onLine = (line) => {
  if (!line.trim() || /^Fra:|^\s*\d\d:\d\d\.\d+\s+render\s/.test(line)) return;
  tail.push(line); if (tail.length > 400) tail = tail.slice(-200);
  if (/^\[|Error|Traceback|error:|Warning: |File "/.test(line) || /^\s{2,}\S/.test(line)) console.log(line);
};
let buf = '';
for (const s of [p.stdout, p.stderr]) {
  s.setEncoding('utf8');
  s.on('data', (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
}
p.on('close', (code) => {
  if (buf) onLine(buf);
  release();
  if (code) console.log(`blender exited with ${code}; last lines:\n${tail.slice(-25).join('\n')}`);
  process.exit(code ?? 1);
});
