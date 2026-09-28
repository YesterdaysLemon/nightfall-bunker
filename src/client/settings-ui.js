// The settings sheet: a modal <dialog> docked to the side so the game stays
// visible behind it (changes apply live). Built from the TABS table below; a new
// option is one entry here plus wherever the game reads it.

import { ACTIONS, CROSS_COLORS, DEFAULTS, bindingsOf, keyLabel, saveSettings } from './settings.js';

const pct = (v) => `${Math.round(v * 100)}%`;

const TABS = [
  { id: 'video', label: 'Video', items: [
    { key: 'crt', type: 'range', label: 'TV effect strength', min: 0, max: 100, step: 5, fmt: (v) => (v > 0 ? `${v}%` : 'Off'),
      help: 'The 1997 picture: scanlines, a soft image and colour bleed. Lower is sharper.' },
    { key: 'brightness', type: 'range', label: 'Brightness', min: 0.7, max: 1.5, step: 0.05, fmt: pct },
    { key: 'fov', type: 'range', label: 'Field of view', min: 65, max: 100, step: 1, fmt: (v) => `${v}°` },
    { key: 'quality', type: 'segment', label: 'Graphics', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
      help: 'Lower runs faster. With the TV effect on, it also sets how chunky the picture is.' },
  ] },
  { id: 'audio', label: 'Audio', items: [
    { key: 'volume', type: 'range', label: 'Master volume', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'music', type: 'range', label: 'Music', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'hrtf', type: 'check', label: '3D audio', help: 'Hear which way sounds come from. Best with headphones.' },
    { key: 'captions', type: 'check', label: 'Sound captions', help: 'Show what you hear, with an arrow pointing toward it.' },
  ] },
  { id: 'controls', label: 'Controls', items: [
    { key: 'sensitivity', type: 'range', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'invert', type: 'check', label: 'Invert mouse Y' },
    { key: 'toggleAim', type: 'check', label: 'Toggle aim', help: 'Click right mouse once to aim, again to stop.' },
    { key: 'toggleSprint', type: 'check', label: 'Toggle sprint', help: 'Tap sprint once; it stops when you stop moving forward.' },
    { key: 'toggleCrouch', type: 'check', label: 'Toggle crouch' },
    { type: 'binds' },
  ] },
  { id: 'access', label: 'Accessibility', items: [
    { key: 'uiScale', type: 'range', label: 'Text and HUD size', min: 0.8, max: 1.6, step: 0.05, fmt: pct },
    { key: 'contrast', type: 'check', label: 'High-contrast HUD', help: 'Dark plates behind HUD text and an outlined crosshair.' },
    { key: 'crosshair', type: 'segment', label: 'Crosshair size', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
    { key: 'crossColor', type: 'swatches', label: 'Crosshair colour', options: CROSS_COLORS },
    { key: 'crossDot', type: 'check', label: 'Centre dot' },
    { key: 'reduceFlashing', type: 'check', label: 'Reduce flashing', help: 'Softens lightning, explosions, white-outs and flickering lights.' },
    { key: 'reduceMotion', type: 'check', label: 'Reduce motion', help: 'No camera shake or head bob, much less weapon sway, fewer HUD animations.' },
    { key: 'captions', type: 'check', label: 'Sound captions', help: 'Show what you hear, with an arrow pointing toward it.' },
  ] },
  { id: 'touch', label: 'Touch', touch: true, items: [
    { key: 'touchSens', type: 'range', label: 'Look speed', min: 0.3, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'touchAutoFire', type: 'check', label: 'Auto-fire when aiming at an enemy' },
    { key: 'touchAssist', type: 'check', label: 'Aim assist' },
    { key: 'gyro', type: 'check', label: 'Gyro aiming', help: 'Tilt the phone to aim.' },
    { type: 'button', id: 'editTouch', label: 'Customize touch buttons' },
  ] },
];

// Page-wide effects of settings (the game applies its own in Game.applySettings).
export function applyPage(s) {
  document.documentElement.style.setProperty('--ui', String(s.uiScale || 1));
  document.body.classList.toggle('contrast', !!s.contrast);
  document.body.classList.toggle('calm', !!s.reduceMotion);
  document.body.classList.toggle('noflash', !!s.reduceFlashing);
}

let uid = 0;
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'value') n[k] = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.filter((c) => c != null));
  return n;
};

