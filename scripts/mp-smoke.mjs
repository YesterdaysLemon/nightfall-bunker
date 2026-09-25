// Two headless, muted browsers: one creates a lobby, the other joins by code,
// the host starts, and both must see each other inside the same match.
//   node scripts/mp-smoke.mjs --url https://zombies.alirezaafshan.com

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const base = i >= 0 ? args[i + 1] : 'http://127.0.0.1:5173';
mkdirSync('output/mp', { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript((n) => { try { localStorage.setItem('nb_settings', JSON.stringify({ quality: 'low', name: n })); } catch { /* ignore */ } }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('done'), null, { timeout: 30000 });
  return page;
};

const out = {};
try {
  const host = await open('Host');
  const guest = await open('Guest');
  await host.click('#btnCreate');
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('lobbyCode').textContent), null, { timeout: 15000 });
  const code = await host.textContent('#lobbyCode');
  out.code = code;
  await guest.fill('#codeInput', code);
  await guest.click('#btnJoin');
  await host.waitForFunction(() => document.querySelectorAll('#members li:not(.empty)').length === 2, null, { timeout: 15000 });
  // Let both finish probing regions so the choice uses real pings.
  await host.waitForFunction(() => /Server:/.test(document.getElementById('regionInfo').textContent), null, { timeout: 30000 });
  await host.waitForTimeout(4000);
  out.region = await host.textContent('#regionInfo');
  await host.screenshot({ path: 'output/mp/lobby.png' });
  await host.click('#btnStart');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 20000 });
    await p.evaluate(() => { const g = window.__game; g.input.fallback = true; g.input.setLocked(true); });
  }
  await host.waitForFunction(() => window.__game.snapRows.length === 2, null, { timeout: 15000 });
  await guest.waitForFunction(() => window.__game.snapRows.length === 2, null, { timeout: 15000 });
  // The guest walks; the host must see it move.
  const before = await host.evaluate(() => [...window.__game.avatars.map.values()][0]?.x);
  await guest.evaluate(() => { const g = window.__game; g.p.x += 1.2; });
  await host.waitForTimeout(1500);
  const after = await host.evaluate(() => [...window.__game.avatars.map.values()][0]?.x);
  out.guestMovedSeenByHost = Math.abs(after - before) > 0.5;
  out.match = await host.evaluate(() => ({ region: window.__game.region, rtt: Math.round(window.__game.rtt), players: window.__game.snapRows.length }));
  await host.screenshot({ path: 'output/mp/host-in-match.png' });
  if (!out.guestMovedSeenByHost) errors.push('host did not see the guest move');
} catch (err) {
  errors.push(`harness: ${err.message}`);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ ok: errors.length === 0, errors, ...out }, null, 2));
process.exit(errors.length ? 1 : 0);
