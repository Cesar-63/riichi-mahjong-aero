import { renderBoard, renderPartner, showCallouts, resultHTML, finalHTML, detectTileset } from './render.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

function newToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const token = store.get('mj.token') || newToken();
store.set('mj.token', token);

const state = {
  room: store.get('mj.room') || 'publica',
  name: store.get('mj.name') || '',
  version: -1,
  view: null,
  clockOffset: 0,
  polling: false,
  lastHb: 0,
  busy: false,
  leftFinished: false,
  ui: { partnerOpen: store.get('mj.partnerOpen') !== '0', riichiMode: false, kanSelect: false, chiSelect: false, ponSelect: false, lastEvent: 0, noCalls: false, optKey: '' },
};

async function api(op, extra = {}) {
  const hb = Date.now() - state.lastHb > 4000;
  if (hb) state.lastHb = Date.now();
  const res = await fetch('/api/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, room: state.room, token, hb, ...extra }),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (data.error) toast(data.error);
  if (data.now) state.clockOffset = data.now - Date.now();
  if (!data.same && data.status) apply(data);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ------------------------------------------------------------------ flow

function apply(data) {
  state.version = data.version;
  if (data.status === 'finished' && state.leftFinished) {
    showLobby({ queue: [], inQueue: false, room: data.room });
    return;
  }
  if (data.status !== 'finished') state.leftFinished = false;
  if (data.abandoned) {
    showLobby({ queue: [], inQueue: false, room: data.room });
    $('#queue').innerHTML = `Abandonaste la partida en la sala <b>${escapeHTML(data.room)}</b>; sigue en automático. Pulsa <b>Entrar a la sala</b> con esa sala para volver a tu asiento.`;
    return;
  }
  if (data.status === 'lobby' || data.spectator) {
    if (state.view && state.view.final) return; // keep the final screen until dismissed
    showLobby(data);
    return;
  }
  const v = data.game;
  state.view = v;
  showGame(v);
  if (data.status === 'finished') state.polling = false;
}

const TEAM_NAME = { N: 'Norte', S: 'Sur' };

function showLobby(data) {
  state.view = null;
  $('#game').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  hideModal();
  const q = $('#queue');
  const inRoom = !!data.inQueue;
  $('#entry').classList.toggle('hidden', inRoom);
  $('#waiting').classList.toggle('hidden', !inRoom);
  if (data.spectator) {
    q.innerHTML = `Hay una partida en curso en la sala <b>${escapeHTML(data.room)}</b> (${data.names.map(escapeHTML).join(', ')}). Prueba otro código de sala.`;
    return;
  }
  if (!inRoom) {
    q.textContent = data.queue && data.queue.length ? `${data.queue.length}/4 en la sala "${data.room}"` : '';
    return;
  }
  q.textContent = '';
  const players = data.queue;
  const me = players.find((p) => p.you);
  $('#w-room').textContent = data.room;
  const row = (p) => `<li class="${p.ready ? 'ready' : ''}">${escapeHTML(p.name)}${p.you ? ' (tú)' : ''}${p.host ? ' <span class="badge">host</span>' : ''}<span class="tick">${p.ready ? '✔ listo' : '…'}</span></li>`;
  for (const team of ['N', 'S']) {
    const box = document.querySelector(`.team[data-team="${team}"]`);
    const members = players.filter((p) => p.team === team);
    box.querySelector('ul').innerHTML = members.map(row).join('') + '<li class="empty">libre</li>'.repeat(2 - members.length);
    const btn = box.querySelector('button');
    btn.classList.toggle('hidden', me.team === team || members.length >= 2);
    box.classList.toggle('mine', me.team === team);
  }
  const loose = players.filter((p) => !p.team);
  $('#unassigned').innerHTML = loose.length ? `Sin equipo: ${loose.map((p) => escapeHTML(p.name) + (p.you ? ' (tú)' : '')).join(', ')}` : '';
  const ready = $('#ready');
  ready.textContent = me.ready ? 'No estoy listo' : 'Estoy listo';
  ready.disabled = !me.team;
  const all = players.length === 4 && players.filter((p) => p.team === 'N').length === 2 && players.every((p) => p.ready);
  $('#start').classList.toggle('hidden', !me.host);
  $('#start').disabled = !all;
  let hint;
  if (!me.team) hint = 'Elige un equipo.';
  else if (players.length < 4) hint = `Esperando jugadores (${players.length}/4).`;
  else if (!all) hint = 'Esperando a que los 4 estén listos en 2 equipos.';
  else hint = me.host ? '¡Todo listo! Pulsa Comenzar partida.' : 'Esperando a que el host comience la partida.';
  $('#w-hint').textContent = hint;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showGame(v) {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  const ui = state.ui;
  const optKey = v.options ? `${v.phase}:${v.events.length ? v.events[v.events.length - 1].id : 0}:${v.options.kind}` : '';
  if (optKey !== ui.optKey) {
    ui.optKey = optKey;
    ui.riichiMode = ui.kanSelect = ui.chiSelect = ui.ponSelect = false;
  }
  const board = $('#board');
  renderBoard(board, v, ui);
  renderPartner(v, ui);
  showCallouts(board, v, ui);
  if (v.phase === 'result' && v.result) showModal(resultHTML(v));
  else if (v.phase === 'end' && v.final) showModal(finalHTML(v));
  else hideModal();

  if (v.options && v.options.kind === 'response' && ui.noCalls && !v.options.ron) send({ type: 'pass' });
  tick();
}

function showModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  m.classList.remove('hidden');
}

function hideModal() {
  $('#modal').classList.add('hidden');
}

async function send(action) {
  if (state.busy) return;
  state.busy = true;
  try {
    await api('act', { action });
  } finally {
    state.busy = false;
  }
}

async function pollLoop() {
  if (state.polling) return;
  state.polling = true;
  while (state.polling) {
    try {
      if (!state.busy) await api('poll', { since: state.version });
    } catch {
      toast('Sin conexión, reintentando…');
    }
    const wait = state.view && state.view.phase !== 'end' ? 700 : 1500;
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ----------------------------------------------------------------- timer

function tick() {
  const v = state.view;
  const els = document.querySelectorAll('.timer');
  if (!v || !v.clock || v.clock.auto) {
    els.forEach((e) => { e.textContent = ''; });
    return;
  }
  const now = Date.now() + state.clockOffset;
  const c = v.clock;
  const left = Math.max(0, c.deadline - now);
  let text;
  if (v.phase === 'result') text = `${Math.ceil(left / 1000)}s`;
  else {
    const base = c.start + c.turnMs - now;
    text = base > 0 ? `${Math.ceil(base / 1000)} + ${Math.ceil(c.bank / 1000)}` : `${Math.ceil(left / 1000)}`;
    els.forEach((e) => e.classList.toggle('low', base <= 0));
  }
  els.forEach((e) => { e.textContent = text; });
}
setInterval(tick, 250);

// ---------------------------------------------------------------- layout

function layout() {
  const size = Math.min(window.innerWidth, window.innerHeight - 4);
  document.documentElement.style.setProperty('--u', `${size / 100}px`);
}
window.addEventListener('resize', () => {
  layout();
  if (state.view) renderPartner(state.view, state.ui);
});
layout();

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const v = state.view;
  const ui = state.ui;
  const tileEl = e.target.closest('.myhand .tile.can');
  if (tileEl && v && v.options && v.options.kind === 'turn') {
    const id = Number(tileEl.dataset.id);
    send(ui.riichiMode ? { type: 'riichi', tile: id } : { type: 'discard', tile: id });
    return;
  }
  const b = e.target.closest('[data-action]');
  if (b) {
    const a = JSON.parse(b.dataset.action);
    if (a.ui) {
      const map = { riichiOn: ['riichiMode', true], riichiOff: ['riichiMode', false], kanOn: ['kanSelect', true], kanOff: ['kanSelect', false], chiOn: ['chiSelect', true], chiOff: ['chiSelect', false], ponOn: ['ponSelect', true], ponOff: ['ponSelect', false] };
      const [key, val] = map[a.ui];
      ui[key] = val;
      showGame(v);
    } else send(a);
    return;
  }
  const u = e.target.closest('[data-ui="lobby"]');
  if (u) {
    state.view = null;
    state.version = -1;
    state.leftFinished = true;
    hideModal();
    showLobby({ queue: [], inQueue: false, room: state.room });
    pollLoop();
  }
});

$('#join').addEventListener('click', async () => {
  const name = $('#name').value.trim();
  const room = $('#room').value.trim().toLowerCase() || 'publica';
  if (!name) {
    toast('Escribe un nombre');
    return;
  }
  state.name = name;
  state.room = room;
  store.set('mj.name', name);
  store.set('mj.room', room);
  state.lastHb = 0;
  await api('join', { name });
  pollLoop();
});

$('#leave').addEventListener('click', () => api('leave'));

document.querySelectorAll('[data-join-team]').forEach((b) => b.addEventListener('click', () => api('team', { team: b.dataset.joinTeam })));
$('#ready').addEventListener('click', () => api('ready', { ready: $('#ready').textContent === 'Estoy listo' }));
$('#start').addEventListener('click', () => api('start'));

// Teammate's hand: click a tile to ask for it (click again to cancel).
$('#partner-hand').addEventListener('click', (e) => {
  const t = e.target.closest('.tile[data-id]');
  const v = state.view;
  if (!t || !v || !v.partner) return;
  const id = Number(t.dataset.id);
  api('request', { tile: v.partner.myRequest === id ? null : id });
});
$('#partner-toggle').addEventListener('click', () => {
  state.ui.partnerOpen = !state.ui.partnerOpen;
  store.set('mj.partnerOpen', state.ui.partnerOpen ? '1' : '0');
  if (state.view) renderPartner(state.view, state.ui);
});

$('#bots').addEventListener('click', async () => {
  const name = $('#name').value.trim();
  if (!name) {
    toast('Escribe un nombre');
    return;
  }
  state.name = name;
  state.room = `bots-${token.slice(0, 12)}`;
  store.set('mj.name', name);
  store.set('mj.room', state.room);
  $('#room').value = state.room;
  state.lastHb = 0;
  await api('join', { name });
  pollLoop();
});

$('#nocalls').addEventListener('change', (e) => {
  state.ui.noCalls = e.target.checked;
});

// ------------------------------------------------------------------ menu

function setMenu(open) {
  $('#menu-panel').classList.toggle('hidden', !open);
  $('#menu-btn').setAttribute('aria-expanded', String(open));
}
$('#menu-btn').addEventListener('click', () => setMenu($('#menu-panel').classList.contains('hidden')));
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu')) setMenu(false);
});

