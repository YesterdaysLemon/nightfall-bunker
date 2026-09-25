// Touch controls: a floating move stick under the left thumb, drag-to-look on
// the right, a fire button you can keep dragging to aim, an action cluster, a
// contextual Use button, optional gyro aiming and an editable layout.
// Everything writes into the same Input state keyboard and mouse use.

const LAYOUT_KEY = 'nb_touch_layout';
const LOOK_PX = 1.8;       // finger pixels -> mouse-equivalent pixels
const STICK_R = 58;        // stick travel radius (px, before scale)
const STICK_ZONE = 0.42;   // left fraction of the screen that spawns the stick

// Centre positions as fractions of the viewport, sizes in px at 390px height.
export const DEFAULT_LAYOUT = {
  fire: { x: 0.86, y: 0.68, s: 88 },
  fire2: { x: 0.075, y: 0.38, s: 58 },
  ads: { x: 0.94, y: 0.43, s: 56 },
  swap: { x: 0.835, y: 0.38, s: 50 },
  grenade: { x: 0.742, y: 0.5, s: 50 },
  knife: { x: 0.72, y: 0.73, s: 50 },
  reload: { x: 0.77, y: 0.9, s: 52 },
  jump: { x: 0.957, y: 0.72, s: 52 },
  crouch: { x: 0.93, y: 0.92, s: 48 },
  use: { x: 0.53, y: 0.87, s: 46 },
  pause: { x: 0.965, y: 0.075, s: 38 },
};

const ICON = {
  fire: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  ads: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  grenade: '<circle cx="11" cy="14" r="6"/><path d="M11 8V5h4M15 5l3-2"/>',
  knife: '<path d="M5 19l9-9 5-6-2 7-8 9z"/><path d="M4 20l2-2"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4v4h-4"/>',
  jump: '<path d="M6 14l6-6 6 6"/><path d="M6 19h12"/>',
  crouch: '<path d="M6 8l6 6 6-6"/><path d="M6 19h12"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
};
const LABEL = { fire: 'Fire', fire2: 'Fire', ads: 'Aim', swap: 'Swap weapon', grenade: 'Grenade', knife: 'Knife', reload: 'Reload', jump: 'Jump', crouch: 'Crouch', use: 'Use', pause: 'Pause' };

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (saved && saved.buttons) {
      const merged = {};
      for (const k of Object.keys(DEFAULT_LAYOUT)) merged[k] = { ...DEFAULT_LAYOUT[k], ...(saved.buttons[k] || {}) };
      return { buttons: merged, scale: saved.scale || 1, opacity: saved.opacity ?? 0.55 };
    }
  } catch { /* fall through */ }
  return { buttons: structuredClone(DEFAULT_LAYOUT), scale: 1, opacity: 0.55 };
}

