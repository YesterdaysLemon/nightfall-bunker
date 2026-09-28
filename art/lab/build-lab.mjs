// Builds the Model Workshop page: inlines editops.mjs into workshop.html and copies
// the game's exported models next to it.
//   node art/lab/build-lab.mjs          -> output/lab/index.html + output/lab/models/*
// The page is published as an Artifact with the model files as supporting files.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const out = join(repo, 'output', 'lab');
mkdirSync(join(out, 'models'), { recursive: true });

const ops = readFileSync(join(here, 'editops.mjs'), 'utf8').replace(/^export /gm, '');
const page = readFileSync(join(here, 'workshop.html'), 'utf8');
if (!page.includes('/*__EDITOPS__*/')) throw new Error('workshop.html lost its /*__EDITOPS__*/ marker');
writeFileSync(join(out, 'index.html'), page.replace('/*__EDITOPS__*/', () => ops));

const models = join(repo, 'public', 'models');
const files = readdirSync(models).filter((f) => /\.(json|png)$/.test(f));
for (const f of files) copyFileSync(join(models, f), join(out, 'models', f));
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.fromEntries(files.map((f) => [`models/${f}`, `output/lab/models/${f}`])), null, 1));
console.log(`output/lab/index.html + ${files.length} model files`);
