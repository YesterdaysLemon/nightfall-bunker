// Procedural Web Audio engine: every sound is synthesized at runtime (no samples, no imports).
// Graph: voices -> [air/occlusion lowpass -> makeup -> HRTF panner] -> bus (sfx | music | dry)
//   -> master -> limiter -> out. Positional voices also send a steady, un-attenuated feed to one
// shared "bunker" convolver, so the direct/reverb ratio falls with distance like a real room.

const EPS = 1e-4;
const P_LOW = 0, P_MED = 1, P_HIGH = 2, P_CRIT = 3;
const REF_DIST = 1.5, MAX_DIST = 50, ROLLOFF = 1.35;   // exponential: steeper than life, for clarity
const HRTF_DIST = 30;       // closer than this: HRTF (front/back/height cues); beyond: cheap equal-power
const SPATIAL_GAIN = 1.7;   // makeup so nearby sounds keep their punch after the steeper falloff
const NOOP_TRACK = Object.freeze({ move() {}, stop() {} });
const NOISE_SEC = 2;
const NOOP_HANDLE = Object.freeze({ stop() {} });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const semi = (f, n) => f * Math.pow(2, n / 12);

// ---- envelope / automation helpers ------------------------------------------------------------

// Linear attack, exponential decay.
function env(p, t, a, d, peak) {
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(Math.max(peak, 2 * EPS), t + a);
  p.exponentialRampToValueAtTime(EPS, t + a + d);
}

// Attack, hold, exponential release.
function ahr(p, t, a, h, r, peak) {
  const pk = Math.max(peak, 2 * EPS);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (h > 0) p.setValueAtTime(pk, t + a + h);
  p.exponentialRampToValueAtTime(EPS, t + a + h + r);
}

function glide(p, t, v0, v1, dur) {
  p.setValueAtTime(v0, t);
  p.exponentialRampToValueAtTime(Math.max(v1, 1e-3), t + Math.max(dur, 1e-3));
}

// Random walk around `base` (zombie pitch wobble, creaks). Last point lands on base * endMul.
function wobble(p, t, dur, base, depth, steps = 5, endMul = 1) {
  p.setValueAtTime(base, t);
  for (let i = 1; i <= steps; i++) {
    const m = i === steps ? endMul : 1 + (Math.random() * 2 - 1) * depth;
    p.linearRampToValueAtTime(base * m, t + (dur * i) / steps);
  }
}

function link(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function driveCurve(k, n = 1024) {
  const c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) / norm;
  return c;
}