export class TouchControls {
  constructor(input, opts = {}) {
    this.input = input;
    this.settings = opts.settings || {};
    this.onPause = opts.onPause || (() => {});
    this.layout = loadLayout();
    this.active = false;       // overlay shown (in play)
    this.editing = false;
    this.pointers = new Map(); // pointerId -> state
    this.gyroOn = false;
    this._motion = null;

    const el = document.createElement('div');
    el.id = 'touch';
    el.hidden = true;
    el.setAttribute('aria-label', 'Touch controls');
    this.el = el;
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.stick.innerHTML = '<i></i>';
    el.append(this.stick);
    this.buttons = {};
    for (const id of Object.keys(DEFAULT_LAYOUT)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb tb-${id}`;
      b.dataset.act = id;
      b.setAttribute('aria-label', LABEL[id]);
      const icon = ICON[id === 'fire2' ? 'fire' : id];
      b.innerHTML = icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '<span></span>';
      el.append(b);
      this.buttons[id] = b;
    }
    this.useLabel = this.buttons.use.querySelector('span');
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'tedit';
    this.toolbar.hidden = true;
    this.toolbar.innerHTML = `
      <span>Drag buttons to move them</span>
      <button type="button" data-t="smaller" aria-label="Smaller buttons">−</button>
      <button type="button" data-t="bigger" aria-label="Bigger buttons">+</button>
      <button type="button" data-t="fainter">Fainter</button>
      <button type="button" data-t="bolder">Bolder</button>
      <button type="button" data-t="reset">Reset</button>
      <button type="button" data-t="done" class="primary">Done</button>`;
    el.append(this.toolbar);
    document.body.append(el);

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.toolbar.addEventListener('click', (e) => this.toolbarAction(e));
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:var(--sat) var(--sar) var(--sab) var(--sal)';
    document.body.append(this.probe);
    const relayout = () => this.applyLayout();
    addEventListener('resize', relayout);
    addEventListener('orientationchange', () => setTimeout(relayout, 250));
    globalThis.visualViewport?.addEventListener('resize', relayout);
    this.applyLayout();
  }

  get scale() {
    return Math.max(0.8, Math.min(1.6, Math.min(innerWidth, innerHeight) / 390)) * this.layout.scale;
  }

  // Safe rectangle: the screen minus notch / home-indicator insets.
  safe() {
    const cs = getComputedStyle(this.probe);
    const l = parseFloat(cs.paddingLeft) || 0, r = parseFloat(cs.paddingRight) || 0;
    const t = parseFloat(cs.paddingTop) || 0, b = parseFloat(cs.paddingBottom) || 0;
    return { l, t, w: innerWidth - l - r, h: innerHeight - t - b };
  }

  applyLayout() {
    const k = this.scale;
    const S = this.safe();
    this.safeRect = S;
    for (const [id, b] of Object.entries(this.buttons)) {
      const L = this.layout.buttons[id];
      const s = L.s * k;
      b.style.width = id === 'use' ? 'auto' : `${s}px`;
      b.style.minWidth = id === 'use' ? `${s * 2.4}px` : '';
      b.style.height = `${s}px`;
      b.style.left = `${S.l + L.x * S.w}px`;
      b.style.top = `${S.t + L.y * S.h}px`;
    }
    this.el.style.setProperty('--tb-opacity', String(this.layout.opacity));
    this.stickR = STICK_R * k;
    this.stick.style.width = this.stick.style.height = `${this.stickR * 2}px`;
    this.parkStick();
  }

  saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* private mode */ }
  }

  parkStick() {
    const S = this.safeRect || { l: 0, t: 0, w: innerWidth, h: innerHeight };
    this.stick.classList.remove('live');
    this.stick.style.left = `${S.l + 0.14 * S.w}px`;
    this.stick.style.top = `${S.t + 0.72 * S.h}px`;
    this.stick.firstChild.style.transform = 'translate(-50%, -50%)';
  }

  show(on) {
    this.active = on;
    this.el.hidden = !on && !this.editing;
    if (!on) this.releaseAll();
  }

  // Context button: short label for whatever the player could use right now.
  setUse(target) {
    const b = this.buttons.use;
    const text = this.editing ? 'Use' : target?.short || '';
    if (b.dataset.text !== text) {
      b.dataset.text = text;
      this.useLabel.textContent = text;
    }
    b.classList.toggle('off', !text && !this.editing);
  }

  // --- Pointer handling ------------------------------------------------------------------
  down(e) {
    if (e.pointerType === 'mouse' && !this.editing) return;
    e.preventDefault();
    const I = this.input;
    const btn = e.target.closest('[data-act]');
    try { this.el.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    if (this.editing) {
      if (btn) this.pointers.set(e.pointerId, { role: 'edit', id: btn.dataset.act });
      return;
    }
    if (btn && !btn.classList.contains('off')) {
      const id = btn.dataset.act;
      btn.classList.add('on');
      const st = { role: 'button', id, x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, st);
      switch (id) {
        case 'fire': case 'fire2':
          I.mouse.left = true; I.pressed.add('Mouse0'); st.role = 'fire'; break;
        case 'ads': I.mouse.right = !I.mouse.right; btn.classList.toggle('latched', I.mouse.right); break;
        case 'crouch': {
          const on = !I.keys.has('KeyC');
          if (on) I.keys.add('KeyC'); else I.keys.delete('KeyC');
          btn.classList.toggle('latched', on);
          break;
        }
        case 'reload': I.pressed.add('KeyR'); break;
        case 'jump': I.pressed.add('Space'); break;
        case 'grenade': I.pressed.add('KeyG'); break;
        case 'knife': I.pressed.add('KeyV'); break;
        case 'swap': I.mouse.wheel += 1; break;
        case 'use': I.pressed.add('KeyF'); I.keys.add('KeyF'); break;
        case 'pause': this.onPause(); break;
        default:
      }
      return;
    }
    if (e.clientX < innerWidth * STICK_ZONE) {
      this.pointers.set(e.pointerId, { role: 'stick', bx: e.clientX, by: e.clientY });
      this.stick.classList.add('live');
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      return;
    }
    this.pointers.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
  }

  move(e) {
    const st = this.pointers.get(e.pointerId);
    if (!st) return;
    e.preventDefault();
    const I = this.input;
    if (st.role === 'edit') {
      const L = this.layout.buttons[st.id];
      const S = this.safeRect;
      L.x = Math.max(0.03, Math.min(0.97, (e.clientX - S.l) / S.w));
      L.y = Math.max(0.05, Math.min(0.95, (e.clientY - S.t) / S.h));
      this.applyLayout();
      return;
    }
    if (st.role === 'stick') {
      let dx = e.clientX - st.bx, dy = e.clientY - st.by;
      const d = Math.hypot(dx, dy), R = this.stickR;
      if (d > R) { dx *= R / d; dy *= R / d; }
      I.move.x = dx / R;
      I.move.y = dy / R;
      // Pushing well past the rim while moving forward sprints.
      I.touchSprint = d > R * 1.25 && dy < -R * 0.5;
      this.stick.firstChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.stick.classList.toggle('sprint', I.touchSprint);
      return;
    }
    if (st.role === 'look' || st.role === 'fire') {
      const k = LOOK_PX * (this.settings.touchSens ?? 1);
      I.mouse.dx += (e.clientX - st.x) * k;
      I.mouse.dy += (e.clientY - st.y) * k;
      I.lookActive = true;
      st.x = e.clientX; st.y = e.clientY;
    }
  }

  up(e) {
    const st = this.pointers.get(e.pointerId);
    if (!st) return;
    this.pointers.delete(e.pointerId);
    const I = this.input;
    if (st.role === 'edit') { this.saveLayout(); return; }
    if (st.role === 'stick') {
      I.move.x = 0; I.move.y = 0; I.touchSprint = false;
      this.stick.classList.remove('sprint');
      this.parkStick();
      return;
    }
    if (st.role === 'fire') {
      const stillFiring = [...this.pointers.values()].some((p) => p.role === 'fire');
      if (!stillFiring) I.mouse.left = false;
    }
    if (st.id === 'use') I.keys.delete('KeyF');
    if (st.id) this.buttons[st.id]?.classList.remove('on');
  }

  releaseAll() {
    const I = this.input;
    this.pointers.clear();
    I.move.x = 0; I.move.y = 0; I.touchSprint = false;
    I.mouse.left = false;
    I.keys.delete('KeyF');
    for (const b of Object.values(this.buttons)) b.classList.remove('on');
    this.parkStick();
  }

  // Latched buttons can be cleared by the game (e.g. weapon switch drops aim).
  syncLatches() {
    this.buttons.ads.classList.toggle('latched', !!this.input.mouse.right);
    this.buttons.crouch.classList.toggle('latched', this.input.keys.has('KeyC'));
  }

  // --- Layout editor ---------------------------------------------------------------------
  edit(on) {
    this.editing = on;
    this.el.classList.toggle('editing', on);
    this.toolbar.hidden = !on;
    this.el.hidden = !on && !this.active;
    this.setUse(on ? { short: 'Use' } : null);
    if (!on) this.saveLayout();
  }

  toolbarAction(e) {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (!t) return;
    const L = this.layout;
    if (t === 'smaller') L.scale = Math.max(0.7, L.scale - 0.1);
    if (t === 'bigger') L.scale = Math.min(1.6, L.scale + 0.1);
    if (t === 'fainter') L.opacity = Math.max(0.2, L.opacity - 0.1);
    if (t === 'bolder') L.opacity = Math.min(1, L.opacity + 0.1);
    if (t === 'reset') this.layout = { buttons: structuredClone(DEFAULT_LAYOUT), scale: 1, opacity: 0.55 };
    if (t === 'done') { this.edit(false); this.onEditDone?.(); return; }
    this.applyLayout();
    this.saveLayout();
  }

  // --- Gyro aiming ------------------------------------------------------------------------
  // Must be called from a user gesture (iOS asks for permission).
  async setGyro(on) {
    if (!on) {
      if (this._motion) removeEventListener('devicemotion', this._motion);
      this._motion = null;
      this.gyroOn = false;
      return true;
    }
    const DM = globalThis.DeviceMotionEvent;
    if (!DM) return false;
    if (typeof DM.requestPermission === 'function') {
      try { if ((await DM.requestPermission()) !== 'granted') return false; } catch { return false; }
    }
    this._motion = (ev) => this.onMotion(ev);
    addEventListener('devicemotion', this._motion);
    this.gyroOn = true;
    return true;
  }

  onMotion(ev) {
    if (!this.active || this.editing) return;
    const r = ev.rotationRate;
    if (!r || ev.interval == null) return;
    const dt = Math.min(0.05, (ev.interval > 1 ? ev.interval / 1000 : ev.interval) || 0.016);
    const angle = (screen.orientation?.angle ?? globalThis.orientation ?? 0) % 360;
    const a = (r.beta || 0), b = (r.gamma || 0);
    // Map device-axis rates to camera yaw/pitch for the current screen rotation.
    let yawRate, pitchRate;
    if (angle === 90) { yawRate = a; pitchRate = -b; }
    else if (angle === 270 || angle === -90) { yawRate = -a; pitchRate = b; }
    else { yawRate = b; pitchRate = a; }
    const k = (Math.PI / 180) * dt * (this.settings.gyroSens ?? 1);
    this.input.lookRad.yaw += yawRate * k;
    this.input.lookRad.pitch += pitchRate * k;
  }
}
