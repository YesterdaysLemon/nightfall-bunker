// Silent audio regression check. Renders the real engine through an
// OfflineAudioContext in headless Chromium (nothing reaches a speaker) and
// asserts that direction, distance and wall occlusion are audible; that every
// gun and every Picture Palace voice renders finite, audible and unclipped;
// that loops (traps, jingles, ambiences, the boss bed) stop on stop(),
// stopAmbience() and silence(); and that music-bus sounds follow the volumes.
//
//   npm run audio-check

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>audio</title>'); }
  // The engine and the shared modules it imports (anything .js under src/).
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, 'src') + path.sep) || !file.endsWith('.js')) { res.writeHead(404); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base);
const m = await page.evaluate(async (base) => {
  const SR = 48000;
  let LEN = 1.6;
  class Offline extends OfflineAudioContext {
    constructor() { super(2, Math.round(SR * LEN), SR); }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); }
    go() { return super.resume(); }   // continue after a scheduled suspend()
  }
  window.AudioContext = Offline;
  const { AudioEngine, GUN_SOUNDS, PERK_JINGLES } = await import(`${base}/src/client/audio.js`);
  const { PERK_IDS } = await import(`${base}/src/shared/perks.js`);
  const engine = (len = 1.6, opts = {}) => {
    LEN = len;
    const e = new AudioEngine({ masterVolume: 0.8, ...opts });
    e.unlock();
    LEN = 1.6;
    e.setListener(0, 1.6, 0, 0, 0, -1, 0, 1, 0);   // facing -Z, right is +X
    return e;
  };
  const render = async (setup) => {
    const e = engine();
    setup(e);
    const b = await e.ctx.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1);
    let e2 = 0, hl = 0, hr = 0, hf = 0;
    for (let i = 2; i < L.length; i++) {
      e2 += L[i] * L[i] + R[i] * R[i];
      const a = L[i] - 2 * L[i - 1] + L[i - 2], c = R[i] - 2 * R[i - 1] + R[i - 2];
      hl += a * a; hr += c * c; hf += a * a + c * c;
    }
    return { rms: Math.sqrt(e2), hl: Math.sqrt(hl), hr: Math.sqrt(hr), bright: Math.sqrt(hf) / Math.sqrt(e2) };
  };
  const shot = (pos, occ = 0) => (e) => { e.occlusion = () => occ; e.gunshot('rifle', pos); };
  const db = (a, b) => 20 * Math.log10(a / b);
  const right = await render(shot({ x: 5, y: 1.6, z: 0 }));
  const left = await render(shot({ x: -5, y: 1.6, z: 0 }));
  const near = await render(shot({ x: 0, y: 1.6, z: -3 }));
  const far = await render(shot({ x: 0, y: 1.6, z: -20 }));
  const open = await render(shot({ x: 0, y: 1.6, z: -8 }, 0));
  const wall = await render(shot({ x: 0, y: 1.6, z: -8 }, 1));
  let tracked = 0;
  await render((e) => { const h = e.zombieGroan({ x: 2, y: 1.6, z: -2 }, 3); if (h && typeof h.move === 'function') { h.move(-2, 1.6, -2); tracked = 1; } });
  const spatial = {
    rightEarHighs_dB: db(right.hr, right.hl),
    leftEarHighs_dB: db(left.hl, left.hr),
    near3m_vs_far20m_dB: db(near.rms, far.rms),
    behindWall_quieter_dB: db(open.rms, wall.rms),
    behindWall_duller_dB: db(open.bright, wall.bright),
    zombieVoicesFollow: tracked,
  };

  // Render `setup(e)` for `len` s. `at` = [[time, fn(e, handle)]]: run when rendering reaches that
  // time. Returns non-finite samples, peak, clipped samples, the loudest 50 ms (plain, and above
  // 200 Hz as a rough ear-weighted level), the last audible 50 ms (-60 dBFS), RMS inside the `win`
  // windows, and the mono mix (for band measurements).
  const study = async (setup, { len = 3, opts = {}, at = [], win = [] } = {}) => {
    const e = engine(len, opts), handle = setup(e);
    for (const [time, fn] of at) e.ctx.suspend(time).then(() => { fn(e, handle); return e.ctx.go(); });
    const b = await e.ctx.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1), n = L.length;
    const k200 = 1 - Math.exp((-2 * Math.PI * 200) / SR), H = new Float32Array(n), M = new Float32Array(n);
    let bad = 0, peak = 0, clip = 0, l200 = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) { bad++; L[i] = R[i] = 0; }
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      M[i] = (L[i] + R[i]) / 2;
      l200 += k200 * (M[i] - l200); H[i] = M[i] - l200;
    }
    const span = (a, z) => [Math.floor(a * SR), Math.min(n, Math.floor(z * SR))];
    const rms = (a, z) => {
      const [i0, i1] = span(a, z);
      let s = 0;
      for (let i = i0; i < i1; i++) s += L[i] * L[i] + R[i] * R[i];
      return Math.sqrt(s / Math.max(1, 2 * (i1 - i0)));
    };
    const rmsOf = (X, a, z) => {
      const [i0, i1] = span(a, z);
      let s = 0;
      for (let i = i0; i < i1; i++) s += X[i] * X[i];
      return Math.sqrt(s / Math.max(1, i1 - i0));
    };
    let loud = 0, hp = 0, last = 0;
    for (let s = 0; s + 0.05 <= len + 1e-9; s += 0.05) {
      const r = rms(s, s + 0.05);
      if (r > loud) loud = r;
      if (r > 1e-3) last = s + 0.05;
      hp = Math.max(hp, rmsOf(H, s, s + 0.05));
    }
    // RMS of the mono mix through an RBJ biquad ('lowpass' | 'bandpass') inside [a, z] s.
    const band = (type, f, q, a, z) => {
      const w = (2 * Math.PI * f) / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
      const [b0, b1, b2] = type === 'lowpass' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [al, 0, -al];
      const Y = new Float32Array(n);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const y = (b0 * M[i] + b1 * x1 + b2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0;
        x2 = x1; x1 = M[i]; y2 = y1; y1 = y; Y[i] = y;
      }
      return rmsOf(Y, a, z);
    };
    return { e, handle, bad, peak, clip, loud, hp, last, win: win.map(([a, z]) => rms(a, z)), band };
  };

  // Every voice: finite, audible, not clipping.
  const at3 = { x: 0, y: 1.6, z: -3 };
  const cases = [];
  for (const k of GUN_SOUNDS) cases.push([`gun:${k}`, (e) => e.gunshot(k, at3), 2]);
  for (const k of ['rifle', 'magnum', 'smg', 'shotgun', 'rocket', 'arc', 'tesla', 'gale']) cases.push([`gun:${k}+up`, (e) => e.gunshot(k, null, true), 2]);
  cases.push(['gun:gale(own)', (e) => e.gunshot('gale'), 2]);
  for (const id of PERK_JINGLES) cases.push([`jingle:${id}`, (e) => e.perkJingle(id, at3), 12]);
  cases.push(['jingle:unknown-perk', (e) => e.perkJingle('someNewPerk', at3), 12]);
  cases.push(['perkDrink', (e) => e.perkDrink(), 3]);
  cases.push(['powerOn', (e) => e.powerOn(), 6]);
  for (const s of ['take', 'work', 'done']) cases.push([`forge:${s}`, (e) => e.forge(s, at3), 5]);
  for (const s of ['link', 'linked', 'charge', 'warp', 'return']) cases.push([`teleport:${s}`, (e) => e.teleport(s, at3), 4]);
  cases.push(['teleport:warp(own)', (e) => e.teleport('warp'), 4]);
  cases.push(['trap', (e) => e.trap(at3), 3]);
  cases.push(['trapZap', (e) => e.trapZap(at3), 2]);
  cases.push(['boxLeave', (e) => e.boxLeave(at3), 5]);
  cases.push(['boxLand', (e) => e.boxLand(at3), 3]);
  cases.push(['boxReady', (e) => e.boxReady(at3), 3]);
  cases.push(['stun', (e) => e.stun(at3), 2]);
  cases.push(['crawl', (e) => e.crawl(at3, 7), 2.5]);
  cases.push(['ambience:palace', (e) => e.ambience('palace'), 6]);
  cases.push(['ambience:bunker', (e) => e.startAmbience(), 6]);
  cases.push(['palace:creak', (e) => e._creak(0.1), 3]);
  cases.push(['palace:settle', (e) => e._settle(0.1), 3]);
  cases.push(['palace:doorGust', (e) => e._doorGust(0.1), 3]);
  // Existing sounds, for level reference only (listed, not checked).
  cases.push(['ref:zombieGroan', (e) => e.zombieGroan(at3, 3), 3]);
  cases.push(['ref:explosion', (e) => e.explosion({ x: 0, y: 1.6, z: -6 }), 3]);
  cases.push(['ref:boxJingle', (e) => e.boxJingle(at3, 4.2), 5]);
  cases.push(['ref:radioSong', (e) => e.radioSong(at3), 6]);
  cases.push(['ref:roundStart', (e) => e.roundStart(5), 4]);
  const voices = {};
  const dB = (x) => 20 * Math.log10(x || 1e-9);
  for (const [name, setup, len] of cases) {
    const r = await study(setup, { len });
    voices[name] = { bad: r.bad, loud_dB: dB(r.loud), hp_dB: dB(r.hp), peak: r.peak, clip: r.clip, last: r.last };
  }

  // Loops stop: stop() on a trap and a jingle, stopAmbience() on either map, and silence() on all
  // of them at once (plus the boss bed, a forge and a teleporter mid-sound).
  const stops = {};
  const stopCase = async (name, setup, when, fn, len) => {
    const r = await study(setup, { len, at: [[when, fn]], win: [[when - 0.8, when], [len - 0.6, len]] });
    stops[name] = { before_dB: 20 * Math.log10(r.win[0] || 1e-9), after_dB: 20 * Math.log10(r.win[1] || 1e-9), e: r.e };
  };
  await stopCase('trap.stop()', (e) => e.trap(at3), 1.5, (e, h) => h.stop(), 4.5);
  await stopCase('trap/silence()', (e) => e.trap(at3), 1.5, (e) => e.silence(), 4.5);
  await stopCase('jingle.stop()', (e) => e.perkJingle('quicksilver', at3), 2, (e, h) => h.stop(), 5);
  await stopCase('palace/stopAmbience()', (e) => e.ambience('palace'), 3, (e) => e.stopAmbience(0.5), 6);
  await stopCase('bunker/stopAmbience()', (e) => e.startAmbience(), 3, (e) => e.stopAmbience(0.5), 6);
  await stopCase('everything/silence()', (e) => {
    e.trap(at3); e.trap({ x: 3, y: 1.6, z: -1 }); e.perkJingle('ironclad', at3); e.perkJingle('lazarus', { x: -2, y: 1.6, z: -4 });
    e.ambience('palace'); e.forge('work', at3); e.teleport('charge', at3); e.powerOn(); e.bossMusic();
  }, 1.4, (e) => e.silence(), 4.5);
  const all = stops['everything/silence()'].e;
  await new Promise((r) => setTimeout(r, 700));   // let a leaked boss timer (250 ms) show itself
  const leftover = all.voices.filter((v) => !v.dying && !v.done).length + (all._boss ? 1 : 0) + (all._amb ? 1 : 0) + all._loops.length;
  for (const s of Object.values(stops)) delete s.e;

  // Starting the other map's ambience replaces the first one.
  const sw = engine(1);
  sw.ambience('bunker'); sw.ambience('palace'); sw.ambience('palace');
  const ambSwitch = sw._amb?.kind === 'palace' && sw.voices.filter((v) => v.bg && !v.dying).length === 1;

  // Volumes: jingles and ambience are music; everything follows the master volume.
  const mute = async (setup, opts, len = 3) => (await study(setup, { len, opts })).peak;
  const vol = {
    jingle_music0: await mute((e) => e.perkJingle('hairtrigger', at3), { musicVolume: 0 }),
    palace_music0: await mute((e) => e.ambience('palace'), { musicVolume: 0 }, 5),
    trap_master0: await mute((e) => e.trap(at3), { masterVolume: 0 }),
    powerOn_master0: await mute((e) => e.powerOn(), { masterVolume: 0 }),
  };
  const jHalf = await study((e) => e.perkJingle('ironclad', at3), { len: 4, opts: { musicVolume: 0.25 } });
  const jFull = await study((e) => e.perkJingle('ironclad', at3), { len: 4, opts: { musicVolume: 1 } });
  vol.jingle_music_quarter_vs_full_dB = 20 * Math.log10(jFull.loud / jHalf.loud);

  // An upgraded shot: more sub-bass (below 70 Hz), and a metallic shimmer ringing on after the
  // crack. The shimmer is measured over its ring (0.2-1.5 s) in a band about one critical band wide
  // around each of its partials (3.4, 5.2, 7.9 kHz), keeping the best: +3 dB means that partial is
  // at least as strong as the shot's own sound there, so it isn't masked. Measured with the master low enough that
  // the limiter stays out of it: the loudest guns already lean on it. The shotgun, rocket and gale
  // already boom down to ~30 Hz at full level, so for them only the shimmer is checked.
  const upgraded = {};
  for (const k of ['pistol', 'rifle', 'smg', 'shotgun', 'magnum', 'rocket', 'arc', 'tesla', 'gale']) {
    const opts = { masterVolume: 0.15 };
    const up = await study((e) => e.gunshot(k, at3, true), { len: 1.6, opts });
    const plain = await study((e) => e.gunshot(k, at3), { len: 1.6, opts });
    upgraded[k] = {
      sub_dB: ['shotgun', 'rocket', 'gale'].includes(k) ? null : dB(up.band('lowpass', 70, 0.7, 0, 0.5)) - dB(plain.band('lowpass', 70, 0.7, 0, 0.5)),
      shimmer_dB: Math.max(...[[3400, 5], [5230, 6], [7890, 7]].map(([f, q]) => dB(up.band('bandpass', f, q, 0.2, 1.5)) - dB(plain.band('bandpass', f, q, 0.2, 1.5)))),
    };
  }

  // A running trap follows the walls: a wall appearing between you makes it quieter.
  const occ = await study((e) => e.trap({ x: 0, y: 1.6, z: -5 }), {
    len: 3, at: [[1.2, (e) => { e.occlusion = () => 1; e.update(0.016); }]], win: [[0.5, 1.2], [2.2, 3]],
  });
  const trap_behind_wall_dB = 20 * Math.log10(occ.win[0] / occ.win[1]);

  return {
    spatial, voices, stops, leftover, ambSwitch, vol, upgraded, trap_behind_wall_dB,
    jinglesCoverPerks: PERK_IDS.filter((id) => !PERK_JINGLES.includes(id)),
    hasMagnum: GUN_SOUNDS.includes('magnum'),
  };
}, base);
await browser.close();
server.close();

