// Keyboard + mouse. Normally uses pointer lock; when the browser refuses it
// (embedded views, some kiosks) it falls back to free-look: the cursor is
// hidden over the canvas, movement turns the view, and holding the cursor
// near an edge keeps turning. Edge-triggered presses are cleared each frame.

const EDGE = 0.07;        // fraction of the screen that acts as a turn zone
const EDGE_SPEED = 900;   // px/s of virtual mouse travel at the very edge

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.physicalKeys = new Map(); // physical code -> canonical action at keydown
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, x: -1, y: -1, over: false };
    this.locked = false;
    this.enabled = false;
    this.typing = false;
    this.fallback = false;
    this.lockFails = 0;       // refused lock attempts in a row (see lockFailed)
    this.unlockedAt = -1e9;   // when the lock last ended (browsers refuse a quick re-lock)
    this.lockTimer = 0;
    this.attempt = 0;         // lock attempts; a refusal counts once per attempt
    this.counted = 0;
    // Touch: analog stick vector, sprint, look in radians (gyro), no pointer lock.
    this.touchMode = false;
    this.move = { x: 0, y: 0 };
    this.touchSprint = false;
    this.lookRad = { yaw: 0, pitch: 0 };
    this.lookActive = false;
    this.onLockChange = null;
    this.onFallback = null;
    this.onNeedClick = null;
    // Rebinding: physical key -> the key the game checks. Keys whose own action
    // was moved elsewhere are dropped (so a rebound W stops walking forward).
    this.remap = new Map();
    this.freed = new Set();
    // Toggle (press once) instead of hold, for aim, sprint and crouch.
    this.toggles = { aim: false, sprint: false, crouch: false };
    this.latch = { aim: false, sprint: false, crouch: false };

    addEventListener('keydown', (e) => {
      if (!this.enabled || this.typing) return;
      const code = this.physicalKeys.get(e.code) || this.canon(e.code);
      if (!code) return;
      if (code === 'Tab' || code === 'Space' || code.startsWith('Arrow') || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'Escape' && this.fallback && this.locked) this.setLocked(false);
      if (!e.repeat && !this.physicalKeys.has(e.code)) this.pressed.add(code);
      this.physicalKeys.set(e.code, code);
      this.keys.add(code);
    });
    addEventListener('keyup', (e) => {
      const code = this.physicalKeys.get(e.code);
      this.physicalKeys.delete(e.code);
      if (code && ![...this.physicalKeys.values()].includes(code)) this.keys.delete(code);
    });
    addEventListener('blur', () => {
      this.resetKeys();
      this.latch.aim = this.latch.sprint = this.latch.crouch = false;
      this.mouse.left = this.mouse.right = false;
      if (this.fallback && this.locked) this.setLocked(false);
    });
    addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.over = e.target === canvas;
      // Touch look comes from the touch layer; ignore compatibility mouse events.
      if (!this.locked || this.touchMode) return;
      if (this.fallback && !this.mouse.over) return;
      // Ignore the occasional huge jump some browsers emit on lock.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mouseenter', () => { this.mouse.over = true; });
    canvas.addEventListener('mouseleave', () => { this.mouse.over = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.pressed.add('Mouse0'); }
      if (e.button === 2) { this.mouse.right = true; this.pressed.add('Mouse2'); }
      if (e.button === 3) this.pressed.add('KeyV');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.fallback) return;
      this.setLocked(document.pointerLockElement === canvas);
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed(null));
  }

  // bindings: { action: [physical codes] }, defaults: { action: [the game's codes] }.
  setBindings(bindings, defaults) {
    this.remap.clear();
    this.freed.clear();
    for (const [action, canon] of Object.entries(defaults)) {
      for (const phys of bindings[action] || canon) this.remap.set(phys, canon[0]);
    }
    for (const canon of Object.values(defaults)) for (const c of canon) if (!this.remap.has(c)) this.freed.add(c);
    this.resetKeys();
  }

  resetKeys() {
    this.keys.clear();
    this.physicalKeys.clear();
    this.pressed.clear();
  }

  // The game's code for a physical key, or null when that key is unbound.
  canon(code) {
    if (this.remap.has(code)) return this.remap.get(code);
    return this.freed.has(code) ? null : code;
  }

  setToggles(t) {
    Object.assign(this.toggles, t);
    this.latch.aim = this.latch.sprint = this.latch.crouch = false;
  }

  // Held-or-toggled states the game asks for each frame (touch has its own latches).
  aiming() { return this.touchMode || !this.toggles.aim ? this.mouse.right : this.latch.aim; }
  sprintHeld() { return this.touchSprint || (this.toggles.sprint && !this.touchMode ? this.latch.sprint : this.keys.has('ShiftLeft')); }
  crouchHeld() {
    if (this.toggles.crouch && !this.touchMode) return this.latch.crouch;
    return this.keys.has('KeyC') || this.keys.has('ControlLeft');
  }
  // Sprint toggles off when the player stops pushing forward.
  endSprint() { this.latch.sprint = false; }

  setLocked(on) {
    if (this.locked === on) return;
    this.locked = on;
    clearTimeout(this.lockTimer);
    if (on) this.lockFails = 0;
    else this.unlockedAt = performance.now();
    document.body.classList.toggle('freelook', on && this.fallback);
    if (!on) {
      this.resetKeys();
      this.mouse.left = this.mouse.right = false;
      this.move.x = this.move.y = 0;
      this.touchSprint = false;
      this.latch.aim = this.latch.sprint = this.latch.crouch = false;
    }
    this.onLockChange?.(on);
  }

  lock() {
    if (this.fallback || this.touchMode) { this.setLocked(true); return; }
    this.attempt++;
    const attempt = (opts) => {
      const p = this.canvas.requestPointerLock(opts);
      return p && p.then ? p : Promise.resolve();
    };
    try {
      attempt({ unadjustedMovement: true })
        .catch((err) => (err?.name === 'NotSupportedError' ? attempt() : Promise.reject(err)))
        .catch((err) => this.lockFailed(err));
    } catch (err) {
      this.lockFailed(err);
    }
    // Some embedded browsers neither lock nor report an error: treat silence as a refusal.
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => { if (!this.locked && !this.fallback) this.lockFailed({ name: 'Timeout' }); }, 1500);
  }

  // Structural refusals switch to free-look. Otherwise it may just need another
  // click (a browser refuses to re-lock right after Esc), but a second refusal
  // away from that moment means this browser will not lock (an embedded view
  // such as an app's browser pane): switch to free-look rather than asking forever.
  lockFailed(err) {
    clearTimeout(this.lockTimer);
    if (this.locked) return;
    const name = err?.name || '';
    // (Chrome both rejects the request and fires pointerlockerror: count it once.)
    if (this.counted !== this.attempt && performance.now() - this.unlockedAt > 1500) {
      this.counted = this.attempt;
      this.lockFails++;
    }
    if (name === 'WrongDocumentError' || name === 'NotSupportedError' || this.lockFails >= 2) {
      if (!this.fallback) {
        this.fallback = true;
        this.onFallback?.();
      }
      this.setLocked(true);
      return;
    }
    this.onNeedClick?.();
  }

  unlock() {
    if (this.fallback || this.touchMode) { this.setLocked(false); return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Once per frame: flip toggles on this frame's presses, then free-look edge turning.
  beginFrame(dt) {
    const T = this.toggles, L = this.latch, P = this.pressed;
    if (T.aim && P.has('Mouse2')) L.aim = !L.aim;
    if (T.sprint && P.has('ShiftLeft')) L.sprint = !L.sprint;
    if (T.crouch && (P.has('KeyC') || P.has('ControlLeft'))) L.crouch = !L.crouch;
    if (!this.fallback || this.touchMode || !this.locked || !this.mouse.over) return;
    const w = innerWidth, h = innerHeight, { x, y } = this.mouse;
    const ex = EDGE * w, ey = EDGE * h;
    if (x < ex) this.mouse.dx -= ((ex - x) / ex) * EDGE_SPEED * dt;
    else if (x > w - ex) this.mouse.dx += ((x - (w - ex)) / ex) * EDGE_SPEED * dt;
    if (y < ey) this.mouse.dy -= ((ey - y) / ey) * EDGE_SPEED * 0.6 * dt;
    else if (y > h - ey) this.mouse.dy += ((y - (h - ey)) / ey) * EDGE_SPEED * 0.6 * dt;
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.lookRad.yaw = 0;
    this.lookRad.pitch = 0;
    this.lookActive = false;
  }
}
