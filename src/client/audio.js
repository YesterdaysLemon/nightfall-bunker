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

// Hellhound howl pitch contours: [time fraction, pitch multiplier].
const HOWL = [[0, 0.62], [0.12, 1.0], [0.3, 1.07], [0.6, 1.0], [0.85, 0.88], [1, 0.58]];
const WHIMPER = [[0, 1.0], [0.2, 1.12], [0.55, 0.9], [1, 0.55]];

// Kintsugi (porcelain doll) motif: descending neighbour-tone lullaby, semitones from A5, 4 bars of 3/4.
const LULLABY = [12, 11, 12, 7, 8, 7, 3, 5, 3, 0, -1, 0];
const LULLABY_BASS = [0, -4, -5, -1];            // A, F, E, G# under each bar (harmonic minor)
const CELESTA = [[1, 1, 1], [2, 0.22, 0.5], [4.16, 0.07, 0.2]];
const CUP_NOTES = [1760, 2093, 2637];            // A6, C7, E7: each broken cup climbs the triad
const PORCELAIN = [[2380, 0.14, 0.2], [3915, 0.1, 0.14], [5470, 0.07, 0.1], [7020, 0.05, 0.07]];
const BOSS_BEAT = 0.46;

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
    this._hcache = new Map();
    this._buckets = {};
    this._boss = null;
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
    if (this._boss) this._bossTick(this._boss);
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

  // ---- hellhound rounds -----------------------------------------------------------------------

  // Signature cue: thunder rolls in under a dread swell while a pack of hounds howls around you.
  houndRoundStart() {
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const t = this._now(), dur = 4.6, o = v.out;
    o.gain.value = 0.7;
    // distant thunder: a clap, then irregular swells with the filter slowly closing
    this._burst(v, o, t, { kind: 'pink', type: 'lowpass', f: 2200, a: 0.01, d: 0.45, peak: 0.3 });
    this._tone(v, o, t, { f: 50, f2: 27, sw: 1.4, a: 0.02, d: 1.8, peak: 0.55 });
    const tg = this._g(v, 0), tl = this._flt(v, 'lowpass', 750, 0.6);
    glide(tl.frequency, t, 750, 140, dur);
    tg.gain.setValueAtTime(EPS, t);
    tg.gain.linearRampToValueAtTime(0.9, t + 0.1);
    for (let tt = t + 0.1; tt < t + dur - 1.1;) { tt += rand(0.18, 0.55); tg.gain.linearRampToValueAtTime(rand(0.25, 0.8), tt); }
    tg.gain.exponentialRampToValueAtTime(EPS, t + dur);
    link(this._noise(v, 'brown', t, dur + 0.1), tl, tg, o);
    // dread: low minor-second / tritone cluster whose filter swells open and shut
    const lp = this._flt(v, 'lowpass', 110, 2.2), dg = this._g(v);
    lp.frequency.setValueAtTime(110, t);
    lp.frequency.exponentialRampToValueAtTime(760, t + 3);
    lp.frequency.exponentialRampToValueAtTime(130, t + dur);
    ahr(dg.gain, t, 2.4, 0.8, 1.35, 0.2);
    link(lp, dg, o);
    for (const [f, det] of [[55, -6], [58.27, 5], [77.78, 0], [110, 9]]) {
      const x = this._osc(v, 'sawtooth', f, t, t + dur + 0.05);
      x.detune.setValueAtTime(det, t);
      x.detune.linearRampToValueAtTime(det - 25, t + dur);
      x.connect(lp);
    }
    this._burst(v, o, t + 0.4, { kind: 'pink', type: 'highpass', f: 1800, a: 1.9, d: 0.35, peak: 0.07 });
    // the pack: three howls, staggered and spread across the stereo field, into a dark echo
    const echo = this._echo(v, o, 0.31, 0.4, 1500, 0.4);
    [[0.3, 0, -0.65, 2.3], [0.95, 5, 0.6, 2.1], [1.7, -2, 0.05, 2.5]].forEach(([dt, st, pan, hd]) => {
      const sp = this._pan(v, pan);
      sp.connect(o);
      sp.connect(echo);
      this._howl(v, sp, t + dt, hd, semi(330, st) * rand(0.98, 1.02), 1);
    });
  }

  // Relief: the last howl recedes while a suspended organ chord settles onto D major.
  houndRoundEnd() {
    const v = this._voice(P_CRIT, null, this.music); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = 0.6;
    const far = this._pan(v, Math.random() < 0.5 ? -0.6 : 0.6), hl = this._flt(v, 'lowpass', 1300, 0.7);
    link(hl, far, o);
    this._howl(v, hl, t, 1.3, 392 * rand(0.97, 1.03), 0.45, WHIMPER);
    this._burst(v, o, t, { kind: 'brown', type: 'lowpass', f: 300, f2: 110, a: 0.25, d: 1.5, peak: 0.45 });
    const cl = this._flt(v, 'lowpass', 1700, 0.7), eg = this._g(v);
    ahr(eg.gain, t + 0.1, 0.35, 0.6, 1.0, 0.13);
    link(cl, eg, o);
    for (const [f, g] of [[146.83, 146.83], [196, 185], [220, 220], [293.66, 293.66]]) {
      for (const det of [-6, 5]) {
        const x = this._osc(v, 'organ', f, t, t + 2.15);
        x.detune.value = det;
        x.frequency.setValueAtTime(f, t + 0.55);
        x.frequency.exponentialRampToValueAtTime(g, t + 0.75);
        x.connect(cl);
      }
    }
    this._bell(v, o, t + 0.62, 587.33, 1.4, 0.1, BELL2);
    this._bell(v, o, t + 0.64, 880 * 1.002, 1.1, 0.06, BELL2);
  }

  // Where a hound is about to appear: a sharp electric snap and tear, a boom, a rolling tail.
  lightning(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 0.62 : 0.45;
    const m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), this._g(v, 0.8), o);
    this._burst(v, m, t, { type: 'highpass', f: 2500, d: 0.008, peak: 1.2 });
    this._burst(v, m, t, { f: 1800, q: 0.6, d: 0.05, peak: 0.9 });
    this._crackle(v, m, t, 0.18, { f: 4500, q: 0.7, count: 28, peak: 0.8, spread: 1.8, len: 0.006, fade: 0.6 });
    // ring-modulated buzz under the tear
    const bz = this._osc(v, 'sawtooth', 140, t, t + 0.25), ring = this._g(v, 0), bg = this._g(v);
    glide(bz.frequency, t, 140, 55, 0.22);
    this._osc(v, 'square', 1730, t, t + 0.25).connect(ring.gain);
    env(bg.gain, t, 0.002, 0.2, 0.3);
    link(bz, ring, this._flt(v, 'highpass', 700, 0.7), bg, o);
    // boom, then a rolling rumble that wanders down and away
    this._tone(v, m, t + 0.01, { f: 95, f2: 30, sw: 0.5, d: 0.6, peak: 0.75 });
    const dur = rand(2.2, 2.8), g = this._g(v, 0), lp = this._flt(v, 'lowpass', 900, 0.6);
    glide(lp.frequency, t, 900, 140, dur);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.06);
    for (let tt = t + 0.06; tt < t + dur - 0.7;) { tt += rand(0.12, 0.45); g.gain.linearRampToValueAtTime(rand(0.25, 0.8) * (1 - (tt - t) / dur), tt); }
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    link(this._noise(v, 'brown', t, dur + 0.1), lp, g, o);
  }

  // Low, wet, rumbling growl (1-2 s); pitch, size, flutter and wetness come from the seed.
  houndGrowl(pos, seed = 0) {
    if (!this._ok() || !this._take('growl', 4, 3)) return NOOP_TRACK;
    const h = this._hv(seed), P = validPos(pos), v = this._voice(P_LOW, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = clamp((1.3 + h.len * 0.8) * rand(0.92, 1.08), 1.2, 2.1), f0 = h.f0 * rand(0.95, 1.05);
    v.out.gain.value = 0.2;
    const { src, eg } = this._throat(v, t, dur, f0, h, { vA: VOWELS[2], vB: VOWELS[3], scale: 0.75, q: 4, rough: h.rough, depth: 0.85, drive: 'hard' });
    wobble(src.frequency, t, dur, f0, 0.1, 7, 0.85);
    ahr(eg.gain, t, 0.1, dur * 0.6, dur * 0.4 - 0.1, 3);
    this._tone(v, v.out, t, { f: f0, a: 0.15, h: dur * 0.55, d: dur * 0.3, peak: 0.22 });
    this._burst(v, v.out, t, { kind: 'pink', f: 450, q: 1.2, a: dur * 0.2, h: dur * 0.4, d: dur * 0.4, peak: 0.25 });
    // saliva: soft, low bubbling clicks
    this._crackle(v, v.out, t + 0.05, dur * 0.9, { kind: 'pink', f: 700, q: 1.5, count: Math.round(10 + 20 * h.wet), peak: 0.35 * h.wet, len: 0.02, fade: 0.3 });
    return this._track(v);
  }

  // Aggressive snarl into a single hard bark (0.3-0.6 s).
  houndBark(pos, seed = 0) {
    const h = this._hv(seed), P = validPos(pos), v = this._voice(P_MED, P); if (!v) return NOOP_TRACK;
    const t = this._now(), sn = 0.1 + 0.12 * h.snarl, bd = rand(0.25, 0.34), tb = t + sn, f = h.bark * rand(0.95, 1.05);
    v.out.gain.value = 0.27;
    const s1 = this._throat(v, t, sn + 0.03, h.f0 * 1.6, h, { vA: VOWELS[4], vB: VOWELS[0], scale: 0.95, q: 4, rough: h.rough * 1.4, depth: 0.85, drive: 'fuzz' });
    ahr(s1.eg.gain, t, 0.02, sn * 0.6, sn * 0.4 + 0.02, 2.2);
    const s2 = this._throat(v, tb, bd, f, h, { vA: VOWELS[0], vB: VOWELS[2], scale: 1.25, q: 3.5, rough: 70 + h.rough, depth: 0.35, drive: 'fuzz' });
    const fp = s2.src.frequency;
    fp.setValueAtTime(f * 0.8, tb);
    fp.linearRampToValueAtTime(f * 1.15, tb + 0.04);
    fp.exponentialRampToValueAtTime(f * 0.7, tb + bd);
    ahr(s2.eg.gain, tb, 0.012, bd * 0.3, bd * 0.7, 3.2);
    this._tone(v, v.out, tb, { f: 150, f2: 70, d: 0.08, peak: 0.6 });
    this._burst(v, v.out, tb, { kind: 'pink', type: 'highpass', f: 1800, a: 0.005, d: bd * 0.6, peak: 0.35 });
    return this._track(v);
  }

  // Jaws snapping shut, then tearing.
  houndBite(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out;
    o.gain.value = P ? 0.85 : 0.55;
    const m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), o);
    this._burst(v, m, t, { f: 3400, q: 1.8, d: 0.012, peak: 1.1 });
    this._burst(v, m, t, { type: 'highpass', f: 6000, d: 0.006, peak: 0.6 });
    this._tone(v, m, t, { f: 1150, f2: 520, d: 0.035, peak: 0.35 });
    this._tone(v, o, t, { f: 170, f2: 80, d: 0.07, peak: 0.6 });
    this._burst(v, o, t + 0.02, { kind: 'pink', type: 'lowpass', f: 650, d: 0.1, peak: 0.6 });
    this._crackle(v, o, t + 0.04, 0.28, { kind: 'pink', f: 1600, q: 1.2, count: 26, peak: 0.7, len: 0.018, fade: 0.5, spread: 0.9 });
    this._burst(v, o, t + 0.04, { kind: 'pink', f: 1400, f2: 500, q: 2, a: 0.03, h: 0.1, d: 0.15, peak: 0.45 });
  }

  // A yelp cut short as the hound bursts into flame.
  houndDeath(pos, seed = 0) {
    const h = this._hv(seed), P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out, yd = 0.16 + 0.06 * h.snarl, f = h.bark * 1.6;
    o.gain.value = 0.44;
    const { src, eg } = this._throat(v, t, yd, f, h, { vA: VOWELS[0], vB: VOWELS[1], scale: 1.35, q: 4, rough: 90, depth: 0.2 });
    src.frequency.setValueAtTime(f * 0.9, t);
    src.frequency.linearRampToValueAtTime(f * 1.3, t + 0.05);
    src.frequency.linearRampToValueAtTime(f * 1.1, t + yd);
    eg.gain.setValueAtTime(EPS, t);
    eg.gain.linearRampToValueAtTime(2.6, t + 0.015);
    eg.gain.setValueAtTime(2.6, t + yd - 0.02);
    eg.gain.exponentialRampToValueAtTime(EPS, t + yd + 0.01);
    const tf = t + yd - 0.03, m = this._g(v, 1);
    link(m, this._ws(v, this.curves.soft), this._g(v, 0.8), o);
    this._burst(v, m, tf, { kind: 'brown', type: 'lowpass', f: 900, f2: 200, q: 0.8, a: 0.01, d: 0.45, peak: 1.0 });
    this._tone(v, m, tf, { f: 120, f2: 38, sw: 0.3, d: 0.35, peak: 0.7 });
    this._burst(v, o, tf, { kind: 'pink', f: 350, f2: 2600, q: 1.1, a: 0.07, d: 0.55, peak: 0.8 });
    this._burst(v, o, tf + 0.05, { type: 'highpass', f: 3500, a: 0.04, d: 0.4, peak: 0.15 });
    this._burst(v, o, tf + 0.1, { kind: 'pink', type: 'lowpass', f: 1300, f2: 600, a: 0.08, h: 0.2, d: 0.45, peak: 0.4 });
    this._crackle(v, o, tf + 0.05, 0.8, { f: 2800, q: 0.9, count: 24, peak: 0.45, spread: 1.4 });
  }

  // Claw patter while sprinting: cheap (2 sources), rate-limited, skipped beyond 30 m.
  houndStep(pos) {
    if (!this._ok()) return;
    const P = validPos(pos), L = this._L;
    if (P && Math.hypot(P.x - L.x, P.y - L.y, P.z - L.z) > 30) return;
    if (!this._take('hstep', 8, 14)) return;
    const v = this._voice(P_LOW, P); if (!v) return;
    const t = this._now(), r = rand(0.85, 1.15);
    v.out.gain.value = P ? 0.55 : 0.25;
    this._crackle(v, v.out, t, 0.06, { f: 3800 * r, q: 1.6, count: 3 + ((Math.random() * 2) | 0), peak: 0.9, len: 0.004, fade: 0.3 });
    this._tone(v, v.out, t, { f: 140 * r, f2: 90, d: 0.035, peak: 0.35 });
  }

  // ---- Kintsugi (porcelain boss) --------------------------------------------------------------

  // One of three teacups: clink, tinkling shards, and a tiny bell that climbs A-C-E by `index`.
  teacupBreak(pos, index = 0) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const i = clamp(Math.round(fin(index, 0)), 0, 2), k = 1 + 0.07 * i, t = this._now(), o = v.out;
    o.gain.value = P ? 0.8 : 0.5;
    this._porcelain(v, o, t, k, 1);
    this._shards(v, o, t + 0.02, 0.55, 9, k, 0.18);
    this._crackle(v, o, t + 0.03, 0.5, { f: 6200 * k, q: 6, count: 14, peak: 0.35, spread: 1.7, len: 0.006 });
    this._tone(v, o, t + 0.01, { f: 230 * k, f2: 140, d: 0.05, peak: 0.25 });
    this._bell(v, o, t + 0.09, CUP_NOTES[i], 1.4, 0.12, MUSICBOX);
  }

  // Soft music-box shimmer (~3 s). Starts and ends at a low level so retriggers every ~2.7 s loop.
  figurineChime(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return NOOP_TRACK;
    const t = this._now(), dur = 3, o = v.out;
    o.gain.value = P ? 0.8 : 0.45;
    const mix = this._g(v, 0), trem = this._g(v, 0.75);
    mix.gain.setValueAtTime(EPS, t);
    mix.gain.linearRampToValueAtTime(1, t + 0.35);
    mix.gain.setValueAtTime(1, t + dur - 0.9);
    mix.gain.linearRampToValueAtTime(EPS, t + dur);
    link(this._osc(v, 'sine', 6.5, t, t + dur + 0.05), this._g(v, 0.25), trem.gain);
    link(mix, trem, o);
    const arp = [0, 3, 7, 14, 12, 7, 3, 10];
    for (let i = 0, tt = 0.02; tt < dur - 0.5; i++, tt += 0.21) {
      this._bell(v, mix, t + tt, semi(1760, arp[i % arp.length] - 12 * (i % 2)) * rand(0.998, 1.002), 0.9, 0.1, MUSICBOX);
    }
    for (const f of [3520, 4186, 5274]) this._tone(v, mix, t + rand(0, 0.3), { f: f * rand(0.997, 1.003), a: 0.6, h: dur - 1.6, d: 0.9, peak: 0.018 });
    this._crackle(v, mix, t, dur - 0.3, { f: 8000, q: 1.5, count: 18, peak: 0.08, fade: 0 });
    return this._track(v);
  }

  // Waking her: the lullaby detunes and slows like a dying spring, then porcelain cracks.
  figurineWake(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), dur = 3.5, o = v.out, span = dur - 0.55;
    o.gain.value = P ? 0.78 : 0.45;
    for (let tt = 0, i = 0; tt < span && i < 32; i++) {
      const prog = tt / span, sag = prog * prog;
      const cents = rand(-6, 6) * (1 + 4 * sag) - 300 * sag * prog;
      this._bell(v, o, t + tt, semi(880, LULLABY[i % LULLABY.length] + cents / 100), 1.2 + sag, 0.2 * (1 - 0.35 * prog), MUSICBOX);
      tt += 0.19 * (1 + 1.6 * sag) * rand(0.96, 1.04);
    }
    const bed = this._g(v), lp = this._flt(v, 'lowpass', 600, 0.7);
    ahr(bed.gain, t, 0.8, dur - 1.8, 0.9, 0.05);
    link(lp, bed, o);
    for (const f of [110, 116.54, 164.81]) {
      const x = this._osc(v, 'triangle', f, t, t + dur);
      x.detune.setValueAtTime(0, t);
      x.detune.linearRampToValueAtTime(-120, t + dur);
      x.connect(lp);
    }
    const tc = t + dur - 0.35, m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), this._g(v, 0.5), o);
    this._porcelain(v, o, tc, 0.9, 0.9);
    this._burst(v, m, tc, { f: 2200, q: 1, d: 0.05, peak: 0.55 });
    this._crackle(v, o, tc + 0.01, 0.3, { f: 5000, q: 2, count: 12, peak: 0.4, spread: 1.6, len: 0.005 });
    this._tone(v, o, tc, { f: 240, f2: 110, d: 0.08, peak: 0.35 });
  }

  // Boss fight bed on the music bus: celesta lullaby scheduled a bar at a time over a sour drone.
  // Returns { stop(fade = 1) }; starting it again replaces the previous loop.
  bossMusic() {
    if (!this._ok()) return NOOP_HANDLE;
    if (this._boss) this._boss.handle.stop(0.3);
    const v = this._voice(P_CRIT, null, this.music); if (!v) return NOOP_HANDLE;
    const t = this.ctx.currentTime, END = Infinity, o = v.out;
    v.bg = true;
    v.end = Infinity;
    o.gain.setValueAtTime(0, t);
    o.gain.linearRampToValueAtTime(0.8, t + 2);
    const dl = this._flt(v, 'lowpass', 260, 0.7), dg = this._g(v, 0.07);
    link(dl, dg, o);
    for (const [f, type] of [[55, 'sine'], [55.4, 'triangle'], [77.78, 'sine']]) this._osc(v, type, f, t, END).connect(dl);
    link(this._osc(v, 'sine', 0.09, t, END), this._g(v, 0.03), dg.gain);
    const bus = this._g(v, 1);
    bus.connect(o);
    const st = { v, bus, next: t + 0.3, bar: 0, subs: [], stopped: false, timer: null, handle: null };
    st.handle = {
      stop: (fade = 1) => {
        if (st.stopped) return;
        st.stopped = true;
        if (st.timer != null) clearInterval(st.timer);
        if (this._boss === st) this._boss = null;
        if (!this.ctx) return;
        const f = clamp(fin(fade, 1), 0.02, 8);
        this._kill(v, f);
        for (const s of st.subs) this._kill(s, f);
      },
    };
    this._boss = st;
    if (typeof setInterval === 'function') st.timer = setInterval(() => { try { this._bossTick(st); } catch { /* ignore */ } }, 250);
    this._bossTick(st);
    return st.handle;
  }

  // Porcelain heel on concrete: hard click, short ceramic ring, a little floor.
  bossStep(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out, r = rand(0.96, 1.04);
    o.gain.value = P ? 0.75 : 0.35;
    this._burst(v, o, t, { type: 'highpass', f: 4500, d: 0.005, peak: 1 });
    this._burst(v, o, t, { f: 1900 * r, q: 3, d: 0.025, peak: 0.6 });
    this._tone(v, o, t, { f: 3150 * r, d: 0.045, peak: 0.12 });
    this._tone(v, o, t, { f: 4870 * r, d: 0.03, peak: 0.07 });
    this._tone(v, o, t, { f: 210 * r, f2: 120, d: 0.03, peak: 0.3 });
  }

  // She bursts apart to teleport: a smash, a second of tinkling shards, a draining swirl.
  bossShatter(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now();
    v.out.gain.value = P ? 0.82 : 0.52;
    this._smash(v, t, 0.85, 1.15);
    this._burst(v, v.out, t + 0.05, { kind: 'pink', f: 4000, f2: 500, q: 1.5, a: 0.05, d: 0.6, peak: 0.25 });
    this._tone(v, v.out, t + 0.05, { f: 1760, f2: 440, sw: 0.5, a: 0.05, d: 0.5, peak: 0.04 });
  }

  // She reassembles: a reversed shimmer rushing in, landing on a clink (~0.7 s).
  bossReform(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out, tc = t + 0.62;
    o.gain.value = P ? 0.8 : 0.5;
    for (const f of [1760, 2217.46, 2637, 3520, 4434.92, 5274]) this._swell(v, o, t + rand(0, 0.12), tc, f * rand(0.995, 1.005), 0.05);
    const g = this._g(v), bp = this._flt(v, 'bandpass', 1200, 1.2);
    g.gain.setValueAtTime(0.4 * 0.03, t);
    g.gain.exponentialRampToValueAtTime(0.4, tc);
    g.gain.exponentialRampToValueAtTime(EPS, tc + 0.03);
    glide(bp.frequency, t, 1200, 6500, 0.62);
    link(this._noise(v, 'pink', t, 0.72), bp, g, o);
    this._crackle(v, o, t + 0.1, 0.5, { f: 5500, q: 4, count: 16, peak: 0.25, spread: 0.35, len: 0.006, fade: -0.8 });
    this._porcelain(v, o, tc, 1.1, 0.9);
  }

  // Short glassy shriek (inharmonic sines with flutter) plus a swish.
  bossAttack(pos) {
    const P = validPos(pos), v = this._voice(P_MED, P); if (!v) return;
    const t = this._now(), o = v.out, d = 0.44, f = rand(1250, 1400), end = t + d + 0.05;
    o.gain.value = P ? 0.6 : 0.4;
    const vib = this._g(v, 40), eg = this._g(v);
    this._osc(v, 'sine', 14, t, end).connect(vib);
    ahr(eg.gain, t, 0.03, 0.12, d - 0.15, 0.5);
    const bend = (p, k) => {
      p.setValueAtTime(f * k * 0.8, t);
      p.linearRampToValueAtTime(f * k * 1.18, t + 0.09);
      p.exponentialRampToValueAtTime(f * k * 0.9, t + d);
    };
    for (const [r, a] of [[1, 1], [2.32, 0.45], [3.73, 0.2]]) {
      const x = this._osc(v, 'sine', f * r, t, end);
      bend(x.frequency, r);
      vib.connect(x.detune);
      link(x, this._g(v, a), eg);
    }
    const saw = this._osc(v, 'sawtooth', f / 2, t, end);
    bend(saw.frequency, 0.5);
    link(saw, this._flt(v, 'bandpass', 2900, 6), this._g(v, 0.5), eg);
    eg.connect(o);
    this._burst(v, o, t + 0.07, { kind: 'pink', f: 500, f2: 3000, q: 1.3, a: 0.09, d: 0.16, peak: 0.8 });
  }

  // A chunk breaks off: crack, then a singing glass-harmonica wail beating against itself.
  bossScream(pos) {
    const P = validPos(pos), v = this._voice(P_HIGH, P); if (!v) return;
    const t = this._now(), o = v.out, dur = 2.1, tw = t + 0.05, f = rand(640, 720), end = tw + dur + 0.05;
    o.gain.value = P ? 0.7 : 0.45;
    this._porcelain(v, o, t, 0.85, 1);
    this._shards(v, o, t + 0.02, 0.5, 8, 1, 0.14);
    const bend = (p, k) => {
      p.setValueAtTime(f * k * 0.85, tw);
      p.linearRampToValueAtTime(f * k * 1.12, tw + 0.35);
      p.linearRampToValueAtTime(f * k * 1.05, tw + dur * 0.6);
      p.exponentialRampToValueAtTime(f * k * 0.72, tw + dur);
    };
    const vib = this._g(v, 0), eg = this._g(v);
    vib.gain.setValueAtTime(0, tw);
    vib.gain.linearRampToValueAtTime(22, tw + dur * 0.6);
    this._osc(v, 'sine', 5.2, tw, end).connect(vib);
    ahr(eg.gain, tw, 0.25, dur * 0.4, dur * 0.47, 0.22);
    for (const [k, a] of [[1, 1], [1.059, 0.7], [2.003, 0.3], [3, 0.08]]) {
      const x = this._osc(v, 'sine', f * k, tw, end);
      bend(x.frequency, k);
      vib.connect(x.detune);
      link(x, this._g(v, a), eg);
    }
    eg.connect(o);
    // breathy soprano vowel under the glass
    const sing = this._osc(v, 'sawtooth', f, tw, end), sg = this._g(v);
    bend(sing.frequency, 1);
    vib.connect(sing.detune);
    ahr(sg.gain, tw, 0.3, dur * 0.35, dur * 0.5, 0.9);
    VOWELS[0].forEach((fa, i) => {
      const bp = this._flt(v, 'bandpass', fa * 1.35, 8);
      glide(bp.frequency, tw, fa * 1.35, VOWELS[1][i] * 1.35, dur);
      link(sing, bp, sg);
    });
    sg.connect(o);
    this._burst(v, o, tw, { kind: 'pink', type: 'highpass', f: 3000, a: 0.3, h: 0.6, d: 0.8, peak: 0.06 });
  }

  // Final shatter at her position, plus a golden, slightly eerie choir swell everyone hears.
  bossDeath(pos) {
    const P = validPos(pos), t = this._now(), v = this._voice(P_HIGH, P);
    if (v) {
      v.out.gain.value = P ? 0.66 : 0.42;
      this._smash(v, t, 1.0, 1.6);
      this._smash(v, t + 0.22, 0.6, 0.8);
      this._tone(v, v.out, t, { f: 70, f2: 30, sw: 0.6, d: 0.8, peak: 0.6 });
    }
    const c = this._voice(P_CRIT, null, this.music); if (!c) return;
    const tc = t + 0.15, dur = 3.6;
    c.out.gain.value = 0.8;
    const bus = this._g(c, 0.3), eg = this._g(c);
    ahr(eg.gain, tc, 0.9, 1.3, 1.4, 2.2);
    for (const [f1, f2, q] of [[800, 520, 6], [1150, 880, 7], [2800, 2500, 8]]) {
      const bp = this._flt(c, 'bandpass', f1, q);
      glide(bp.frequency, tc, f1, f2, dur);
      link(bus, bp, eg);
    }
    eg.connect(c.out);
    const vd = this._g(c, 8);
    this._osc(c, 'sine', 5.1, tc, tc + dur + 0.1).connect(vd);
    // A major with a sharp-4 that leans into the fifth
    for (const [f, g] of [[220, 220], [277.18, 277.18], [329.63, 329.63], [440, 440], [622.25, 659.25]]) {
      for (const det of [-7, 6]) {
        const o = this._osc(c, 'sawtooth', f, tc, tc + dur + 0.1);
        o.detune.value = det;
        o.frequency.setValueAtTime(f, tc + 1.3);
        o.frequency.exponentialRampToValueAtTime(g, tc + 1.8);
        vd.connect(o.detune);
        o.connect(bus);
      }
    }
    this._tone(c, c.out, tc, { wave: 'organ', f: 110, a: 0.9, h: 1.3, d: 1.4, peak: 0.12 });
    // golden shimmer on top
    const sh = this._g(c, 0.7);
    link(this._osc(c, 'sine', 7, tc, tc + dur + 0.1), this._g(c, 0.3), sh.gain);
    sh.connect(c.out);
    for (const f of [1760, 2217.46, 2637, 3520, 4434.92]) this._tone(c, sh, tc + rand(0.2, 0.7), { f: f * rand(0.997, 1.003), a: 0.6, h: 1.0, d: 1.3, peak: 0.035 });
    this._crackle(c, c.out, tc + 0.3, 2.6, { f: 7500, q: 1, count: 30, peak: 0.08, fade: 0.5 });
  }

  // Pickup for her golden reward: a warm strummed A major chord, golden bells and sparkle.
  goldLeaf() {
    const v = this._voice(P_CRIT, null, this.dry); if (!v) return;
    const t = this._now(), o = v.out, lp = this._flt(v, 'lowpass', 2400, 0.7);
    o.gain.value = 0.55;
    lp.connect(o);
    [220, 277.18, 329.63, 440, 554.37].forEach((f, i) => this._tone(v, lp, t + i * 0.028, { wave: 'organ', f, a: 0.01, h: 0.25, d: 1.1, peak: 0.09 }));
    [[0.08, 1760], [0.15, 2217.46], [0.22, 2637], [0.3, 3520]].forEach(([dt, f]) => this._bell(v, o, t + dt, f, 0.9, 0.1, BELL));
    this._crackle(v, o, t + 0.05, 0.9, { f: 7500, q: 1.2, count: 24, peak: 0.18, fade: 0.8 });
    this._burst(v, o, t, { kind: 'pink', type: 'highpass', f: 5000, a: 0.15, d: 0.7, peak: 0.08 });
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

  // ---- internals: hounds and porcelain --------------------------------------------------------

  // Token bucket per sound family (`cap` burst, `rate` per second) for sounds called in bulk.
  _take(key, cap, rate) {
    const now = this.ctx.currentTime;
    const b = this._buckets[key] || (this._buckets[key] = { n: cap, t: now });
    b.n = Math.min(cap, b.n + Math.max(0, now - b.t) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }

  // Deterministic per-seed hound voice (shape matches _zv so _throat can use it).
  _hv(seed) {
    const key = seedInt(seed);
    let h = this._hcache.get(key);
    if (!h) {
      const r = mulberry(key ^ 0x2c1b3c6d);
      h = {
        f0: 46 + r() * 30,
        bark: 210 + r() * 150,
        tract: 1.0 + r() * 0.35,
        rough: 22 + r() * 20,
        wet: 0.3 + r() * 0.6,
        snarl: r(),
        len: r(),
        va: VOWELS[2],
        vb: VOWELS[3],
      };
      if (this._hcache.size > 256) this._hcache.clear();
      this._hcache.set(key, h);
    }
    return h;
  }

  // Stereo placement inside one voice (falls back to a plain gain).
  _pan(v, p) {
    const c = this.ctx;
    if (typeof c.createStereoPanner !== 'function') return this._g(v, 1);
    const sp = c.createStereoPanner();
    sp.pan.value = clamp(p, -1, 1);
    v.nodes.push(sp);
    return sp;
  }

  // Feedback echo into `dest`; returns its input. Lives only as long as the voice's sources.
  _echo(v, dest, time, fb, lpf, wet) {
    const d = this.ctx.createDelay(1);
    d.delayTime.value = time;
    v.nodes.push(d);
    const inp = this._g(v, 1), lp = this._flt(v, 'lowpass', lpf, 0.7);
    link(inp, d, lp, this._g(v, fb), d);
    link(lp, this._g(v, wet), dest);
    return inp;
  }

  // Unearthly howl: a detuned saw pair and sub, pitch-bent along `shape`, through oo-aa-oo
  // formants, with a ghostly sine a tritone above the octave riding the same contour.
  _howl(v, dest, t, dur, f0, peak = 1, shape = HOWL) {
    const end = t + dur + 0.05;
    const bend = (p, mul) => {
      p.setValueAtTime(f0 * mul * shape[0][1], t);
      for (let i = 1; i < shape.length; i++) p.linearRampToValueAtTime(f0 * mul * shape[i][1], t + dur * shape[i][0]);
    };
    const vib = this._g(v, 0), mix = this._g(v, 1), eg = this._g(v);
    this._osc(v, 'sine', rand(4.5, 6), t, end).connect(vib);
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(28, t + dur * 0.5);
    for (const [mul, det, amp] of [[1, -7, 0.6], [1, 8, 0.6], [0.5, 0, 0.35]]) {
      const o = this._osc(v, 'sawtooth', f0 * mul, t, end);
      o.detune.value = det;
      bend(o.frequency, mul);
      vib.connect(o.detune);
      link(o, this._g(v, amp), mix);
    }
    ahr(eg.gain, t, dur * 0.18, dur * 0.45, dur * 0.37, 2.2 * peak);
    const OO = VOWELS[1], AA = VOWELS[0];
    for (let i = 0; i < 3; i++) {
      const bp = this._flt(v, 'bandpass', OO[i] * 1.1, 7);
      bp.frequency.setValueAtTime(OO[i] * 1.1, t);
      bp.frequency.linearRampToValueAtTime(AA[i] * 1.1, t + dur * 0.25);
      bp.frequency.linearRampToValueAtTime(OO[i] * 1.1, t + dur * 0.95);
      link(mix, bp, eg);
    }
    eg.connect(dest);
    const gh = this._osc(v, 'sine', f0 * 2.83, t, end), gg = this._g(v);
    bend(gh.frequency, 2.83);
    vib.connect(gh.detune);
    ahr(gg.gain, t + dur * 0.1, dur * 0.3, dur * 0.3, dur * 0.3, 0.05 * peak);
    link(gh, gg, dest);
  }

  // Porcelain impact: a hard tick and inharmonic ceramic partials (k scales pitch, s level).
  _porcelain(v, dest, t, k = 1, s = 1) {
    this._burst(v, dest, t, { type: 'highpass', f: 5000, d: 0.006, peak: 0.9 * s });
    this._burst(v, dest, t, { f: 3200 * k, q: 2, d: 0.02, peak: 0.7 * s });
    for (const [f, d, p] of PORCELAIN) this._tone(v, dest, t, { f: f * k * rand(0.99, 1.01), d, peak: p * s });
  }

  // `n` tiny pitched shard pings, denser early and thinning out over `dur`.
  _shards(v, dest, t, dur, n, k, peak) {
    for (let i = 0; i < n; i++) {
      const ti = t + dur * Math.pow(Math.random(), 1.6);
      this._tone(v, dest, ti, { f: rand(2600, 7500) * k, d: rand(0.03, 0.11), peak: peak * rand(0.35, 1) * (1 - (0.6 * (ti - t)) / dur) });
    }
  }

  // Big porcelain smash: driven crack, body thump, crunch, then shards tinkling for ~len s.
  _smash(v, t, k = 1, len = 1) {
    const o = v.out, m = this._g(v, 1);
    link(m, this._ws(v, this.curves.hard), o);
    this._burst(v, m, t, { type: 'highpass', f: 3000, d: 0.012, peak: 1.1 * k });
    this._burst(v, m, t, { f: 2600, q: 0.8, d: 0.08, peak: 0.8 * k });
    this._tone(v, m, t, { f: 160, f2: 60, d: 0.18, peak: 0.7 * k });
    this._porcelain(v, o, t, 0.8, 0.9 * k);
    this._burst(v, o, t + 0.005, { kind: 'pink', f: 3000, f2: 1400, q: 0.9, a: 0.005, d: 0.3, peak: 0.55 * k });
    this._shards(v, o, t + 0.02, len, Math.round(12 + 6 * len), 1, 0.24);
    this._crackle(v, o, t + 0.02, len, { f: 5200, q: 5, count: Math.round(40 * len), peak: 0.55, spread: 1.3, len: 0.006, fade: 0.4 });
    this._crackle(v, o, t + 0.05, len * 0.9, { f: 2400, q: 3, count: Math.round(18 * len), peak: 0.45, spread: 1.4, len: 0.01, fade: 0.5 });
  }

  // Reversed tone: exponential swell from t that snaps off at tEnd.
  _swell(v, dest, t, tEnd, f, peak) {
    const o = this._osc(v, 'sine', f, t, tEnd + 0.06), g = this._g(v);
    g.gain.setValueAtTime(Math.max(peak * 0.03, EPS), t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 2 * EPS), tEnd);
    g.gain.exponentialRampToValueAtTime(EPS, tEnd + 0.04);
    link(o, g, dest);
  }

  // Unbudgeted short-lived voice feeding `dest`: notes scheduled inside a background loop.
  _sub(dest) {
    const t = this.ctx.currentTime;
    const v = { prio: P_LOW, t0: t, end: t + 0.5, nodes: [], srcs: [], live: 0, dying: false, done: false, bg: true, out: null };
    this.voices.push(v);
    v.out = this._g(v, 1);
    v.out.connect(dest);
    return v;
  }

  // Look-ahead scheduler for bossMusic: keeps ~1.6 s of bars queued (driven by update() and a timer).
  _bossTick(st) {
    if (st.stopped || !this._ok()) return;
    const now = this.ctx.currentTime;
    if (st.subs.length > 4) st.subs = st.subs.filter((s) => !s.done);
    if (st.next < now) st.next = now + 0.05;   // fell behind (throttled tab): skip ahead, never burst
    while (st.next < now + 1.6) {
      this._bossBar(st, st.next, st.bar++);
      st.next += 3 * BOSS_BEAT;
    }
  }

  // One 3/4 bar: lullaby on celesta (every other phrase a sour semitone lower) over a low note.
  _bossBar(st, t, bar) {
    const v = this._sub(st.bus);
    st.subs.push(v);
    const shift = (bar >> 2) % 2 ? -1 : 0;
    v.out.gain.value = 0.9;
    for (let b = 0; b < 3; b++) {
      const n = LULLABY[(bar * 3 + b) % LULLABY.length] + shift;
      const cents = Math.random() < 0.12 ? rand(-45, -25) : rand(-6, 6);
      this._bell(v, v.out, t + b * BOSS_BEAT + rand(0, 0.015), semi(880, n + cents / 100), 1.3, b === 0 ? 0.1 : 0.075, CELESTA);
    }
    this._bell(v, v.out, t, semi(220, LULLABY_BASS[bar % 4] + shift), 1.8, 0.07, CELESTA);
  }
}

// Fallback results so handle-returning methods stay safe to use even if synthesis throws.
const FALLBACK = { __proto__: null, radioSong: NOOP_HANDLE, bossMusic: NOOP_HANDLE, houndGrowl: NOOP_TRACK, houndBark: NOOP_TRACK, figurineChime: NOOP_TRACK };

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
        return FALLBACK[name];
      }
    },
  });
}
