import { renderBoard, showCallouts, resultHTML, finalHTML, detectTileset } from './render.js';

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
  ui: { riichiMode: false, kanSelect: false, chiSelect: false, ponSelect: false, lastEvent: 0, noCalls: false, optKey: '' },
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

function showLobby(data) {
  state.view = null;
  $('#game').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  hideModal();
  const q = $('#queue');
  if (data.spectator) {
    q.innerHTML = `Hay una partida en curso en la sala <b>${data.room}</b> (${data.names.join(', ')}). Prueba otro código de sala.`;
    $('#leave').classList.add('hidden');
    $('#join').classList.remove('hidden');
    return;
  }
  if (data.inQueue) {
    q.innerHTML = `En cola en <b>${data.room}</b>: ${data.queue.length}/4 — ${data.queue.map(escapeHTML).join(', ')}`;
    $('#join').classList.add('hidden');
    $('#leave').classList.remove('hidden');
  } else {
    q.textContent = data.queue && data.queue.length ? `${data.queue.length}/4 esperando en "${data.room}"` : '';
    $('#join').classList.remove('hidden');
    $('#leave').classList.add('hidden');
  }
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
window.addEventListener('resize', layout);
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

$('#nocalls').addEventListener('change', (e) => {
  state.ui.noCalls = e.target.checked;
});

$('#name').value = state.name;
$('#room').value = state.room;

detectTileset().finally(() => {
  // Resume a game in progress for this browser, if any.
  pollLoop();
});
