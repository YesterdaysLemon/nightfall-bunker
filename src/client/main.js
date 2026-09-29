// Menu, lobby and session flow.

import { Game } from './game.js';
import { LocalConnection, WsConnection, lobbyApi, sessionToken } from './net.js';
import { PROTOCOL, REGIONS, MAX_PLAYERS, PLAYER_COLORS } from '../shared/protocol.js';
import * as THREE from 'three';
import { WEAPONS, reloadStyle } from '../shared/weapons.js';
import { enemyFor } from '../shared/enemies.js';
import { MAPS, mapById } from '../shared/map.js';
import { escapeHtml } from './hud.js';
import { TouchControls } from './touch.js';
import { loadModels } from './render/models.js';
import { ZOMBIE_MODELS } from './render/zombie-models.js';
import MODEL_VERSIONS from 'virtual:model-versions';
import { loadSettings, saveSettings } from './settings.js';
import { SettingsSheet, applyPage } from './settings-ui.js';
import { TEXT } from './text.js';

const $ = (id) => document.getElementById(id);
const screens = ['screenMain', 'screenLobby', 'screenOver'];

const params = new URLSearchParams(location.search);
const settings = loadSettings();
applyPage(settings);
// ?mute keeps a tab silent (used by automated checks); M toggles in game.
if (params.has('mute')) settings.muted = true;
if (!settings.name) settings.name = `Survivor${Math.floor(100 + Math.random() * 900)}`;
const token = sessionToken();

// Painted low-poly characters from the art pipeline (missing ones fall back to
// procedural art). The menu waits only for the horde. Hounds (round 5 on), the
// Kintsugi set (the easter egg) and other players' avatar load alongside and are
// swapped in when they arrive (Game.useModels).
// The menu waits for the common horde; hounds, the Kintsugi set, the survivor avatar
// and a map's own locals (ZOMBIE_MODELS `later`) arrive behind it.
const lateHorde = Object.keys(ZOMBIE_MODELS).filter((id) => ZOMBIE_MODELS[id].later);
const later = loadModels(['hound', 'kintsugi', 'survivor', ...lateHorde], '/models/', MODEL_VERSIONS);
const models = await loadModels(Object.keys(ZOMBIE_MODELS).filter((id) => !ZOMBIE_MODELS[id].later), '/models/', MODEL_VERSIONS);

let game;
try {
  game = new Game($('view'), settings, models);
} catch (err) {
  console.error(err);
  $('loadingText').textContent = 'WebGL is not available in this browser.';
  throw err;
}
performance.mark('nb-game-built');
await game.ready;   // shaders compiled: the first frame won't stall
performance.mark('nb-menu');
$('loading').classList.add('done');
// The late models swap in after the menu is up, so their shaders don't hold it back.
later.then((m) => setTimeout(() => game.useModels(m), 0));
const devBuild = import.meta.env.DEV || params.has('test');
if (devBuild) window.__game = game;
if (devBuild) window.__weapons = { WEAPONS, reloadStyle };
if (devBuild) window.__dev = { THREE, enemyFor };   // smoke scripts draw debug shapes with these
// Automated runs must never request pointer lock: headless Chromium on Windows
// implements it by clipping the real system cursor to its invisible window.
if (params.has('test')) game.input.fallback = true;

// --- Touch ----------------------------------------------------------------------------
const touch = new TouchControls(game.input, { settings, onPause: () => game.input.setLocked(false) });
game.touch = touch;
touch.onEditDone = () => {
  if (game.mode === 'play') $('pause').hidden = false;
  else $('menu').hidden = false;
};
function enableTouch() {
  if (game.input.touchMode) return;
  game.input.touchMode = true;
  document.body.classList.add('touch');
  $('deviceNote').hidden = false;
}
const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
if (coarse || params.has('touch')) {
  enableTouch();
  // Phones: start on the light graphics preset unless the player chose one.
  if (!localStorage.getItem('nb_settings')?.includes('"quality"')) { settings.quality = 'low'; game.applySettings(settings); }
}
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouch(); }, { capture: true, passive: true });

// --- Settings ---------------------------------------------------------------------------
// The map: solo plays it, and a lobby you create starts on it. The menu shows it behind.
function mapButtons(el, current, onPick, enabled = true) {
  el.replaceChildren(...Object.values(MAPS).map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m.id === current));
    b.disabled = !enabled;
    b.innerHTML = `<b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.blurb || '')}</small>`;
    b.onclick = () => onPick(m.id);
    return b;
  }));
}
function pickMap(id) {
  settings.map = mapById(id).id;
  saveSettings(settings);
  mapButtons($('mapPick'), settings.map, pickMap);
  if (game.mode === 'menu') game.setMap(settings.map);
}
mapButtons($('mapPick'), mapById(settings.map).id, pickMap);

