// Player settings: defaults, storage, and the key bindings table.
// Stored in localStorage as `nb_settings`; unknown or missing fields fall back to defaults.

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rebindable keyboard actions. `keys` are the codes the game checks (its canonical
// keys); the player's bindings map physical keys onto them (see Input.setBindings).
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', keys: ['KeyW'] },
  { id: 'back', label: 'Move back', keys: ['KeyS'] },
  { id: 'left', label: 'Move left', keys: ['KeyA'] },
  { id: 'right', label: 'Move right', keys: ['KeyD'] },
  { id: 'sprint', label: 'Sprint', keys: ['ShiftLeft'] },
  { id: 'crouch', label: 'Crouch', keys: ['KeyC', 'ControlLeft'] },
  { id: 'jump', label: 'Jump', keys: ['Space'] },
  { id: 'use', label: 'Buy · rebuild · revive', keys: ['KeyF'] },
  { id: 'reload', label: 'Reload', keys: ['KeyR'] },
  { id: 'knife', label: 'Knife', keys: ['KeyV', 'KeyE'] },
  { id: 'grenade', label: 'Grenade', keys: ['KeyG'] },
  { id: 'weapon1', label: 'First weapon', keys: ['Digit1'] },
  { id: 'weapon2', label: 'Second weapon', keys: ['Digit2'] },
  { id: 'scores', label: 'Scores (hold)', keys: ['Tab'] },
  { id: 'chat', label: 'Chat', keys: ['Enter'] },
  { id: 'mute', label: 'Mute sound', keys: ['KeyM'] },
];

export const DEFAULTS = {
  name: '',
  map: 'bunker',
  // Video
  quality: 'medium', fov: 80, crt: 70, brightness: 1,
  // Audio
  volume: 0.8, music: 0.6, hrtf: true,
  // Controls
  sensitivity: 1, invert: false, toggleAim: false, toggleSprint: false, toggleCrouch: false, binds: {},
  // Accessibility
  uiScale: 1, contrast: false, crosshair: 'medium', crossColor: '#f0ece2', crossDot: false,
  reduceFlashing: reducedMotion, reduceMotion: reducedMotion, captions: false,
  // Touch
  touchSens: 1, touchAutoFire: true, touchAssist: true, gyro: false,
};

export const CROSS_COLORS = [['#f0ece2', 'Bone'], ['#ffe14d', 'Yellow'], ['#4de8ff', 'Cyan'], ['#6dff7a', 'Green'], ['#ff5cf0', 'Magenta']];

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('nb_settings') || '{}') || {}; } catch { s = {}; }
  // Before the strength slider, the TV look was on/off.
  if (s.crt == null && s.retro != null) s.crt = s.retro ? DEFAULTS.crt : 0;
  delete s.retro;
  return { ...DEFAULTS, ...s, binds: { ...(s.binds || {}) } };
}

export function saveSettings(s) {
  try { localStorage.setItem('nb_settings', JSON.stringify(s)); } catch { /* private mode */ }
}

// The physical keys bound to each action (the player's choice, or the defaults).
export function bindingsOf(s) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = s.binds?.[a.id]?.length ? s.binds[a.id] : a.keys;
  return out;
}

const NAMES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc', Backspace: 'Backspace',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left ⌘', MetaRight: 'Right ⌘', CapsLock: 'Caps Lock',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
export function keyLabel(code) {
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