function seedInt(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return s | 0;
  const str = String(s ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}

function mulberry(seed) {
  let a = (seed ^ 0x9e3779b9) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validPos(p) {
  if (!p || typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  return Number.isFinite(p.y) ? p : { x: p.x, y: 0, z: p.z };
}

// ---- sound design tables ----------------------------------------------------------------------

// Formant triples (Hz): aa, oo, uh, aw, er
const VOWELS = [
  [730, 1090, 2440],
  [300, 870, 2240],
  [520, 1190, 2390],
  [570, 840, 2410],
  [490, 1350, 1690],
];

// [ratio, amplitude, decay multiplier]
const BELL = [[1, 1, 1], [2.76, 0.45, 0.45], [5.4, 0.2, 0.25]];
const BELL2 = [[1, 1, 1], [2.76, 0.35, 0.45]];
const MUSICBOX = [[1, 1, 1], [4.2, 0.2, 0.22]];

// crack: [bandpass Hz, Q, decay, peak]; snap: [decay, peak]; thump: [f0, f1, decay, peak];
// tail / body: [noise, lowpass Hz, decay, peak]
const GUNS = {
  pistol: { vol: 0.7, crack: [2400, 0.9, 0.07, 1.0], snap: [0.018, 0.5], thump: [170, 55, 0.09, 0.9], tail: ['pink', 1400, 0.3, 0.22] },
  rifle: { vol: 0.8, crack: [1900, 0.7, 0.1, 1.1], snap: [0.025, 0.6], thump: [120, 42, 0.15, 1.1], tail: ['pink', 1000, 0.55, 0.3], drive: 'soft' },
  bolt: { vol: 0.9, crack: [2600, 0.6, 0.13, 1.3], snap: [0.03, 0.8], thump: [105, 38, 0.2, 1.2], tail: ['brown', 1200, 1.1, 0.45], drive: 'soft' },
  smg: { vol: 0.55, crack: [1700, 1.0, 0.045, 0.8], thump: [190, 80, 0.055, 0.7] },
  shotgun: { vol: 0.85, crack: [1100, 0.5, 0.17, 1.3], snap: [0.03, 0.7], thump: [85, 32, 0.26, 1.4], tail: ['brown', 800, 1.0, 0.55], body: ['pink', 2400, 0.12, 0.9], drive: 'hard' },
  lmg: { vol: 0.65, crack: [1300, 0.8, 0.065, 0.95], thump: [95, 40, 0.1, 1.1], tail: ['brown', 900, 0.22, 0.2] },
};

// Radio waltz melody: [beat, length in beats, semitones from D5]. 3/4, 10 bars.
const WALTZ = [
  [0, 2, -5], [2, 1, 0], [3, 1, 3], [4, 1, 2], [5, 1, 0], [6, 2, -1], [8, 1, 2], [9, 2, 5], [11, 1, 2],
  [12, 2, 3], [14, 1, 7], [15, 2, 8], [17, 1, 5], [18, 1, -1], [19, 1, 2], [20, 1, 5], [21, 2, 3], [23, 1, 0],
  [24, 1, 2], [25, 1, -1], [26, 1, -5], [27, 3, 0],
];
const WALTZ_CHORDS = { Dm: [146.83, [293.66, 349.23, 440]], A7: [110, [277.18, 329.63, 392]], Gm: [98, [293.66, 392, 466.16]] };
const WALTZ_PROG = ['Dm', 'Dm', 'A7', 'A7', 'Dm', 'Gm', 'A7', 'Dm', 'A7', 'Dm'];
const BOX_MELODY = [0, 3, 7, 3, 12, 11, 7, 8, 7, 3, 2, -1, 0, 3, 6, 3];

export class AudioEngine {
  constructor(opts = {}) {
    const o = opts && typeof opts === 'object' ? opts : {};
    this.ctx = null;
    this.maxVoices = clamp(fin(o.maxVoices, 40), 8, 128) | 0;
    this.voices = [];
    this._mv = clamp(fin(o.masterVolume, 0.8), 0, 1);
    this._muv = clamp(fin(o.musicVolume, 0.6), 0, 1);
    this._onError = typeof o.onError === 'function' ? o.onError : null;
    this._L = { x: 0, y: 0, z: 0 };
    this._fx = 0;
    this._fz = -1;
    this._hb = 0;
    this._hbNext = 0;
    this._hbLP = 20000;
    this._gTok = 4;
    this._gT = 0;
    this._amb = null;
    this._zcache = new Map();
    this._speechVoice = null;
    // Optional (x, y, z) => 0..1 wall occlusion between listener and a source, set by the game.
    this.occlusion = null;
    // HRTF (headphones) vs equal-power stereo (speakers).
    this.hrtf = o.hrtf !== false;
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof AC !== 'function') return;
      let c;
      try { c = new AC({ latencyHint: 'interactive' }); } catch { c = new AC(); }
      this.ctx = c;
      this._build();
    }
    if (this.ctx.state !== 'running' && typeof this.ctx.resume === 'function') {
      const p = this.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !!this.buf;
  }

  setMasterVolume(v) {
    this._mv = clamp(fin(v, this._mv), 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this._mv, this.ctx.currentTime, 0.03);
  }

  setMusicVolume(v) {
    this._muv = clamp(fin(v, this._muv), 0, 1);
    if (this.music) this.music.gain.setTargetAtTime(this._muv, this.ctx.currentTime, 0.05);
  }

  // Full 3D orientation when an up vector is given (HRTF uses elevation); otherwise the forward
  // vector is flattened so looking straight up or down never produces a degenerate basis.
  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    const L = this._L;
    L.x = px; L.y = py; L.z = pz;
    const l = this.ctx && this.ctx.listener;
    if (!l) return;
    let ax = fin(fx), ay = fin(fy), az = fin(fz), bx = fin(ux), by = fin(uy, 1), bz = fin(uz);
    const full = Number.isFinite(ux) && Number.isFinite(uy) && Number.isFinite(uz) && Math.hypot(ax, ay, az) > 1e-4;
    if (!full) {
      const m = Math.hypot(ax, az);
      if (m > 1e-4) { ax /= m; az /= m; this._fx = ax; this._fz = az; } else { ax = this._fx; az = this._fz; }
      ay = 0; bx = 0; by = 1; bz = 0;
    }
    if (l.positionX) {
      l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
      l.forwardX.value = ax; l.forwardY.value = ay; l.forwardZ.value = az;
      l.upX.value = bx; l.upY.value = by; l.upZ.value = bz;
    } else {
      if (l.setPosition) l.setPosition(px, py, pz);
      if (l.setOrientation) l.setOrientation(ax, ay, az, bx, by, bz);
    }
  }

  // Handle that keeps a positional voice attached to a moving source.
  _track(v) {
    if (!v || !v.panner) return NOOP_TRACK;
    return {
      move: (x, y, z) => {
        if (v.done || !this.ctx || !Number.isFinite(x) || !Number.isFinite(z)) return;
        const p = v.panner, t = this.ctx.currentTime;
        if (p.positionX) {
          p.positionX.setTargetAtTime(x, t, 0.03);
          p.positionY.setTargetAtTime(fin(y), t, 0.03);
          p.positionZ.setTargetAtTime(z, t, 0.03);
        } else if (p.setPosition) p.setPosition(x, fin(y), z);
      },
      stop: () => this._kill(v, 0.08),
    };
  }

  update(dt) {
    if (!this._ok()) return;
    const now = this.ctx.currentTime;
    // Safety net: release voices whose onended never arrived.
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (now > v.end + 0.3) this._release(v);
    }
    if (this._hb > 0.01) {
      if (this._hbNext < now) this._hbNext = now + 0.05;
      if (this._hbNext < now + 0.12) {
        this._beat(this._hbNext, this._hb);
        this._hbNext += 1.05 - 0.6 * this._hb;
      }
    }
    this._applyMuffle();
    const a = this._amb;
    if (a) {
      if (now >= a.nextRumble) { this._rumble(now + 0.05); a.nextRumble = now + rand(15, 40); }
      if (now >= a.nextCrow) { if (Math.random() < 0.6) this._crow(now + 0.05); a.nextCrow = now + rand(45, 120); }
    }
  }

  // ---- weapons --------------------------------------------------------------------------------

  gunshot(kind = 'pistol', pos) {
    if (kind === 'rocket') return this._rocket(pos);
    if (kind === 'arc') return this._arc(pos);
    const G = GUNS[kind] || GUNS.pistol, P = validPos(pos);
    const v = this._voice(P ? P_MED : P_HIGH, P); if (!v) return;
    const t = this._now(), r = rand(0.94, 1.06);
    v.out.gain.value = G.vol * (P ? 1.5 : 1);
    let mix = v.out;
    if (G.drive) { mix = this._g(v, 1); link(mix, this._ws(v, this.curves[G.drive]), v.out); }
    const [cf, cq, cd, cp] = G.crack;
    this._burst(v, mix, t, { f: cf * r, q: cq, d: cd, peak: cp });
    if (G.snap) this._burst(v, mix, t, { type: 'highpass', f: 5000, d: G.snap[0], peak: G.snap[1] });
    const [b0, b1, bd, bp] = G.thump;
    this._tone(v, mix, t, { f: b0 * r, f2: b1, sw: bd * 0.8, d: bd, peak: bp });
    if (G.body) this._burst(v, mix, t, { kind: G.body[0], type: 'lowpass', f: G.body[1], q: 0.7, d: G.body[2], peak: G.body[3] });
    if (G.tail) {
      const [k, lf, td, tp] = G.tail;
      this._burst(v, v.out, t + 0.005, { kind: k, type: 'lowpass', f: lf * r, q: 0.7, a: 0.012, d: td, peak: tp });
    }
  }

  _rocket(pos) {
    const P = validPos(pos), v = this._voice(P ? P_MED : P_HIGH, P); if (!v) return;
    const t = this._now();
    v.out.gain.value = P ? 1.4 : 0.9;
    const m = this._g(v, 1);
    link(m, this._ws(v, this.curves.soft), v.out);
    this._tone(v, m, t, { f: 95, f2: 32, sw: 0.3, d: 0.35, peak: 1.2 });
    this._burst(v, m, t, { type: 'lowpass', f: 3500, d: 0.09, peak: 0.9 });
    this._burst(v, v.out, t + 0.02, { kind: 'pink', f: 450, f2: 2400, q: 1.4, a: 0.06, d: 0.9, peak: 1.0 });
    this._burst(v, v.out, t, { type: 'highpass', f: 4000, a: 0.02, d: 0.6, peak: 0.22 });
  }

  // Wonder weapon: FM + ring-modulated square zap rising in pitch, with electric crackle.
  _arc(pos) {
    const P = validPos(pos), v = this._voice(P ? P_MED : P_HIGH, P); if (!v) return;
    const t = this._now(), d = 0.32;
    v.out.gain.value = P ? 0.9 : 0.6;
    const car = this._osc(v, 'square', 260, t, t + d);
    glide(car.frequency, t, 260, 2400, 0.22);
    const mod = this._osc(v, 'square', 90, t, t + d);
    glide(mod.frequency, t, 90, 900, 0.25);
    const depth = this._g(v, 600);
    depth.gain.setValueAtTime(600, t);
    depth.gain.linearRampToValueAtTime(40, t + d);
    link(mod, depth, car.frequency);
    const ring = this._g(v, 0);
    this._osc(v, 'sine', 1330, t, t + d).connect(ring.gain);
    const g = this._g(v);
    env(g.gain, t, 0.003, d - 0.02, 0.5);
    link(car, ring, this._flt(v, 'highpass', 500, 0.7), g, v.out);
    this._crackle(v, v.out, t, 0.25, { f: 5200, q: 0.8, count: 22, peak: 0.55, spread: 1.4 });
    this._tone(v, v.out, t, { f: 240, f2: 55, d: 0.14, peak: 0.6 });
  }

  dryFire() {
    const v = this._voice(P_HIGH); if (!v) return;
    const t = this._now();
    v.out.gain.value = 0.5;
    this._burst(v, v.out, t, { f: 3200, q: 2.5, d: 0.018, peak: 1 });
    this._tone(v, v.out, t, { wave: 'square', f: 1900, f2: 1200, d: 0.02, peak: 0.12 });
    this._burst(v, v.out, t + 0.045, { f: 2200, q: 3, d: 0.025, peak: 0.6 });
  }

  reload(stage = 'in') {
    const v = this._voice(P_HIGH); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.55;
    if (stage === 'out') {
      this._burst(v, o, t, { f: 2600, q: 4, d: 0.03, peak: 0.9 });
      this._burst(v, o, t + 0.05, { kind: 'pink', f: 900, f2: 600, q: 2, a: 0.01, d: 0.09, peak: 0.6 });
      this._tone(v, o, t, { wave: 'triangle', f: 780, d: 0.05, peak: 0.12 });
    } else if (stage === 'bolt') {
      this._burst(v, o, t, { f: 2100, q: 3, d: 0.045, peak: 1 });
      this._burst(v, o, t + 0.03, { f: 1100, f2: 3200, q: 2, a: 0.02, d: 0.1, peak: 0.35 });
      this._burst(v, o, t + 0.17, { f: 2900, q: 4, d: 0.04, peak: 1.1 });
      this._tone(v, o, t + 0.17, { wave: 'triangle', f: 2450, d: 0.09, peak: 0.08 });
      this._tone(v, o, t + 0.17, { f: 320, f2: 180, d: 0.05, peak: 0.35 });
    } else if (stage === 'shell') {
      this._burst(v, o, t, { f: 3200, q: 3, d: 0.02, peak: 0.7 });
      this._tone(v, o, t, { f: 420, f2: 260, d: 0.04, peak: 0.3 });
      this._tone(v, o, t + 0.01, { f: 3300, d: 0.07, peak: 0.05 });
      this._tone(v, o, t + 0.01, { f: 4760, d: 0.05, peak: 0.03 });
    } else {
      this._burst(v, o, t, { kind: 'pink', f: 1200, q: 1.5, a: 0.02, d: 0.05, peak: 0.4 });
      this._burst(v, o, t + 0.06, { f: 1600, q: 3, d: 0.04, peak: 1.1 });
      this._tone(v, o, t + 0.06, { f: 300, f2: 150, d: 0.06, peak: 0.5 });
      this._burst(v, o, t + 0.11, { f: 3000, q: 4, d: 0.025, peak: 0.5 });
    }
  }

  weaponSwitch() {
    const v = this._voice(P_HIGH); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.5;
    this._burst(v, o, t, { kind: 'pink', f: 800, q: 0.7, a: 0.05, d: 0.16, peak: 0.6 });
    this._burst(v, o, t + 0.13, { f: 2000, q: 3, d: 0.04, peak: 0.9 });
    this._tone(v, o, t + 0.13, { f: 260, f2: 150, d: 0.05, peak: 0.3 });
  }

  knifeSwing() {
    const v = this._voice(P_HIGH); if (!v) return;
    const t = this._now();
    v.out.gain.value = 0.5;
    this._burst(v, v.out, t, { kind: 'pink', f: 500, f2: 2600, q: 1.4, a: 0.07, d: 0.12, peak: 0.9 });
    this._burst(v, v.out, t, { type: 'highpass', f: 3500, a: 0.05, d: 0.08, peak: 0.15 });
  }

  knifeHit(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1 : 0.7;
    this._tone(v, o, t, { f: 130, f2: 60, d: 0.1, peak: 0.8 });
    this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 900, d: 0.08, peak: 0.8 });
    this._burst(v, o, t, { f: 420, q: 5, a: 0.005, d: 0.14, peak: 0.7 });
    this._burst(v, o, t, { f: 2400, q: 2, d: 0.03, peak: 0.4 });
  }

  explosion(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1.3 : 0.9;
    const body = this._g(v, 1);
    link(body, this._ws(v, this.curves.soft), o);
    this._burst(v, body, t, { type: 'lowpass', f: 6000, f2: 800, q: 0.7, d: 0.18, peak: 1.0 });
    this._burst(v, body, t, { kind: 'brown', type: 'lowpass', f: 500, f2: 90, q: 0.8, a: 0.005, d: 1.8, peak: 1.6 });
    this._tone(v, body, t, { f: 70, f2: 24, sw: 0.9, d: 1.0, peak: 1.4 });
    this._crackle(v, o, t + 0.15, 1.4, { f: 2600, q: 0.9, count: 30, peak: 0.35, spread: 1.6 });
    this._crackle(v, o, t + 0.3, 1.2, { kind: 'pink', f: 900, q: 0.7, count: 14, peak: 0.4, spread: 1.4 });
  }

  grenadeBounce(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out, r = rand(0.95, 1.05);
    o.gain.value = 0.7;
    this._tone(v, o, t, { f: 1850 * r, d: 0.12, peak: 0.12 });
    this._tone(v, o, t, { f: 2710 * r, d: 0.09, peak: 0.08 });
    this._tone(v, o, t, { f: 190, f2: 120, d: 0.05, peak: 0.5 });
    this._burst(v, o, t, { f: 2000, q: 2, d: 0.015, peak: 0.4 });
  }

  impactFlesh(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    this._flesh(v, this._now(), 1);
  }

  headshot(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now();
    this._flesh(v, t, 1.2);
    const m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), v.out);
    this._burst(v, m, t, { f: 1300, q: 2, d: 0.04, peak: 0.9 });
    this._burst(v, v.out, t + 0.01, { kind: 'pink', f: 600, f2: 250, q: 3, a: 0.01, d: 0.18, peak: 0.8 });
  }

  _flesh(v, t, k) {
    const o = v.out, r = rand(0.9, 1.1);
    o.gain.value = 0.75 * k;
    this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 650, d: 0.07, peak: 0.9 });
    this._tone(v, o, t, { f: 95 * r, f2: 50, d: 0.08, peak: 0.6 });
    this._burst(v, o, t, { f: 350 * r, q: 5, a: 0.005, d: 0.1, peak: 0.7 });
  }

  impactWall(pos) {
    const P = validPos(pos), v = this._voice(P_LOW, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.6;
    this._burst(v, o, t, { f: 3200 * rand(0.85, 1.15), q: 1.3, d: 0.03, peak: 0.9 });
    this._burst(v, o, t, { type: 'highpass', f: 6000, d: 0.01, peak: 0.5 });
    if (Math.random() < 0.12) this._tone(v, o, t + 0.01, { f: 3300, f2: 1600, sw: 0.28, d: 0.28, peak: 0.06 });
  }

  // ---- zombies --------------------------------------------------------------------------------

  // Deterministic per-seed voice: base pitch, vocal tract scale, vowel pair, growl rate.
  _zv(seed) {
    const key = seedInt(seed);
    let z = this._zcache.get(key);
    if (!z) {
      const r = mulberry(key);
      z = {
        f0: 60 + r() * 100,
        tract: 0.82 + r() * 0.32,
        va: VOWELS[(r() * VOWELS.length) | 0],
        vb: VOWELS[(r() * VOWELS.length) | 0],
        rough: 18 + r() * 30,
        breath: 0.25 + r() * 0.5,
        harsh: r(),
      };
      if (this._zcache.size > 256) this._zcache.clear();
      this._zcache.set(key, z);
    }
    return z;
  }

  // Source -> growl AM -> [shaper] -> 3 parallel formant bandpasses (gliding vA -> vB) -> envelope.
  _throat(v, t, dur, f0, z, o = {}) {
    const { wave = 'sawtooth', vA = z.va, vB = z.vb, scale = 1, q = 5, rough = z.rough, depth = 0.4, drive = null } = o;
    const end = t + dur + 0.05;
    const src = this._osc(v, wave, f0, t, end);
    const am = this._g(v, 1 - depth);
    const lg = this._g(v, depth);
    link(this._osc(v, depth > 0.6 ? 'square' : 'triangle', rough, t, end), lg, am.gain);
    let head = link(src, am);
    if (drive) head = link(am, this._ws(v, this.curves[drive]));
    const eg = this._g(v);
    for (let i = 0; i < 3; i++) {
      const bp = this._flt(v, 'bandpass', vA[i] * z.tract * scale, q);
      bp.frequency.setValueAtTime(vA[i] * z.tract * scale, t);
      bp.frequency.linearRampToValueAtTime(vB[i] * z.tract * scale, t + dur * 0.8);
      link(head, bp, eg);
    }
    eg.connect(v.out);
    return { src, eg };
  }

  zombieGroan(pos, seed = 0) {
    if (!this._ok() || !this._groanToken()) return NOOP_TRACK;
    const z = this._zv(seed), P = validPos(pos), v = this._voice(P_LOW, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = rand(1, 2), f0 = z.f0 * rand(0.94, 1.06);
    v.out.gain.value = 0.55;
    const { src, eg } = this._throat(v, t, dur, f0, z);
    wobble(src.frequency, t, dur, f0, 0.07, 5, 0.8);
    ahr(eg.gain, t, dur * 0.25, dur * 0.35, dur * 0.4, 4);
    this._burst(v, v.out, t, { kind: 'pink', f: z.va[0] * 1.6, q: 1.2, a: dur * 0.3, h: dur * 0.2, d: dur * 0.5, peak: z.breath * 0.5 });
    return this._track(v);
  }

  zombieScream(pos, seed = 0) {
    const z = this._zv(seed), P = validPos(pos), v = this._voice(P_MED, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = 0.85, f = z.f0 * rand(2.9, 3.4);
    v.out.gain.value = 0.5;
    const { src, eg } = this._throat(v, t, dur, f, z, { vA: VOWELS[0], vB: VOWELS[3], scale: 1.3, q: 4, rough: 55 + z.rough, depth: 0.3, drive: 'fuzz' });
    const fp = src.frequency;
    fp.setValueAtTime(f * 0.7, t);
    fp.linearRampToValueAtTime(f * 1.25, t + 0.12);
    fp.linearRampToValueAtTime(f * 1.1, t + 0.5);
    fp.linearRampToValueAtTime(f * 0.75, t + dur);
    link(this._osc(v, 'sine', 7 + z.harsh * 4, t, t + dur), this._g(v, f * 0.04), fp);
    ahr(eg.gain, t, 0.04, 0.45, 0.35, 3.5);
    this._burst(v, v.out, t, { type: 'highpass', f: 2200, a: 0.03, h: 0.4, d: 0.35, peak: 0.25 });
    return this._track(v);
  }

  zombieAttack(pos, seed = 0) {
    const z = this._zv(seed), P = validPos(pos), v = this._voice(P_MED, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = 0.55, f = z.f0 * 1.6;
    v.out.gain.value = 0.6;
    const { src, eg } = this._throat(v, t, dur, f, z, { vA: VOWELS[3], vB: VOWELS[0], scale: 1.1, rough: 35 + z.rough * 0.5, depth: 0.75, drive: 'hard' });
    glide(src.frequency, t, f * 1.1, f * 0.8, dur);
    ahr(eg.gain, t, 0.02, 0.22, 0.28, 3.5);
    this._burst(v, v.out, t + 0.26, { kind: 'pink', f: 700, f2: 3200, q: 1.3, a: 0.05, d: 0.13, peak: 0.8 });
    return this._track(v);
  }

  zombieDeath(pos, seed = 0) {
    const z = this._zv(seed), P = validPos(pos), v = this._voice(P_MED, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = 0.75, f = z.f0 * 1.1;
    v.out.gain.value = 0.6;
    const { src, eg } = this._throat(v, t, dur, f, z, { vB: VOWELS[1], scale: 0.9, q: 6, rough: 9 + z.harsh * 6, depth: 0.8 });
    glide(src.frequency, t, f, f * 0.5, dur);
    ahr(eg.gain, t, 0.02, 0.25, 0.45, 3.5);
    this._tone(v, v.out, t + 0.5, { f: 90, f2: 40, d: 0.25, peak: 0.8 });
    this._burst(v, v.out, t + 0.5, { kind: 'brown', type: 'lowpass', f: 450, a: 0.005, d: 0.3, peak: 0.8 });
    return this._track(v);
  }

  zombieSpawn(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), dur = 1.3;
    v.out.gain.value = 0.8;
    const n = this._noise(v, 'brown', t, dur + 0.1), g = this._g(v, 0);
    g.gain.setValueAtTime(EPS, t);
    for (let tt = t; tt < t + dur - 0.3;) { tt += rand(0.08, 0.25); g.gain.linearRampToValueAtTime(rand(0.2, 0.9), tt); }
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    link(n, this._flt(v, 'lowpass', 750, 0.8), g, v.out);
    this._crackle(v, v.out, t + 0.1, dur - 0.2, { kind: 'pink', f: 1900, q: 1, count: 16, peak: 0.5, fade: 0.3 });
    this._tone(v, v.out, t, { f: 55, f2: 38, a: 0.3, d: 0.9, peak: 0.35 });
  }

  boardBreak(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1.1 : 0.7;
    const cr = this._osc(v, 'sawtooth', 85, t, t + 0.3);
    wobble(cr.frequency, t, 0.18, 85, 0.25, 4, 1.5);
    const cg = this._g(v);
    ahr(cg.gain, t, 0.03, 0.1, 0.06, 2.5);
    link(cr, this._flt(v, 'bandpass', 720, 9), cg, o);
    const m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), o);
    this._burst(v, m, t + 0.16, { f: 1600, q: 0.8, d: 0.06, peak: 1.2 });
    this._tone(v, m, t + 0.16, { f: 190, f2: 80, d: 0.09, peak: 0.7 });
    this._crackle(v, o, t + 0.17, 0.35, { f: 3800, q: 1.2, count: 16, peak: 0.5, spread: 1.5 });
    this._tone(v, o, t + 0.55, { f: 135, f2: 70, d: 0.1, peak: 0.5 });
    this._burst(v, o, t + 0.55, { kind: 'pink', f: 900, d: 0.08, peak: 0.4 });
  }

  boardRepair(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const o = v.out;
    o.gain.value = P ? 1 : 0.6;
    let tt = this._now();
    for (let i = 0; i < 3; i++) { this._knock(v, o, tt, 1 - i * 0.15); tt += rand(0.19, 0.26); }
    this._burst(v, o, tt + 0.05, { kind: 'pink', f: 520, f2: 380, q: 3, a: 0.06, d: 0.3, peak: 0.35 });
    this._crackle(v, o, tt + 0.05, 0.25, { kind: 'pink', f: 1500, q: 1, count: 6, peak: 0.3 });
  }

  _knock(v, dest, t, k = 1) {
    this._tone(v, dest, t, { f: 430, f2: 310, sw: 0.06, d: 0.09, peak: 0.7 * k });
    this._burst(v, dest, t, { f: 2400, q: 1.5, d: 0.022, peak: 0.6 * k });
    this._tone(v, dest, t, { f: 120, f2: 90, d: 0.06, peak: 0.5 * k });
  }

  // ---- player / world -------------------------------------------------------------------------

  playerHurt() {
    const v = this._voice(P_HIGH, null, this.dry); if (!v) return;
    const t = this._now(), o = v.out, f = rand(125, 145);
    o.gain.value = 0.8;
    this._tone(v, o, t, { f: 120, f2: 45, d: 0.22, peak: 0.9 });
    this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 600, d: 0.12, peak: 0.8 });
    const src = this._osc(v, 'sawtooth', f, t + 0.01, t + 0.3);
    glide(src.frequency, t + 0.01, f, f * 0.72, 0.25);
    const g = this._g(v);
    ahr(g.gain, t + 0.01, 0.02, 0.06, 0.15, 2.2);
    for (const [ff, q] of [[520, 6], [1190, 8]]) link(src, this._flt(v, 'bandpass', ff, q), g);
    g.connect(o);
    // ear ringing: two close sines beat slowly
    this._tone(v, o, t + 0.02, { f: 3900, a: 0.05, d: 1.3, peak: 0.035 });
    this._tone(v, o, t + 0.02, { f: 3907, a: 0.05, d: 1.3, peak: 0.03 });
  }

  setHeartbeat(intensity) {
    this._hb = clamp(fin(intensity, 0), 0, 1);
    if (this._ok()) this._applyMuffle();
  }

  // Low health gently muffles the world (sfx bus lowpass); the heartbeat itself is on the dry bus.
  _applyMuffle() {
    const f = this._hb < 0.02 ? 20000 : 20000 * Math.pow(0.2, this._hb);
    if (Math.abs(f - this._hbLP) > 150) {
      this._hbLP = f;
      this.sfxLP.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.25);
    }
  }

  _beat(t, i) {
    const v = this._voice(P_HIGH, null, this.dry); if (!v) return;
    v.out.gain.value = 0.25 + 0.6 * i;
    const o = this._osc(v, 'sine', 70, t, t + 0.5), g = this._g(v);
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    o.frequency.setValueAtTime(64, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.34);
    ahr(g.gain, t, 0.012, 0.02, 0.12, 1);
    ahr(g.gain, t + 0.2, 0.012, 0.02, 0.14, 0.7);
    link(o, g, v.out);
    this._burst(v, v.out, t, { kind: 'brown', type: 'lowpass', f: 180, d: 0.08, peak: 0.5 });
  }

  footstep(surface = 'concrete', pos) {
    const P = validPos(pos), v = this._voice(P_LOW, P); if (!v) return;
    const t = this._now(), o = v.out, r = rand(0.9, 1.1);
    o.gain.value = P ? 0.7 : 0.32;
    if (surface === 'wood') {
      this._tone(v, o, t, { f: 115 * r, f2: 80, d: 0.07, peak: 0.8 });
      this._burst(v, o, t, { f: 750 * r, q: 1.6, d: 0.05, peak: 0.6 });
      if (Math.random() < 0.15) this._burst(v, o, t + 0.03, { kind: 'pink', f: 900 * r, q: 9, a: 0.03, d: 0.12, peak: 0.5 });
    } else if (surface === 'dirt') {
      this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 1300 * r, q: 0.8, a: 0.012, d: 0.1, peak: 0.9 });
      this._crackle(v, o, t, 0.08, { f: 2500 * r, q: 1, count: 5, peak: 0.35 });
    } else {
      this._burst(v, o, t, { f: 2600 * r, q: 0.8, d: 0.035, peak: 0.55 });
      this._tone(v, o, t, { f: 75 * r, f2: 50, d: 0.05, peak: 0.6 });
    }
  }

  jumpLand() {
    const v = this._voice(P_HIGH); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.6;
    this._tone(v, o, t, { f: 85, f2: 38, d: 0.16, peak: 1 });
    this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 700, d: 0.1, peak: 0.7 });
    this._crackle(v, o, t + 0.02, 0.12, { f: 3200, q: 2, count: 7, peak: 0.25 });
  }

  purchase() {
    const v = this._voice(P_HIGH, null, this.dry); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.6;
    this._burst(v, o, t, { type: 'highpass', f: 5000, d: 0.05, peak: 0.4 });
    this._bell(v, o, t + 0.02, 1318.5, 0.5, 0.35, BELL);
    this._burst(v, o, t + 0.12, { type: 'highpass', f: 6000, d: 0.08, peak: 0.35 });
    this._bell(v, o, t + 0.13, 1975.5, 1.0, 0.4, BELL);
    this._tone(v, o, t + 0.13, { f: 2637, d: 0.8, peak: 0.15 });
    this._crackle(v, o, t + 0.14, 0.3, { f: 5500, q: 2, count: 10, peak: 0.25 });
  }

  denied() {
    const v = this._voice(P_HIGH, null, this.dry); if (!v) return;
    const t = this._now(), g = this._g(v), lp = this._flt(v, 'lowpass', 700, 1);
    v.out.gain.value = 0.5;
    ahr(g.gain, t, 0.005, 0.14, 0.05, 0.5);
    ahr(g.gain, t + 0.22, 0.005, 0.14, 0.06, 0.5);
    this._osc(v, 'sawtooth', 92, t, t + 0.5).connect(lp);
    this._osc(v, 'square', 97, t, t + 0.5).connect(lp);
    link(lp, g, v.out);
  }

  doorOpen(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1.2 : 0.8;
    // chain rattle
    this._crackle(v, o, t, 0.9, { f: 3400, q: 2.5, count: 40, peak: 0.5, spread: 1.3, len: 0.03 });
    for (const f of [2100, 3170, 4020]) this._tone(v, o, t + rand(0, 0.3), { wave: 'triangle', f, d: 0.35, peak: 0.04 });
    // heavy wood groan
    const src = this._osc(v, 'sawtooth', 70, t, t + 1.3);
    wobble(src.frequency, t, 1.2, 70, 0.18, 6, 0.8);
    const g = this._g(v);
    ahr(g.gain, t, 0.1, 0.7, 0.4, 2.5);
    link(src, this._flt(v, 'bandpass', 420, 7), g, o);
    // debris tumble
    this._burst(v, o, t + 0.35, { kind: 'brown', type: 'lowpass', f: 700, f2: 250, a: 0.05, d: 1.4, peak: 0.9 });
    this._crackle(v, o, t + 0.4, 1.2, { kind: 'pink', f: 1400, q: 0.9, count: 18, peak: 0.6, spread: 1.6 });
    this._tone(v, o, t + 0.5, { f: 95, f2: 50, d: 0.25, peak: 0.7 });
    this._tone(v, o, t + 1.0, { f: 80, f2: 45, d: 0.2, peak: 0.45 });
  }

  boxOpen(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1 : 0.6;
    this._burst(v, o, t, { f: 3000, q: 3, d: 0.02, peak: 0.5 });
    // stick-slip creak: square AM on a slowly rising saw through narrow resonances
    const src = this._osc(v, 'sawtooth', 140, t, t + 0.95);
    wobble(src.frequency, t, 0.8, 140, 0.12, 6, 1.7);
    const am = this._g(v, 0.5);
    link(this._osc(v, 'square', 28, t, t + 0.95), this._g(v, 0.5), am.gain);
    const eg = this._g(v);
    ahr(eg.gain, t, 0.05, 0.55, 0.25, 2.5);
    src.connect(am);
    for (const [f, q] of [[850, 7], [1600, 6]]) link(am, this._flt(v, 'bandpass', f, q), eg);
    eg.connect(o);
    this._tone(v, o, t + 0.85, { f: 160, f2: 90, d: 0.1, peak: 0.5 });
  }

  // Wind-up music box: harmonic-minor tines, slightly detuned, slowing and sagging at the end.
  boxJingle(pos, duration = 4) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const dur = clamp(fin(duration, 4), 0.5, 20), t = this._now();
    v.out.gain.value = P ? 0.9 : 0.5;
    for (let tt = 0, i = 0; tt < dur - 0.3 && i < 64; i++) {
      const prog = tt / dur, slow = prog > 0.65 ? (prog - 0.65) / 0.35 : 0;
      const cents = rand(-9, 9) - 70 * slow * slow;
      this._bell(v, v.out, t + tt, semi(880, BOX_MELODY[i % BOX_MELODY.length] + cents / 100), 1.1, 0.22, MUSICBOX);
      tt += 0.21 * (1 + 0.9 * slow * slow) * rand(0.95, 1.05);
    }
    const bed = this._g(v), lp = this._flt(v, 'lowpass', 500, 0.7);
    ahr(bed.gain, t, 0.6, Math.max(0, dur - 1.4), 0.8, 0.05);
    link(lp, bed, v.out);
    for (const f of [110, 110.9, 164.2]) this._osc(v, 'triangle', f, t, t + dur + 0.05).connect(lp);
  }

  boxLand(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 1 : 0.7;
    this._bell(v, o, t, 1567.98, 2.2, 0.35, BELL);
    this._bell(v, o, t + 0.004, 1567.98 * 1.5 * 1.003, 1.6, 0.12, BELL2);
    this._tone(v, o, t, { f: 220, f2: 110, d: 0.4, peak: 0.3 });
    this._crackle(v, o, t, 0.6, { f: 7000, q: 1, count: 14, peak: 0.12, spread: 1.5 });
  }

  powerupSpawn(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now();
    v.out.gain.value = 0.7;
    const mix = this._g(v, 0.6);
    link(this._osc(v, 'sine', 9, t, t + 1.6), this._g(v, 0.4), mix.gain);
    mix.connect(v.out);
    for (const f of [1760, 2093, 2349.3, 2637, 3136, 3520]) {
      this._tone(v, mix, t + rand(0, 0.45), { f: f * rand(0.995, 1.005), a: rand(0.12, 0.3), d: 0.8, peak: 0.07 });
    }
    this._crackle(v, v.out, t, 1.1, { f: 7500, q: 0.8, count: 22, peak: 0.12, fade: 0.2 });
    this._burst(v, v.out, t, { kind: 'pink', type: 'highpass', f: 3000, a: 0.4, d: 0.8, peak: 0.08 });
  }

  powerupGrab(type) {
    const v = this._voice(P_CRIT, null, this.dry); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.6;
    if (type === 'instakill') {
      // reverse swell into a distorted tritone stab
      this._burst(v, o, t, { type: 'highpass', f: 2500, a: 0.38, d: 0.05, peak: 0.35 });
      const m = this._g(v, 1), lp = this._flt(v, 'lowpass', 3000, 3);
      glide(lp.frequency, t + 0.4, 3000, 180, 1.3);
      link(m, this._ws(v, this.curves.hard), lp, o);
      this._tone(v, m, t + 0.4, { wave: 'sawtooth', f: 82.41, a: 0.01, h: 0.3, d: 1.0, peak: 0.5 });
      this._tone(v, m, t + 0.4, { wave: 'sawtooth', f: 116.54, a: 0.01, h: 0.3, d: 1.0, peak: 0.45 });
      this._tone(v, o, t + 0.4, { f: 55, f2: 30, d: 0.9, peak: 0.6 });
    } else if (type === 'doublepoints') {
      for (const [dt, f] of [[0, 1760], [0.09, 2637], [0.3, 1975.5], [0.39, 2960]]) this._bell(v, o, t + dt, f, 0.7, 0.25, BELL);
      this._crackle(v, o, t + 0.05, 0.5, { f: 6000, q: 2, count: 16, peak: 0.25 });
    } else if (type === 'nuke') {
      this._tone(v, o, t, { f: 60, f2: 20, sw: 1.6, a: 0.01, d: 2.0, peak: 1.0 });
      this._burst(v, o, t, { kind: 'brown', type: 'lowpass', f: 400, f2: 80, a: 0.02, d: 2.2, peak: 1.0 });
      this._tone(v, o, t + 0.05, { f: 1400, f2: 260, sw: 1.5, a: 0.05, h: 0.2, d: 1.3, peak: 0.08 });
    } else if (type === 'carpenter') {
      for (const dt of [0, 0.13, 0.26]) this._knock(v, o, t + dt, 0.9);
      [261.63, 311.13, 392, 523.25].forEach((f, i) => {
        this._tone(v, o, t + 0.42 + i * 0.07, { wave: 'square', f, a: 0.005, h: 0.05, d: 0.3, peak: 0.07 });
      });
    } else {
      // maxammo: brass-like arpeggio over a snare roll
      const lp = this._flt(v, 'lowpass', 1800, 1.5);
      lp.connect(o);
      [196, 261.63, 329.63, 392].forEach((f, i) => {
        const last = i === 3;
        this._tone(v, lp, t + i * 0.1, { wave: 'sawtooth', f, a: 0.012, h: last ? 0.35 : 0.04, d: last ? 0.5 : 0.08, peak: 0.28 });
      });
      this._crackle(v, o, t, 0.4, { f: 2200, q: 0.7, count: 26, peak: 0.35, len: 0.02, fade: 0 });
      this._tone(v, o, t + 0.3, { f: 90, f2: 45, d: 0.4, peak: 0.5 });
    }
  }

  announce(text) {
    if (!this._ok()) return;
    const v = this._voice(P_CRIT, null, this.music);
    if (v) {
      const t = this._now();
      v.out.gain.value = 0.7;
      this._burst(v, v.out, t, { kind: 'pink', f: 180, f2: 900, q: 0.8, a: 0.5, d: 1.1, peak: 0.5 });
      this._tone(v, v.out, t, { f: 45, a: 0.3, d: 1.4, peak: 0.35 });
      const lp = this._flt(v, 'lowpass', 160, 1);
      lp.connect(v.out);
      this._tone(v, lp, t + 0.1, { wave: 'sawtooth', f: 38, a: 0.3, h: 0.4, d: 0.9, peak: 0.15 });
    }
    const ss = globalThis.speechSynthesis, U = globalThis.SpeechSynthesisUtterance;
    if (!ss || typeof U !== 'function' || !text) return;
    const u = new U(String(text));
    u.pitch = 0.1;
    u.rate = 0.8;
    u.volume = clamp(this._mv, 0, 1);
    const voice = this._pickVoice(ss);
    if (voice) u.voice = voice;
    ss.speak(u);
  }

  _pickVoice(ss) {
    if (this._speechVoice) return this._speechVoice;
    const list = (typeof ss.getVoices === 'function' && ss.getVoices()) || [];
    const en = list.filter((x) => /^en/i.test(x.lang || ''));
    const pool = en.length ? en : list;
    const male = pool.find((x) => /male|david|daniel|george|guy|fred|ryan|thomas|mark/i.test(x.name || '') && !/female/i.test(x.name || ''));
    this._speechVoice = male || pool[0] || null;
    return this._speechVoice;
  }

  // ---- music stingers -------------------------------------------------------------------------

  roundStart(round = 1) {
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const t = this._now(), k = clamp((fin(round, 1) - 1) / 20, 0, 1), dur = 3.2;
    v.out.gain.value = 0.55 + 0.25 * k;
    // brass-like drone: detuned saws in a minor-second cluster, filter swelling open then closed
    const lp = this._flt(v, 'lowpass', 140, 2.5);
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.exponentialRampToValueAtTime(650 + 1100 * k, t + 1.3);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    const dg = this._g(v);
    ahr(dg.gain, t, 0.5, 1.5, 1.2, 0.3);
    link(lp, dg, v.out);
    let head = lp;
    if (k > 0.35) { head = this._ws(v, this.curves.soft); head.connect(lp); }
    for (const [f, det] of [[55, 0], [55, 9], [58.27, -5], [82.41, 4]]) {
      const o = this._osc(v, 'sawtooth', f, t, t + dur + 0.1);
      o.detune.setValueAtTime(det, t);
      o.detune.setValueAtTime(det, t + 1.6);
      o.detune.linearRampToValueAtTime(det - 30, t + dur);
      o.connect(head);
    }
    this._tone(v, v.out, t, { f: 72, f2: 38, sw: 0.6, d: 1.4, peak: 0.7 + 0.4 * k });
    // tritone bell pairs; the lower bell descends chromatically each hit
    const hits = k > 0.4 ? [0, 0.55, 1.0, 1.45, 1.9] : [0, 0.95, 1.9];
    hits.forEach((ht, i) => {
      const base = semi(293.66, -i);
      this._bell(v, v.out, t + ht, base, 1.8, 0.16, BELL2);
      this._bell(v, v.out, t + ht + 0.02, base * Math.SQRT2 * 1.004, 1.6, 0.11, BELL2);
    });
  }

  // Choir-ish swell: detuned saws through shared vowel formants, Bb/E cluster resolving to D minor.
  roundEnd(round) {
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const t = this._now(), dur = 4.2;
    v.out.gain.value = 0.6;
    const bus = this._g(v, 0.35), eg = this._g(v);
    ahr(eg.gain, t, 1.4, 1.4, 1.4, 1.6);
    for (const [f1, f2, q] of [[700, 380, 6], [1150, 900, 7], [2500, 2300, 8]]) {
      const bp = this._flt(v, 'bandpass', f1, q);
      glide(bp.frequency, t, f1, f2, dur);
      link(bus, bp, eg);
    }
    eg.connect(v.out);
    const vd = this._g(v, 9);
    this._osc(v, 'sine', 5.2, t, t + dur + 0.1).connect(vd);
    const from = [146.83, 174.61, 233.08, 329.63], to = [146.83, 174.61, 220.0, 293.66];
    from.forEach((f, i) => {
      for (const det of [-7, 6]) {
        const o = this._osc(v, 'sawtooth', f, t, t + dur + 0.1);
        o.detune.value = det;
        o.frequency.setValueAtTime(f, t + 2.0);
        o.frequency.exponentialRampToValueAtTime(to[i], t + 2.6);
        vd.connect(o.detune);
        o.connect(bus);
      }
    });
    this._tone(v, v.out, t, { wave: 'organ', f: 73.42, a: 1.2, h: 1.6, d: 1.4, peak: 0.18 });
  }

  // Sagging, detuned organ: A minor drifting to F/A, pitch drooping like a dying tape.
  gameOver() {
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const t = this._now(), dur = 6.2;
    v.out.gain.value = 0.7;
    const lp = this._flt(v, 'lowpass', 2400, 0.7);
    lp.frequency.setValueAtTime(2400, t + 2.5);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const trem = this._g(v, 0.85);
    link(this._osc(v, 'sine', 5.5, t, t + dur + 0.1), this._g(v, 0.15), trem.gain);
    const eg = this._g(v);
    ahr(eg.gain, t, 0.9, 2.6, 2.6, 0.16);
    link(lp, trem, eg, v.out);
    for (const [f, g] of [[110, 110], [164.81, 174.61], [220, 220], [261.63, 261.63], [329.63, 349.23]]) {
      for (const det of [-9, 8]) {
        const o = this._osc(v, 'organ', f, t, t + dur + 0.1);
        o.frequency.setValueAtTime(f, t + 2.6);
        o.frequency.exponentialRampToValueAtTime(g, t + 3.1);
        o.detune.setValueAtTime(det, t);
        o.detune.linearRampToValueAtTime(det - 55, t + dur);
        o.connect(lp);
      }
    }
  }

  // ---- ambience -------------------------------------------------------------------------------

  startAmbience() {
    if (!this._ok() || this._amb) return;
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const c = this.ctx, t = c.currentTime, o = v.out, END = Infinity;
    v.bg = true;
    v.end = Infinity;
    o.gain.setValueAtTime(0, t);
    o.gain.linearRampToValueAtTime(1, t + 4);
    // wind: pink noise through a wandering bandpass, slow gust swell, slow stereo drift
    const bp = this._flt(v, 'bandpass', 380, 0.8), wg = this._g(v, 0.22);
    const l1 = this._osc(v, 'sine', 0.057, t, END);
    link(l1, this._g(v, 240), bp.frequency);
    link(this._osc(v, 'sine', 0.13, t, END), this._g(v, 0.1), wg.gain);
    link(this._noise(v, 'pink', t, END), bp, wg);
    if (typeof c.createStereoPanner === 'function') {
      const sp = c.createStereoPanner();
      v.nodes.push(sp);
      link(this._osc(v, 'sine', 0.031, t, END), this._g(v, 0.6), sp.pan);
      link(wg, sp, o);
    } else wg.connect(o);
    // thin whistle through cracks
    const wbp = this._flt(v, 'bandpass', 1500, 9);
    link(l1, this._g(v, 500), wbp.frequency);
    link(this._noise(v, 'white', t, END), wbp, this._g(v, 0.02), o);
    // sub drone with a beating minor second
    const dl = this._flt(v, 'lowpass', 190, 0.7), dg = this._g(v, 0.1);
    link(dl, dg, o);
    for (const [f, type] of [[41.2, 'sine'], [43.65, 'triangle'], [61.74, 'sine']]) this._osc(v, type, f, t, END).connect(dl);
    link(this._osc(v, 'sine', 0.07, t, END), this._g(v, 0.04), dg.gain);
    this._amb = { v, nextRumble: t + rand(6, 15), nextCrow: t + rand(30, 70) };
  }

  stopAmbience() {
    const a = this._amb;
    this._amb = null;
    if (a && this.ctx) this._kill(a.v, 2);
  }

  _rumble(t) {
    const v = this._voice(P_MED, null, this.music, rand(-0.8, 0.8)); if (!v) return;
    const o = v.out;
    o.gain.value = rand(0.35, 0.6);
    if (Math.random() < 0.55) {
      // distant artillery with rolling echoes
      this._tone(v, o, t, { f: 52, f2: 28, sw: 0.8, a: 0.01, d: 1.1, peak: 0.7 });
      [0, 0.55, 1.25].forEach((dt, i) => {
        this._burst(v, o, t + dt, { kind: 'brown', type: 'lowpass', f: 320 - i * 80, q: 0.7, a: 0.02, d: 1.6 - i * 0.3, peak: 0.9 / (i + 1) });
      });
    } else {
      // thunder: irregular swells
      const dur = rand(3, 5.5), g = this._g(v, 0);
      g.gain.setValueAtTime(EPS, t);
      for (let tt = t; tt < t + dur - 0.8;) { tt += rand(0.15, 0.7); g.gain.linearRampToValueAtTime(rand(0.3, 1), tt); }
      g.gain.exponentialRampToValueAtTime(EPS, t + dur);
      link(this._noise(v, 'brown', t, dur + 0.1), this._flt(v, 'lowpass', 380, 0.6), g, o);
      this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 1400, a: 0.02, d: 0.5, peak: 0.25 });
    }
  }

  _crow(t) {
    const v = this._voice(P_LOW, null, this.music, rand(-0.9, 0.9)); if (!v) return;
    v.out.gain.value = 0.25;
    const n = 2 + ((Math.random() * 2) | 0), src = this._osc(v, 'sawtooth', 560, t, t + n * 0.45 + 0.2), g = this._g(v, 0);
    for (let i = 0, ti = t; i < n; i++, ti += rand(0.34, 0.42)) {
      glide(src.frequency, ti, rand(540, 620), 400, 0.26);
      ahr(g.gain, ti, 0.02, 0.1, 0.14, 1);
    }
    const lp = this._flt(v, 'lowpass', 2600, 0.7);
    link(src, this._ws(v, this.curves.hard), g);
    for (const [f, q] of [[1250, 3], [2300, 4]]) link(g, this._flt(v, 'bandpass', f, q), lp);
    lp.connect(v.out);
  }

  // Easter egg: original D-minor waltz through a radio band-limit with vinyl crackle and wow.
  radioSong(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return NOOP_HANDLE;
    const beat = 0.4, t = this._now() + 0.05, end = t + WALTZ_PROG.length * 3 * beat + 0.8;
    v.out.gain.value = P ? 1.1 : 0.6;
    const mix = this._g(v, 0.9);
    link(mix, this._flt(v, 'highpass', 380, 0.8), this._flt(v, 'lowpass', 2800, 1.4), this._ws(v, this.curves.soft), v.out);
    const wow = this._g(v, 11);
    this._osc(v, 'sine', 0.55, t, end).connect(wow);
    // oom: bass on beat 1
    const bass = this._osc(v, 'triangle', 146.83, t, end), bg = this._g(v);
    wow.connect(bass.detune);
    link(bass, bg, mix);
    // pah-pah: chord stabs on beats 2 and 3
    const cg = this._g(v), clp = this._flt(v, 'lowpass', 1400, 0.7);
    link(clp, cg, mix);
    const chord = WALTZ_CHORDS.Dm[1].map((f) => {
      const o = this._osc(v, 'square', f, t, end);
      wow.connect(o.detune);
      o.connect(clp);
      return o;
    });
    WALTZ_PROG.forEach((name, b) => {
      const tb = t + b * 3 * beat, [root, tones] = WALTZ_CHORDS[name];
      bass.frequency.setValueAtTime(root, tb);
      ahr(bg.gain, tb, 0.01, 0.08, 0.3, 0.5);
      chord.forEach((o, i) => o.frequency.setValueAtTime(tones[i], tb + beat * 0.5));
      if (b < WALTZ_PROG.length - 1) {
        ahr(cg.gain, tb + beat, 0.008, 0.04, 0.16, 0.07);
        ahr(cg.gain, tb + 2 * beat, 0.008, 0.04, 0.16, 0.07);
      }
    });
    // melody: legato saw "fiddle" with vibrato
    const mel = this._osc(v, 'sawtooth', 440, t, end), mg = this._g(v);
    link(this._osc(v, 'sine', 5.3, t, end), this._g(v, 9), mel.detune);
    wow.connect(mel.detune);
    link(mel, this._flt(v, 'lowpass', 2200, 0.8), mg, mix);
    for (const [b, len, n] of WALTZ) {
      const tn = t + b * beat;
      mel.frequency.setValueAtTime(semi(587.33, n), tn);
      ahr(mg.gain, tn, 0.04, len * beat * 0.65, len * beat * 0.2, 0.22);
    }
    const span = end - t;
    this._crackle(v, mix, t, span - 0.2, { f: 3500, q: 0.5, count: Math.round(span * 22), peak: 0.35, len: 0.004, fade: 0 });
    this._burst(v, mix, t, { type: 'highpass', f: 3000, a: 0.3, h: span - 1.0, d: 0.6, peak: 0.05 });
    return { stop: () => { try { this._kill(v, 0.25); } catch { /* ignore */ } } };
  }

  // ---- internals: graph -----------------------------------------------------------------------

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this._mv;
    const comp = c.createDynamicsCompressor();
    // Peak limiter only: heavy compression would flatten the near/far dynamics.
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    link(this.master, comp, c.destination);
    this.sfx = c.createGain();
    this.sfxLP = c.createBiquadFilter();
    this.sfxLP.type = 'lowpass';
    this.sfxLP.frequency.value = 20000;
    this.sfxLP.Q.value = 0.5;
    link(this.sfx, this.sfxLP, this.master);
    this.music = c.createGain();
    this.music.gain.value = this._muv;
    this.music.connect(this.master);
    this.dry = c.createGain();
    this.dry.connect(this.master);
    this.curves = { soft: driveCurve(2), hard: driveCurve(6), fuzz: driveCurve(16) };
    if (typeof c.createPeriodicWave === 'function') {
      const imag = new Float32Array([0, 1, 0.8, 0.5, 0.3, 0.12, 0.2, 0, 0.1]);
      this._organWave = c.createPeriodicWave(new Float32Array(imag.length), imag);
    }
    if (typeof c.createConvolver === 'function') {
      const conv = c.createConvolver();
      conv.buffer = this._impulse(1.5);
      const wet = c.createGain();
      wet.gain.value = 0.9;
      link(conv, wet, this.master);
      const s1 = c.createGain();
      s1.gain.value = 0.05;
      link(this.sfxLP, s1, conv);
      this.revIn = conv;
      const s2 = c.createGain();
      s2.gain.value = 0.32;
      link(this.music, s2, conv);
    }
    // buffers last: _ok() requires them, so a partial build never plays
    this.buf = { white: this._noiseBuf('white'), pink: this._noiseBuf('pink'), brown: this._noiseBuf('brown') };
  }

  // Loopable noise: the head is crossfaded with an overrun tail so the wrap point is continuous.
  _noiseBuf(kind) {
    const c = this.ctx, sr = c.sampleRate || 44100, len = (sr * NOISE_SEC) | 0, xf = (sr * 0.05) | 0;
    const gen = new Float32Array(len + xf);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < gen.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        gen[i] = b0 + b1 + b2 + w * 0.1848;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        gen[i] = last;
      } else gen[i] = w;
    }
    const buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const s = i < xf ? gen[i] * (i / xf) + gen[len + i] * (1 - i / xf) : gen[i];
      d[i] = s;
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
    const k = peak > 0 ? 0.95 / peak : 1;
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  // Short, dark concrete-room impulse with a few early reflections.
  _impulse(sec) {
    const c = this.ctx, sr = c.sampleRate || 44100, len = (sr * sec) | 0, buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.85 - 0.7 * x);
        d[i] = lp * Math.pow(1 - x, 2.2) * Math.exp(-3 * x);
      }
      for (let i = 0; i < ((sr * 0.004) | 0); i++) d[i] = 0;
      for (const ms of [7, 13, 19, 29, 41]) {
        const i = (((ms + ch * 2.3) * sr) / 1000) | 0;
        if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * (1 - ms / 60);
      }
    }
    return buf;
  }

  // ---- internals: voices ----------------------------------------------------------------------

  _ok() {
    const c = this.ctx;
    return !!c && c.state === 'running' && !!this.buf;
  }

  _now() {
    return this.ctx.currentTime + 0.01;
  }

  _live() {
    let n = 0;
    for (const v of this.voices) if (!v.dying && !v.bg) n++;
    return n;
  }

  _admit(prio) {
    const n = this._live();
    if (prio <= P_LOW) return n < this.maxVoices - 4;
    if (n < this.maxVoices) return true;
    let victim = null;
    for (const v of this.voices) {
      if (v.dying || v.bg || v.prio >= prio) continue;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
    }
    if (victim) { this._kill(victim, 0.03); return true; }
    return prio >= P_HIGH && n < this.maxVoices + 12;
  }

  // New voice: out gain -> [distance lowpass -> panner | stereo pan] -> bus. Null when refused.
  _voice(prio, pos = null, bus = this.sfx, pan = null) {
    if (!this._ok()) return null;
    const P = validPos(pos);
    let d = 0;
    if (P) {
      const L = this._L;
      d = Math.hypot(P.x - L.x, P.y - L.y, P.z - L.z);
      if (d > MAX_DIST * (prio >= P_HIGH ? 1.6 : 1)) return null;
    }
    if (!this._admit(prio)) return null;
    const c = this.ctx, t = c.currentTime;
    const v = { prio, t0: t, end: t + 0.5, nodes: [], srcs: [], live: 0, dying: false, done: false, bg: false, out: null };
    this.voices.push(v);
    v.out = this._g(v, 1);
    let tail = v.out;
    if (P) {
      // Walls between us muffle and quieten; distance dulls the top end (air absorption).
      let occ = 0;
      if (this.occlusion) { try { occ = clamp(fin(this.occlusion(P.x, P.y, P.z)), 0, 1); } catch { occ = 0; } }
      const air = d > 4 ? clamp(18000 * Math.pow(4 / d, 1.2), 1100, 20000) : 20000;
      const cutoff = occ > 0 ? Math.min(air, 500 + 1300 * (1 - occ)) : air;
      if (cutoff < 19000) tail = link(tail, this._flt(v, 'lowpass', cutoff, 0.6));
      tail = link(tail, this._g(v, SPATIAL_GAIN * (1 - 0.6 * occ)));
      // Room feed: steady level while the direct sound falls off, so far sounds read as far.
      if (this.revIn) {
        const send = this._g(v, 0.035 * (1 + occ) * clamp(1.15 - d / 60, 0.45, 1));
        tail.connect(send);
        send.connect(this.revIn);
      }
      const p = c.createPanner();
      p.panningModel = this.hrtf && d < HRTF_DIST ? 'HRTF' : 'equalpower';
      p.distanceModel = 'exponential';
      p.refDistance = REF_DIST;
      p.maxDistance = MAX_DIST;
      p.rolloffFactor = ROLLOFF;
      if (p.positionX) { p.positionX.value = P.x; p.positionY.value = P.y; p.positionZ.value = P.z; } else if (p.setPosition) p.setPosition(P.x, P.y, P.z);
      v.nodes.push(p);
      v.panner = p;
      tail = link(tail, p);
    } else if (pan != null && typeof c.createStereoPanner === 'function') {
      const sp = c.createStereoPanner();
      sp.pan.value = clamp(pan, -1, 1);
      v.nodes.push(sp);
      tail = link(tail, sp);
    }
    tail.connect(bus || this.sfx);
    return v;
  }

  _kill(v, fade = 0.05) {
    if (v.done || v.dying) return;
    v.dying = true;
    const t = this.ctx.currentTime;
    try {
      const g = v.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
    } catch { /* ignore */ }
    for (const s of v.srcs) { try { s.stop(t + fade + 0.01); } catch { /* already stopped */ } }
    v.end = t + fade + 0.01;
  }

  _release(v) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    for (const s of v.srcs) s.onended = null;
    v.nodes.length = 0;
    v.srcs.length = 0;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  _groanToken() {
    const now = this.ctx.currentTime;
    this._gTok = Math.min(4, this._gTok + Math.max(0, now - this._gT) * 4);
    this._gT = now;
    if (this._gTok < 1) return false;
    this._gTok -= 1;
    return true;
  }

  // ---- internals: node factories --------------------------------------------------------------

  _g(v, val = 0) {
    const g = this.ctx.createGain();
    g.gain.value = val;
    v.nodes.push(g);
    return g;
  }

  _flt(v, type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    v.nodes.push(b);
    return b;
  }

  _ws(v, curve) {
    const w = this.ctx.createWaveShaper();
    w.curve = curve;
    v.nodes.push(w);
    return w;
  }

  _start(v, s, t, stop, offset) {
    v.nodes.push(s);
    s.onended = () => { if (--v.live <= 0) this._release(v); };
    if (offset == null) s.start(t); else s.start(t, offset);
    if (Number.isFinite(stop)) s.stop(stop);
    v.srcs.push(s);
    v.live++;
    if (stop > v.end) v.end = stop;
    return s;
  }

  _osc(v, type, f, t, stop) {
    const o = this.ctx.createOscillator();
    if (type === 'organ') {
      if (this._organWave) o.setPeriodicWave(this._organWave); else o.type = 'triangle';
    } else o.type = type;
    o.frequency.value = f;
    return this._start(v, o, t, stop);
  }

  _noise(v, kind, t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[kind] || this.buf.white;
    s.loop = true;
    s.playbackRate.value = rate;
    return this._start(v, s, t, t + dur, Math.random() * (NOISE_SEC - 0.2));
  }

  // Filtered noise with an attack/hold/release envelope and optional exponential filter sweep.
  _burst(v, dest, t, o) {
    const { kind = 'white', type = 'bandpass', f = 1000, f2 = 0, q = 1, a = 0.001, h = 0, d = 0.1, peak = 1, rate = 1 } = o;
    const n = this._noise(v, kind, t, a + h + d + 0.05, rate);
    const fl = this._flt(v, type, f, q);
    if (f2) glide(fl.frequency, t, f, f2, a + h + d);
    const g = this._g(v);
    ahr(g.gain, t, a, h, d, peak);
    link(n, fl, g, dest);
    return g;
  }

  // Oscillator with envelope and optional exponential pitch sweep over `sw` seconds.
  _tone(v, dest, t, o) {
    const { wave = 'sine', f = 440, f2 = 0, sw = 0, a = 0.002, h = 0, d = 0.2, peak = 1 } = o;
    const osc = this._osc(v, wave, f, t, t + a + h + d + 0.05);
    if (f2) glide(osc.frequency, t, f, f2, sw || a + h + d);
    const g = this._g(v);
    ahr(g.gain, t, a, h, d, peak);
    link(osc, g, dest);
    return osc;
  }

  _bell(v, dest, t, f, d, peak, parts = BELL) {
    for (const [r, amp, dm] of parts) this._tone(v, dest, t, { f: f * r, a: 0.002, d: d * dm, peak: peak * amp });
  }

  // Sparse random clicks from one noise source (debris, splinters, vinyl, chains): cheap because
  // all the events are gain automation, not separate nodes. `fade` thins peaks over time.
  _crackle(v, dest, t, dur, o) {
    const { kind = 'white', f = 3000, q = 1, count = 12, peak = 0.5, spread = 1, len = 0.012, fade = 0.7 } = o;
    const g = this._g(v, 0);
    link(this._noise(v, kind, t, dur + 0.1), this._flt(v, 'bandpass', f, q), g, dest);
    const times = [];
    for (let i = 0; i < count; i++) times.push(t + dur * Math.pow(Math.random(), spread));
    times.sort((x, y) => x - y);
    for (const ti of times) {
      const k = 1 - (fade * (ti - t)) / dur;
      g.gain.setValueAtTime(peak * k * (0.15 + 0.85 * Math.random() ** 2), ti);
      g.gain.exponentialRampToValueAtTime(EPS, ti + 0.003 + Math.random() * len);
    }
    return g;
  }
}

// Public methods never throw: runtime errors are swallowed (reported to opts.onError if given).
for (const name of Object.getOwnPropertyNames(AudioEngine.prototype)) {
  const desc = Object.getOwnPropertyDescriptor(AudioEngine.prototype, name);
  if (name === 'constructor' || name[0] === '_' || typeof desc.value !== 'function') continue;
  const fn = desc.value;
  Object.defineProperty(AudioEngine.prototype, name, {
    ...desc,
    value: function (...args) {
      try {
        return fn.apply(this, args);
      } catch (e) {
        try { if (this._onError) this._onError(name, e); } catch { /* ignore */ }
        return name === 'radioSong' ? NOOP_HANDLE : undefined;
      }
    },
  });
}