const nameInput = $('nameInput');
nameInput.value = settings.name;
settings.gyro = false; // the motion permission is asked for again each visit
const syncSettings = () => {
  settings.name = nameInput.value.trim().slice(0, 16) || settings.name;
  saveSettings(settings);
};
nameInput.addEventListener('change', syncSettings);
const sheet = new SettingsSheet($('settings'), settings, () => { game.applySettings(settings); applyPage(settings); }, {
  setGyro: (on) => touch.setGyro(on),
  isTouch: () => game.input.touchMode,
  editTouch: () => {
    $('menu').hidden = true;
    $('pause').hidden = true;
    touch.edit(true);
  },
});
$('btnSettings').addEventListener('click', () => sheet.show('video'));
$('btnControls').addEventListener('click', () => sheet.show(game.input.touchMode ? 'touch' : 'controls'));
// From the pause menu the sheet replaces the pause box, which comes back when it closes.
$('btnPauseSettings').addEventListener('click', () => { $('pause').hidden = true; sheet.show(); });
$('settings').addEventListener('close', () => { if (game.mode === 'play' && !game.input.locked) $('pause').hidden = false; });

function show(screen) {
  $('menu').hidden = !screen;
  for (const s of screens) $(s).hidden = s !== screen;
}

// Installed (Home Screen / app window) vs a browser tab.
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
document.body.classList.toggle('standalone', standalone);

// Runs inside the click that starts play: audio unlock, and on phones fullscreen + landscape.
// iPhone Safari has no page fullscreen; the Home Screen app is fullscreen already.
function unlockAudio() {
  game.audio.unlock();
  if (!game.input.touchMode) return;
  const lock = () => screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  if (standalone) { lock(); return; }
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try {
    const fs = req?.call(el, { navigationUI: 'hide' });
    if (fs?.then) fs.then(lock).catch(() => {});
  } catch { /* not allowed here */ }
}

// Install: Chrome/Edge/Android offer a real prompt; iOS needs Share -> Add to Home Screen.
const ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
function showInstall(text, canPrompt) {
  try { if (localStorage.getItem('nb_install_dismissed')) return; } catch { /* ignore */ }
  $('installText').textContent = text;
  $('btnInstall').hidden = !canPrompt;
  $('install').hidden = false;
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstall('Install Nightfall Bunker as an app: it opens fullscreen, straight into the game.', true);
});
if (ios && !standalone) {
  showInstall('For fullscreen on iPhone and iPad: tap Share, then \u201cAdd to Home Screen\u201d, and open Nightfall from your Home Screen.', false);
}
$('btnInstall').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $('install').hidden = true;
});
$('btnInstallDismiss').addEventListener('click', () => {
  $('install').hidden = true;
  try { localStorage.setItem('nb_install_dismissed', '1'); } catch { /* ignore */ }
});
addEventListener('appinstalled', () => { $('install').hidden = true; });

// --- Game events ------------------------------------------------------------------------
let session = null; // { kind: 'solo' | 'mp', party?: WsConnection, code?, match? }

game.onEvent = (e) => {
  if (e.type === 'started') {
    show(null);
    $('pause').hidden = true;
    document.body.classList.add('playing');
    game.input.lock();
    touch.show(game.input.touchMode);
  } else if (e.type === 'error') {
    leaveGame();
    show(session?.party ? 'screenLobby' : 'screenMain');
    ($(session?.party ? 'lobbyError' : 'mainError')).textContent = e.message;
  } else if (e.type === 'over') {
    showOver(e.over);
  } else if (e.type === 'ended') {
    if (!$('screenOver').hidden) return;
    if (e.over) showOver(e.over);
  } else if (e.type === 'disconnected') {
    leaveGame();
    show('screenMain');
    $('mainError').textContent = 'Lost connection to the match.';
  }
};

game.input.onFallback = () => {
  game.hud.center('Mouse capture is blocked here', 'Free-look on: move the mouse to aim, rest it near an edge to keep turning. Open the game in its own tab for full controls.', 7000);
};
game.input.onNeedClick = () => {
  if (game.mode !== 'play') return;
  $('pause').hidden = false;
  $('pauseSub').textContent = 'Click to play.';
};
addEventListener('keydown', (e) => {
  if (game.input.canon(e.code) !== 'KeyM' || game.input.typing || sheet.open || document.activeElement?.tagName === 'INPUT') return;
  game.setMuted(!game.muted);
  settings.muted = game.muted;
  if (!params.has('mute')) saveSettings(settings);
  if (game.mode === 'play') game.hud.center(...TEXT.soundToggle(!game.muted, game.keyName('mute')), 1200);
});

