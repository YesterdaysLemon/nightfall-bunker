// DOM heads-up display.

import { drawTally } from './render/chalk.js';
import { PLAYER_COLORS } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.tally = $('tally');
    this.tctx = this.tally.getContext('2d');
    this.scores = $('scores');
    this.rows = new Map();
    this.mag = $('mag');
    this.reserve = $('reserve');
    this.ammoCount = $('ammoCount');
    this.weaponName = $('weaponName');
    this.nades = $('nades');
    this.promptEl = $('prompt');
    this.cross = $('crosshair');
    this.pus = $('powerups');
    this.hurtEl = $('hurt');
    this.hurtDir = $('hurtDir');
    this.downedEl = $('downed');
    this.reviveEl = $('reviveBar');
    this.centerEl = $('center');
    this.net = $('netinfo');
    this.chatlog = $('chatlog');
    this.board = $('scoreboard');
    this.round = -1;
    this.last = {};
    this.centerT = null;
  }

  show(on) { this.el.hidden = !on; }

  setRound(n, flash = true) {
    if (n === this.round) return;
    this.round = n;
    const c = this.tctx;
    c.clearRect(0, 0, this.tally.width, this.tally.height);
    if (n > 0) drawTally(c, n, 8, 8, this.tally.height - 16);
    if (flash) {
      this.tally.classList.add('flash');
      setTimeout(() => this.tally.classList.remove('flash'), 2200);
    }
  }

  setPlayer(id, name, slot, points, me) {
    let r = this.rows.get(id);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'score';
      el.style.color = PLAYER_COLORS[slot % 4];
      if (me) el.style.fontSize = '1.8rem';
      const v = document.createElement('span');
      el.append(v);
      this.scores.append(el);
      r = { el, v, points: -1, name };
      this.rows.set(id, r);
    }
    if (r.points !== points) { r.v.textContent = points; r.points = points; }
  }

  removePlayer(id) {
    const r = this.rows.get(id);
    if (r) { r.el.remove(); this.rows.delete(id); }
  }

  popPoints(id, delta) {
    const r = this.rows.get(id);
    if (!r || !delta) return;
    const p = document.createElement('span');
    p.className = delta < 0 ? 'pop neg' : 'pop';
    p.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    p.style.top = `${(Math.random() - 0.5) * 16}px`;
    r.el.append(p);
    setTimeout(() => p.remove(), 950);
  }

  setAmmo(name, mag, reserve, magSize) {
    const L = this.last;
    if (L.name !== name) { this.weaponName.textContent = name; L.name = name; }
    if (L.mag !== mag) { this.mag.textContent = mag; L.mag = mag; }
    if (L.reserve !== reserve) { this.reserve.textContent = reserve; L.reserve = reserve; }
    const low = mag <= Math.max(1, Math.floor(magSize * 0.25));
    if (L.low !== low) { this.ammoCount.classList.toggle('low', low); L.low = low; }
  }

  setGrenades(n) {
    if (this.last.nades === n) return;
    this.last.nades = n;
    this.nades.replaceChildren(...Array.from({ length: n }, () => document.createElement('i')));
  }

  prompt(html) {
    if (this.last.prompt === html) return;
    this.last.prompt = html;
    this.promptEl.innerHTML = html;
  }

  crosshair(spreadPx, visible) {
    const s = Math.round(spreadPx);
    if (this.last.cs !== s) {
      const [a, b, c, d] = this.cross.children;
      a.style.left = `${-9 - s}px`; b.style.left = `${s}px`;
      c.style.top = `${-9 - s}px`; d.style.top = `${s}px`;
      this.last.cs = s;
    }
    if (this.last.cv !== visible) { this.cross.classList.toggle('hide', !visible); this.last.cv = visible; }
  }

  powerups(insta, dbl) {
    const key = `${insta}|${dbl}`;
    if (this.last.pu === key) return;
    this.last.pu = key;
    const items = [];
    if (insta > 0) items.push(['Insta-Kill', insta]);
    if (dbl > 0) items.push(['Double Points', dbl]);
    this.pus.replaceChildren(...items.map(([label, t]) => {
      const d = document.createElement('div');
      d.className = t <= 5 ? 'pu blink' : 'pu';
      d.innerHTML = `${label}<div class="t">${t}s</div>`;
      return d;
    }));
  }

  hurt(level) {
    const v = Math.max(0, Math.min(1, level)).toFixed(2);
    if (this.last.hurt !== v) { this.hurtEl.style.opacity = v; this.last.hurt = v; }
  }

  hurtFrom(angle) {
    this.hurtDir.style.transform = `rotate(${angle}rad)`;
    this.hurtDir.style.transition = 'none';
    this.hurtDir.style.opacity = '1';
    requestAnimationFrame(() => {
      this.hurtDir.style.transition = 'opacity 0.9s';
      this.hurtDir.style.opacity = '0';
    });
  }

  downed(show, frac = 0) {
    this.downedEl.hidden = !show;
    if (show) this.downedEl.querySelector('.bar i').style.width = `${Math.round(frac * 100)}%`;
  }

  revive(label, frac) {
    if (label == null) { this.reviveEl.hidden = true; return; }
    this.reviveEl.hidden = false;
    this.reviveEl.querySelector('.label').textContent = label;
    this.reviveEl.querySelector('.bar i').style.width = `${Math.round(frac * 100)}%`;
  }

  center(text, sub = '', ms = 2500, tone = '') {
    this.centerEl.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    this.centerEl.classList.toggle('dread', tone === 'dread');
    this.centerEl.classList.toggle('gold', tone === 'gold');
    this.centerEl.classList.add('show');
    clearTimeout(this.centerT);
    this.centerT = setTimeout(() => this.centerEl.classList.remove('show'), ms);
  }

  // Boss health: frac 0..1, or null to hide. Built on first use.
  boss(frac, name = 'Kintsugi') {
    if (frac == null) {
      if (this.bossEl) this.bossEl.hidden = true;
      this.last.boss = null;
      return;
    }
    if (!this.bossEl) {
      const el = document.createElement('div');
      el.id = 'bossBar';
      el.innerHTML = '<div class="name"></div><div class="bar"><i></i></div>';
      this.el.append(el);
      this.bossEl = el;
    }
    this.bossEl.hidden = false;
    const key = `${name}|${Math.round(frac * 200)}`;
    if (this.last.boss === key) return;
    this.last.boss = key;
    this.bossEl.querySelector('.name').textContent = name;
    this.bossEl.querySelector('.bar i').style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  }

  netinfo(text) {
    if (this.last.net !== text) { this.net.textContent = text; this.last.net = text; }
  }

  chat(from, text, color) {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `${from}: `;
    b.style.color = color;
    d.append(b, document.createTextNode(text));
    this.chatlog.append(d);
    while (this.chatlog.children.length > 6) this.chatlog.firstChild.remove();
    setTimeout(() => d.remove(), 9000);
  }

  scoreboard(show, rows, round) {
    this.board.hidden = !show;
    if (!show) return;
    const head = '<tr><th>Player</th><th>Points</th><th>Kills</th><th>Headshots</th><th>Downs</th><th>Revives</th></tr>';
    this.board.innerHTML = `<h3>Round ${round}</h3><table class="sbTable">${head}${rows.map((r) =>
      `<tr><td style="color:${PLAYER_COLORS[r.slot % 4]}">${escapeHtml(r.name)}</td><td>${r.points}</td><td>${r.kills ?? '–'}</td><td>${r.headshots ?? '–'}</td><td>${r.downs ?? '–'}</td><td>${r.revives ?? '–'}</td></tr>`).join('')}</table>`;
  }

  reset() {
    for (const id of [...this.rows.keys()]) this.removePlayer(id);
    this.round = -1;
    this.last = {};
    this.tctx.clearRect(0, 0, this.tally.width, this.tally.height);
    this.prompt('');
    this.downed(false);
    this.revive(null);
    this.hurt(0);
    this.boss(null);
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