export class SettingsSheet {
  // settings: the live settings object; apply(): push it to the game and page;
  // hooks: { setGyro(on) -> Promise<bool>, editTouch(), isTouch() }.
  constructor(dialog, settings, apply, hooks) {
    this.dialog = dialog;
    this.s = settings;
    this.apply = apply;
    this.hooks = hooks;
    this.tab = 'video';
    this.capture = null;
    this.opener = null;
    dialog.addEventListener('close', () => { this.stopCapture(); this.opener?.focus?.(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // click on the backdrop
    dialog.querySelector('#setClose').addEventListener('click', () => dialog.close());
    dialog.querySelector('#setReset').addEventListener('click', () => this.resetTab());
  }

  get open() { return this.dialog.open; }

  show(tab) {
    if (tab) this.tab = tab;
    this.opener = document.activeElement;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector(`[role="tab"][aria-selected="true"]`)?.focus();
  }

  changed(key, value) {
    this.s[key] = value;
    saveSettings(this.s);
    this.apply();
  }

  tabs() { return TABS.filter((t) => !t.touch || this.hooks.isTouch()); }

  render() {
    const tabs = this.tabs();
    if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0].id;
    const list = this.dialog.querySelector('#setTabs');
    list.replaceChildren(...tabs.map((t) => el('button', {
      type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === this.tab), 'aria-controls': 'setPanel',
      tabindex: t.id === this.tab ? '0' : '-1', text: t.label,
      onclick: () => { this.tab = t.id; this.render(); this.dialog.querySelector(`#tab-${t.id}`).focus(); },
      onkeydown: (e) => {
        const i = tabs.findIndex((x) => x.id === this.tab);
        const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (j == null) return;
        e.preventDefault();
        this.tab = tabs[(j + tabs.length) % tabs.length].id;
        this.render();
        this.dialog.querySelector(`#tab-${this.tab}`).focus();
      },
    })));
    const tab = tabs.find((t) => t.id === this.tab);
    const panel = this.dialog.querySelector('#setPanel');
    panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
    panel.replaceChildren(...tab.items.map((it) => this.item(it)));
  }

  item(it) {
    const id = `set-${it.key || it.id || it.type}-${++uid}`;
    const help = it.help ? el('p', { class: 'help', id: `${id}-help`, text: it.help }) : null;
    const described = it.help ? `${id}-help` : null;
    const v = this.s[it.key];
    switch (it.type) {
      case 'range': {
        const out = el('output', { for: id, text: it.fmt(v) });
        const input = el('input', { type: 'range', id, min: it.min, max: it.max, step: it.step, value: v, 'aria-describedby': described,
          oninput: (e) => { const x = Number(e.target.value); out.textContent = it.fmt(x); this.changed(it.key, x); } });
        return el('div', { class: 'setRow' }, el('label', { for: id }, el('span', { text: it.label }), out), input, help);
      }
      case 'check': {
        const input = el('input', { type: 'checkbox', id, checked: !!v, 'aria-describedby': described,
          onchange: async (e) => {
            if (it.key === 'gyro') {
              const ok = await this.hooks.setGyro(e.target.checked);
              if (e.target.checked && !ok) { e.target.checked = false; this.note(e.target, 'Gyro aiming is not available on this device.'); }
              this.changed('gyro', e.target.checked);
              return;
            }
            this.changed(it.key, e.target.checked);
          } });
        return el('div', { class: 'setRow check' }, input, el('label', { for: id, text: it.label }), help);
      }
      case 'segment': {
        const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `${id}-l`, 'aria-describedby': described });
        const draw = () => group.replaceChildren(...it.options.map(([val, label]) => el('button', {
          type: 'button', role: 'radio', 'aria-checked': String(this.s[it.key] === val), text: label,
          onclick: () => { this.changed(it.key, val); draw(); },
        })));
        draw();
        return el('div', { class: 'setRow' }, el('span', { class: 'lbl', id: `${id}-l`, text: it.label }), group, help);
      }
      case 'swatches': {
        const group = el('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': `${id}-l` });
        const draw = () => group.replaceChildren(...it.options.map(([val, label]) => el('button', {
          type: 'button', role: 'radio', 'aria-checked': String(this.s[it.key] === val), 'aria-label': label, title: label,
          style: `--sw:${val}`, onclick: () => { this.changed(it.key, val); draw(); },
        })));
        draw();
        return el('div', { class: 'setRow' }, el('span', { class: 'lbl', id: `${id}-l`, text: it.label }), group);
      }
      case 'button':
        return el('div', { class: 'setRow' }, el('button', { type: 'button', class: 'small', text: it.label, onclick: () => { this.dialog.close(); this.hooks.editTouch(); } }));
      case 'binds':
        return this.binds();
      default:
        return el('div');
    }
  }

  note(near, text) {
    const p = el('p', { class: 'help warn', role: 'status', text });
    near.closest('.setRow').append(p);
    setTimeout(() => p.remove(), 4000);
  }

  // Key bindings: click a key, press the new one (Esc cancels). A key already in
  // use swaps places with the action that had it.
  binds() {
    const wrap = el('div', { class: 'setRow binds' });
    const table = el('table', { class: 'bindTable' });
    const b = bindingsOf(this.s);
    const rows = ACTIONS.map((a) => el('tr', {},
      el('th', { scope: 'row', text: a.label }),
      el('td', {}, el('button', {
        type: 'button', class: 'key', 'data-action': a.id, 'aria-label': `${a.label}: ${b[a.id].map(keyLabel).join(' or ')}. Press to change.`,
        text: b[a.id].map(keyLabel).join(' / '), onclick: (e) => this.startCapture(a.id, e.currentTarget),
      }))));
    const fixed = [['Fire', 'Left mouse'], ['Aim', 'Right mouse'], ['Switch weapon', 'Mouse wheel'], ['Pause', 'Esc']]
      .map(([l, k]) => el('tr', { class: 'fixed' }, el('th', { scope: 'row', text: l }), el('td', {}, el('span', { class: 'key', text: k }))));
    table.append(el('tbody', {}, ...rows, ...fixed));
    this.status = el('p', { class: 'help', role: 'status', 'aria-live': 'polite' });
    wrap.append(el('div', { class: 'bindHead' }, el('span', { class: 'lbl', text: 'Keys' }),
      el('button', { type: 'button', class: 'small', text: 'Reset keys', onclick: () => { this.changed('binds', {}); this.render(); } })), table, this.status);
    return wrap;
  }

  startCapture(action, btn) {
    this.stopCapture();
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    this.status.textContent = 'Press the new key, or Esc to cancel.';
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { this.stopCapture(); this.render(); return; }
      const b = bindingsOf(this.s);
      const old = b[action];
      const taken = Object.keys(b).find((k) => k !== action && b[k].includes(e.code));
      const binds = { ...this.s.binds, [action]: [e.code] };
      if (taken) binds[taken] = old;
      this.stopCapture();
      this.changed('binds', binds);
      this.render();
      const label = ACTIONS.find((a) => a.id === action).label;
      this.status = this.dialog.querySelector('.binds .help');
      this.status.textContent = taken
        ? `${label} is now ${keyLabel(e.code)}; ${ACTIONS.find((a) => a.id === taken).label} moved to ${old.map(keyLabel).join(' / ')}.`
        : `${label} is now ${keyLabel(e.code)}.`;
      this.dialog.querySelector(`.key[data-action="${action}"]`)?.focus();
    };
    addEventListener('keydown', onKey, true);
    this.capture = onKey;
  }

  stopCapture() {
    if (this.capture) removeEventListener('keydown', this.capture, true);
    this.capture = null;
  }

  resetTab() {
    const tab = this.tabs().find((t) => t.id === this.tab);
    for (const it of tab.items) {
      if (it.key && it.key !== 'gyro') this.s[it.key] = DEFAULTS[it.key];
      if (it.type === 'binds') this.s.binds = {};
    }
    saveSettings(this.s);
    this.apply();
    this.render();
  }
}