game.input.onLockChange = (locked) => {
  if (game.mode !== 'play') return;
  $('pause').hidden = locked;
  touch.show(locked && game.input.touchMode);
  const verb = game.input.touchMode ? 'Tap Resume' : 'Click';
  $('pauseSub').textContent = session?.kind === 'solo' ? `The game is paused. ${verb} to continue.` : 'The match keeps running while you are away.';
  game.pause(!locked && session?.kind === 'solo');
};

$('btnResume').onclick = () => game.input.lock();
$('view').addEventListener('click', () => { if (game.mode === 'play' && !game.input.locked && $('pause').hidden === false) game.input.lock(); });
$('btnQuit').onclick = () => { leaveGame(); backToMenu(); };

function leaveGame() {
  touch.show(false);
  document.body.classList.remove('playing');
  game.stop();
  $('pause').hidden = true;
  game.hud.show(false);
}

function backToMenu() {
  if (session?.party) { session.party.close(); }
  session = null;
  show('screenMain');
}

// --- Solo ------------------------------------------------------------------------------------
$('btnSolo').onclick = () => {
  syncSettings();
  unlockAudio();
  $('mainError').textContent = '';
  session = { kind: 'solo' };
  const map = mapById(settings.map).id;
  game.start(new LocalConnection(map), { name: settings.name, token, local: true, map });
  const give = params.get('give');
  if (devBuild && WEAPONS[give]) devGive(give);
};

// Dev builds and ?test: ?give=<gun id> (e.g. leyden) puts that gun in your hands
// when a solo game starts.
function devGive(id, tries = 25) {
  const sim = game.conn?.room?.sim, p = sim?.players.get(game.me);
  if (!p) { if (tries > 0) setTimeout(() => devGive(id, tries - 1), 200); return; }
  sim.giveWeapon(p, id);
  sim.emit(['give', p.id, id, p.weapons.join(',')]);
}

// --- Multiplayer ----------------------------------------------------------------------------
let regions = null;
let pings = {};

async function ensurePings() {
  if (regions) return pings;
  const info = await lobbyApi.regions();
  regions = info;
  renderProbes();
  pings = await lobbyApi.probe(info.regions, (partial) => { pings = partial; renderProbes(); session?.party?.send({ t: 'pings', pings }); });
  renderProbes();
  return pings;
}

function renderProbes(best) {
  if (!regions) return;
  const rows = regions.regions.map((r) => {
    const v = pings[r];
    return `<tr class="${r === best ? 'best' : ''}"><td>${escapeHtml(regions.names[r] || r)}</td><td>${Number.isFinite(v) ? `${v} ms` : '…'}</td></tr>`;
  }).join('');
  $('probeTable').innerHTML = rows;
}

function busy(on) {
  for (const id of ['btnSolo', 'btnQuick', 'btnCreate', 'btnJoin']) $(id).disabled = on;
}

async function openParty(code) {
  syncSettings();
  unlockAudio();
  $('lobbyError').textContent = '';
  $('mainError').textContent = '';
  const party = new WsConnection(`/net/party/${code}`);
  session = { kind: 'mp', party, code };
  $('lobbyCode').textContent = code;
  $('members').innerHTML = '';
  $('regionInfo').textContent = 'Measuring distance to servers…';
  show('screenLobby');
  party.onmessage = onPartyMessage;
  party.onclose = () => {
    if (session?.party !== party) return;
    if (game.mode === 'menu' && !$('screenLobby').hidden) {
      $('lobbyError').textContent = 'Lobby connection closed.';
    }
  };
  party.send({ t: 'hello', v: PROTOCOL, token, name: settings.name, pings, back: session.backFrom, map: mapById(settings.map).id });
  history.replaceState(null, '', `#${code}`);
  ensurePings().then((p) => party.send({ t: 'pings', pings: p })).catch(() => {
    $('regionInfo').textContent = 'Could not measure server distance; using defaults.';
  });
}

function onPartyMessage(m) {
  if (m.t === 'lobby') {
    const list = $('members');
    const items = m.members.map((mem, i) => `<li><span style="color:${PLAYER_COLORS[i % 4]}">${escapeHtml(mem.name)}${mem.host ? '<span class="host">host</span>' : ''}</span><span class="ping">${mem.ping != null ? `${mem.ping} ms` : '…'}</span></li>`);
    for (let i = m.members.length; i < MAX_PLAYERS; i++) items.push('<li class="empty"><span>Waiting for survivor…</span><span></span></li>');
    list.innerHTML = items.join('');
    const regionName = REGIONS[m.region] || m.region;
    $('regionInfo').innerHTML = m.region ? `Server: <b>${escapeHtml(regionName)}</b>${m.worst < 400 ? ` · worst ping ${m.worst} ms` : ''}` : '';
    renderProbes(m.region);
    const me = m.members.find((x) => x.id === token.slice(0, 6));
    $('btnStart').disabled = !(me && me.host) || m.state !== 'waiting';
    // The host picks the map; everyone sees it.
    mapButtons($('lobbyMap'), mapById(m.map).id, (id) => session?.party?.send({ t: 'map', id }), !!(me && me.host) && m.state === 'waiting');
    $('btnStart').textContent = m.state === 'ingame' ? 'Match in progress' : me?.host ? 'Start match' : 'Waiting for host';
    session.lobby = m;
  } else if (m.t === 'go') {
    session.match = m.match;
    game.start(new WsConnection(`/net/match/${m.match}`), { name: settings.name, token, local: false });
  } else if (m.t === 'reject') {
    $('lobbyError').textContent = m.message;
    $('mainError').textContent = m.message;
    show('screenMain');
    session = null;
  } else if (m.t === 'error') {
    $('lobbyError').textContent = m.message;
  } else if (m.t === 'chat') {
    game.hud.chat(m.from, m.m, '#ece6d6');
  }
}

