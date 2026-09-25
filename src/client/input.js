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
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, x: -1, y: -1, over: false };
    this.locked = false;
    this.enabled = false;
    this.typing = false;
    this.fallback = false;
    // Touch: analog stick vector, sprint, look in radians (gyro), no pointer lock.
    this.touchMode = false;
    this.move = { x: 0, y: 0 };
    this.touchSprint = false;
    this.lookRad = { yaw: 0, pitch: 0 };
    this.lookActive = false;
    this.onLockChange = null;
    this.onFallback = null;
    this.onNeedClick = null;

    addEventListener('keydown', (e) => {
      if (!this.enabled || this.typing) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.code.startsWith('Arrow'))) e.preventDefault();
      if (e.code === 'Escape' && this.fallback && this.locked) this.setLocked(false);
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => {
      this.keys.clear();
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

  setLocked(on) {
    if (this.locked === on) return;
    this.locked = on;
    document.body.classList.toggle('freelook', on && this.fallback);
    if (!on) {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      this.move.x = this.move.y = 0;
      this.touchSprint = false;
    }
    this.onLockChange?.(on);
  }

  lock() {
    if (this.fallback || this.touchMode) { this.setLocked(true); return; }
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
  }

  // Structural refusals switch to free-look; a missing user gesture just
  // needs another click.
  lockFailed(err) {
    const name = err?.name || '';
    if (name === 'WrongDocumentError' || name === 'NotSupportedError') {
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

  // Free-look edge turning, accumulated as virtual mouse travel.
  beginFrame(dt) {
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
