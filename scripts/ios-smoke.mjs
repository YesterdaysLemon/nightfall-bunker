// Headless, muted iPhone check in WebKit (Safari's engine): the install tip,
// the web app manifest and icons, canvas sized to the visible viewport, and
// touch controls plus a lit (non-black) frame after tapping Play.
//   npm run build && node scripts/ios-smoke.mjs [--url <site>]

import { webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ui = args.indexOf('--url');
let base = ui >= 0 ? args[ui + 1] : null;
let server = null;
if (!base) {
  const port = 18700 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}
mkdirSync('output/ios', { recursive: true });

const errors = [];
const results = {};
const check = (name, ok, detail) => { results[name] = ok ? 'ok' : `FAIL ${detail ?? ''}`; if (!ok) errors.push(`${name}: ${detail ?? ''}`); };
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(900);
  const webgl = await page.evaluate(() => !!window.__game);
  results.webgl = webgl ? 'available' : 'unavailable in this headless WebKit build (UI checks only)';

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  const manifest = await (await fetch(new URL(manifestHref, base))).json();
  check('manifest is fullscreen landscape', manifest.display === 'fullscreen' && manifest.orientation === 'landscape');
  for (const icon of [...manifest.icons.map((i) => i.src), '/icons/apple-touch-icon.png']) {
    const r = await fetch(new URL(icon, base));
    check(`icon ${icon}`, r.ok && (r.headers.get('content-type') || '').includes('image/png'), r.status);
  }
  check('apple home-screen meta', (await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content')) === 'yes');

  const tip = await page.evaluate(() => (document.getElementById('install').hidden ? '' : document.getElementById('installText').textContent));
  check('iPhone install tip shown', /Add to Home Screen/.test(tip), `"${tip}"`);
  await page.screenshot({ path: 'output/ios/menu.png' });

  const sizes = await page.evaluate(() => ({ canvas: document.getElementById('view').getBoundingClientRect().height, vis: innerHeight }));
  check('canvas fits the visible height', Math.abs(sizes.canvas - sizes.vis) <= 1, JSON.stringify(sizes));

  if (webgl) {
    await page.tap('#btnSolo');
    await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 15000 });
    await page.waitForTimeout(800);
    check('touch controls shown after Play', await page.evaluate(() => !document.getElementById('touch').hidden && document.body.classList.contains('touch')));
    // Headless WebKit page screenshots show a WebGL canvas as black, so read the
    // frame from inside the render loop instead (the HUD shot is still useful).
    await page.screenshot({ path: 'output/ios/playing-hud.png' });
    const frame = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
      const gl = window.__game.rig.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      res({ luma: sum / (w * h), png: document.getElementById('view').toDataURL('image/png') });
    })));
    writeFileSync('output/ios/playing-frame.png', Buffer.from(frame.png.split(',')[1], 'base64'));
    check('bunker renders after Play', frame.luma > 10, `mean luminance ${frame.luma.toFixed(1)}`);
  }
  await page.tap('#btnInstallDismiss').catch(() => {});
} catch (err) {
  errors.push(`harness: ${err.message}`);
  await page.screenshot({ path: 'output/ios/failure.png' }).catch(() => {});
} finally {
  await browser.close();
  server?.kill();
}
console.log(JSON.stringify({ ok: errors.length === 0, results, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
