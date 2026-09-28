// Syntax-checks every shipped module and flags imports a file never uses
// (the build and tests cover behaviour).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const roots = ['src', 'server', 'worker', 'scripts', 'tests', 'art'];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(f)) files.push(p);
  }
};
roots.forEach(walk);
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });

// Unused imports: every name an `import` statement binds must appear again.
const problems = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/^import\s+([^'";]+?)\s+from\s+['"][^'"]+['"];?/gm)) {
    const clause = m[1];
    const names = [];
    const named = clause.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.push(n); }
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const star = rest.match(/\*\s+as\s+(\w+)/);
    if (star) names.push(star[1]);
    else for (const n of rest.split(/\s+/)) if (/^\w+$/.test(n)) names.push(n);
    const body = code.slice(0, m.index) + code.slice(m.index + m[0].length);
    for (const n of names) if (!new RegExp(`\\b${n.replace('$', '\\$')}\\b`).test(body)) problems.push(`${f}: '${n}' is imported but never used`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`checked ${files.length} files`);