$('btnCreate').onclick = async () => {
  busy(true);
  try {
    const { code } = await lobbyApi.createParty(false);
    await openParty(code);
  } catch {
    $('mainError').textContent = 'Could not reach the lobby server. Solo still works.';
  } finally { busy(false); }
};

$('btnQuick').onclick = async () => {
  busy(true);
  $('mainError').textContent = 'Finding the nearest lobby…';
  try {
    const p = await ensurePings().catch(() => ({}));
    const { code } = await lobbyApi.quick(p);
    $('mainError').textContent = '';
    await openParty(code);
  } catch {
    $('mainError').textContent = 'Could not reach the lobby server. Solo still works.';
  } finally { busy(false); }
};

const codeInput = $('codeInput');
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnJoin').onclick = () => {
  const code = codeInput.value;
  if (!/^[A-Z]{4}$/.test(code)) { $('mainError').textContent = 'Lobby codes are four letters.'; return; }
  openParty(code);
};

$('btnStart').onclick = () => session?.party?.send({ t: 'start' });
$('btnLeave').onclick = () => { history.replaceState(null, '', location.pathname); backToMenu(); };
$('btnCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}#${session?.code || ''}`;
  try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = 'Copied'; } catch { $('btnCopy').textContent = url; }
  setTimeout(() => { $('btnCopy').textContent = 'Copy invite'; }, 1600);
};

// --- Game over ------------------------------------------------------------------------------------
function showOver(over) {
  game.input.unlock();
  const { round, stats } = over;
  $('overTitle').textContent = 'Game over';
  $('overSub').textContent = `The night took you in round ${round}.`;
  const head = '<tr><th>Player</th><th>Points</th><th>Kills</th><th>Heads</th><th>Downs</th><th>Revives</th></tr>';
  $('overTable').innerHTML = head + stats.map(([, name, slot, points, kills, heads, downs, revives]) =>
    `<tr><td style="color:${PLAYER_COLORS[slot % 4]}">${escapeHtml(name)}</td><td>${points}</td><td>${kills}</td><td>${heads}</td><td>${downs}</td><td>${revives}</td></tr>`).join('');
  $('btnAgain').textContent = session?.kind === 'mp' ? 'Back to lobby' : 'Play again';
  show('screenOver');
}

$('btnAgain').onclick = () => {
  const s = session;
  leaveGame();
  if (s?.kind === 'mp' && s.code) {
    s.party?.close();
    session = { kind: 'mp', code: s.code, backFrom: s.match };
    openParty(s.code);
  } else {
    $('btnSolo').click();
  }
};
$('btnMenu').onclick = () => { leaveGame(); backToMenu(); };

// --- Deep links: #CODE joins a lobby --------------------------------------------------------------
const hash = location.hash.replace('#', '').toUpperCase();
if (/^[A-Z]{4}$/.test(hash)) {
  codeInput.value = hash;
  show('screenMain');
  $('mainError').textContent = `Invited to lobby ${hash}. Press Join.`;
} else {
  show('screenMain');
}

// Chat (multiplayer).
const chatInput = $('chatInput');
addEventListener('keydown', (e) => {
  if (game.mode !== 'play' || session?.kind !== 'mp' || sheet.open) return;
  if (game.input.canon(e.code) === 'Enter' && chatInput.hidden && !game.input.typing) {
    e.preventDefault();
    chatInput.hidden = false;
    game.input.typing = true;
    chatInput.focus();
  } else if (e.key === 'Enter' && !chatInput.hidden) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) game.conn?.send({ t: 'chat', m: text });
    chatInput.value = '';
    chatInput.hidden = true;
    game.input.typing = false;
    game.input.lock();
  } else if (e.key === 'Escape' && !chatInput.hidden) {
    chatInput.hidden = true;
    game.input.typing = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.kind === 'solo' && game.mode === 'play') game.pause(true);
});