$('#rules-dialog ul').innerHTML = $('#lobby details ul').innerHTML;
$('#m-rules').addEventListener('click', () => {
  setMenu(false);
  $('#rules-dialog').showModal();
});

const canFullscreen = !!document.documentElement.requestFullscreen;
if (!canFullscreen) $('#m-full').classList.add('hidden');
$('#m-full').addEventListener('click', () => {
  setMenu(false);
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  $('#m-full').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
});

$('#m-abandon').addEventListener('click', async () => {
  setMenu(false);
  const v = state.view;
  const botRoom = state.room.startsWith('bots-');
  if (v && v.phase !== 'end') {
    const msg = botRoom
      ? '¿Abandonar la partida contra los bots? La partida se termina.'
      : '¿Abandonar la partida? Tu asiento seguirá jugando en automático (tsumogiri) hasta el final. Puedes volver uniéndote otra vez a la misma sala.';
    if (!confirm(msg)) return;
    await api('abandon');
  }
  state.view = null;
  state.version = -1;
  state.leftFinished = v && v.phase === 'end';
  hideModal();
  if (botRoom) {
    state.room = 'publica';
    store.set('mj.room', state.room);
    $('#room').value = state.room;
  }
  if (!$('#lobby').classList.contains('hidden')) return;
  showLobby({ queue: [], inQueue: false, room: state.room });
  pollLoop();
});

$('#name').value = state.name;
$('#room').value = state.room;

detectTileset().finally(() => {
  // Resume a game in progress for this browser, if any.
  pollLoop();
});
