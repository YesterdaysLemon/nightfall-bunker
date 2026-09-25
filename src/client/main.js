// Menu, lobby and session flow.

import { Game } from './game.js';
import { LocalConnection, WsConnection, lobbyApi, sessionToken } from './net.js';
import { PROTOCOL, REGIONS, MAX_PLAYERS, PLAYER_COLORS } from '../shared/protocol.js';
import { escapeHtml } from './hud.js';
import { TouchControls } from './touch.js';

const $ = (id) => document.getElementById(id);
const screens = ['screenMain', 'screenLobby', 'screenOver'];

const DEFAULTS = {
  name: '', sensitivity: 1, fov: 80, volume: 0.8, quality: 'medium', invert: false, hrtf: true,
  touchSens: 1, touchAutoFire: true, touchAssist: true, gyro: false,
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nb_settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('nb_settings', JSON.stringify(s)); } catch { /* private mode */ }
}

const params = new URLSearchParams(location.search);
const settings = loadSettings();
// ?mute keeps a tab silent (used by automated checks); M toggles in game.
if (params.has('mute')) settings.muted = true;
if (!settings.name) settings.name = `Survivor${Math.floor(100 + Math.random() * 900)}`;
const token = sessionToken();

let game;
try {
  game = new Game($('view'), settings);
} catch (err) {
  console.error(err);
  $('loadingText').textContent = 'WebGL is not available in this browser.';
  throw err;
}
$('loading').classList.add('done');
if (import.meta.env.DEV || params.has('test')) window.__game = game;
// Automated runs must never request pointer lock: headless Chromium on Windows
// implements it by clipping the real system cursor to its invisible window.
if (params.has('test')) game.input.fallback = true;

// --- Touch ----------------------------------------------------------------------------
const touch = new TouchControls(game.input, { settings, onPause: () => game.input.setLocked(false) });
game.touch = touch;
touch.onEditDone = () => { $('menu').hidden = false; };
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

// --- Settings UI ----------------------------------------------------------------------
const nameInput = $('nameInput');
nameInput.value = settings.name;
$('setSens').value = settings.sensitivity;
$('setFov').value = settings.fov;
$('setVol').value = settings.volume;
$('setQuality').value = settings.quality;
$('setInvert').checked = settings.invert;
$('setHrtf').checked = settings.hrtf;
$('setTouchSens').value = settings.touchSens;
$('setAutoFire').checked = settings.touchAutoFire;
$('setAssist').checked = settings.touchAssist;
$('setGyro').checked = false;
const syncSettings = () => {
  settings.name = nameInput.value.trim().slice(0, 16) || settings.name;
  settings.sensitivity = Number($('setSens').value);
  settings.fov = Number($('setFov').value);
  settings.volume = Number($('setVol').value);
  settings.quality = $('setQuality').value;
  settings.invert = $('setInvert').checked;
  settings.hrtf = $('setHrtf').checked;
  settings.touchSens = Number($('setTouchSens').value);
  settings.touchAutoFire = $('setAutoFire').checked;
  settings.touchAssist = $('setAssist').checked;
  saveSettings(settings);
  game.applySettings(settings);
};
$('setGyro').addEventListener('change', async () => {
  const want = $('setGyro').checked;
  const ok = await touch.setGyro(want);
  if (want && !ok) { $('setGyro').checked = false; $('mainError').textContent = 'Gyro aiming is not available on this device.'; }
  settings.gyro = $('setGyro').checked;
});
$('btnEditTouch').addEventListener('click', () => { $('menu').hidden = true; touch.edit(true); });
for (const id of ['nameInput', 'setSens', 'setFov', 'setVol', 'setQuality', 'setInvert', 'setHrtf', 'setTouchSens', 'setAutoFire', 'setAssist']) $(id).addEventListener('change', syncSettings);

function show(screen) {
  $('menu').hidden = !screen;
  for (const s of screens) $(s).hidden = s !== screen;
}

// Runs inside the click that starts play: audio unlock, and on phones fullscreen + landscape.
function unlockAudio() {
  game.audio.unlock();
  if (!game.input.touchMode) return;
  const el = document.documentElement;
  const fs = el.requestFullscreen?.({ navigationUI: 'hide' });
  if (fs?.then) fs.then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}

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
  if (e.code !== 'KeyM' || game.input.typing || document.activeElement?.tagName === 'INPUT') return;
  game.setMuted(!game.muted);
  settings.muted = game.muted;
  if (!params.has('mute')) saveSettings(settings);
  if (game.mode === 'play') game.hud.center(game.muted ? 'Sound off' : 'Sound on', 'Press M to toggle', 1200);
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
  game.start(new LocalConnection(), { name: settings.name, token, local: true });
};

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
  party.send({ t: 'hello', v: PROTOCOL, token, name: settings.name, pings, back: session.backFrom });
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
  if (game.mode !== 'play' || session?.kind !== 'mp') return;
  if (e.key === 'Enter' && chatInput.hidden) {
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