const s = m.spatial;
const checks = [
  ['sound to the right is louder in the right ear', s.rightEarHighs_dB >= 12],
  ['sound to the left is louder in the left ear', s.leftEarHighs_dB >= 12],
  ['far sounds are much quieter than near ones', s.near3m_vs_far20m_dB >= 17],
  ['walls make sounds quieter', s.behindWall_quieter_dB >= 5],
  ['walls make sounds duller', s.behindWall_duller_dB >= 6],
  ['zombie voices can follow a moving zombie', s.zombieVoicesFollow === 1],
  ['the magnum is a gun sound', m.hasMagnum],
  ['every perk has a jingle', m.jinglesCoverPerks.length === 0],
];
for (const [name, r] of Object.entries(m.voices)) {
  if (name.startsWith('ref:')) continue;
  checks.push([`${name}: finite`, r.bad === 0]);
  checks.push([`${name}: audible`, r.loud_dB > -40]);
  checks.push([`${name}: not clipping`, r.clip === 0 && r.peak < 1]);
}
for (const [name, r] of Object.entries(m.voices)) {
  if (name.startsWith('jingle:')) checks.push([`${name}: plays ~6-10 s`, r.last >= 6 && r.last <= 11]);
}
for (const [name, r] of Object.entries(m.stops)) {
  checks.push([`${name}: playing before`, r.before_dB > -45]);
  checks.push([`${name}: silent after`, r.after_dB < -80]);
}
checks.push(['silence() leaves no live voice, loop, ambience or boss timer', m.leftover === 0]);
checks.push(['another map\'s ambience replaces the first', m.ambSwitch]);
for (const [name, v] of Object.entries(m.vol)) {
  if (name.endsWith('_dB')) checks.push([`volume: ${name} follows the music volume`, v > 9]);
  else checks.push([`volume: ${name} is silent`, v < 1e-5]);
}
for (const [k, u] of Object.entries(m.upgraded)) {
  if (u.sub_dB != null) checks.push([`upgraded ${k}: more sub-bass`, u.sub_dB >= 1.5]);
  checks.push([`upgraded ${k}: a shimmer after the crack`, u.shimmer_dB >= 3]);
}
checks.push(['a running trap muffles behind a wall that appears', m.trap_behind_wall_dB >= 4]);

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
const col = (v, w = 6) => String(r1(v)).padStart(w);
console.log(`${'voice (3 m ahead unless own)'.padEnd(26)}  loudest  >200Hz    peak    ends`);
console.log(Object.entries(m.voices).map(([n, r]) => `${n.padEnd(26)} ${col(r.loud_dB)} dB ${col(r.hp_dB)} dB  ${r.peak.toFixed(3)}  ${col(r.last, 5)} s`).join('\n'));
console.log(JSON.stringify({
  ok: failed.length === 0, failed, checks: checks.length,
  spatial: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r1(v)])),
  stops: Object.fromEntries(Object.entries(m.stops).map(([k, v]) => [k, `${r1(v.before_dB)} -> ${r1(v.after_dB)} dB`])),
  volume: Object.fromEntries(Object.entries(m.vol).map(([k, v]) => [k, r1(v)])),
  upgraded: Object.fromEntries(Object.entries(m.upgraded).map(([k, u]) => [k, `${u.sub_dB == null ? '' : `sub +${r1(u.sub_dB)} dB, `}shimmer +${r1(u.shimmer_dB)} dB`])),
  trap_behind_wall_dB: r1(m.trap_behind_wall_dB), leftover: m.leftover,
}, null, 2));
process.exit(failed.length ? 1 : 0);
