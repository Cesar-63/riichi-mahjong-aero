import {
  renderBoard, renderPartner, showCallouts, resultHTML, finalHTML, detectTileset, actionsHTML, tile,
} from './render.js';
import { WIND_KANJI, sortTiles } from './shared/tiles.js';

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
  mode: store.get('mj.mode') === 'teams' ? 'teams' : 'classic',
  theme: store.get('mj.theme') === 'tetsuya' ? 'tetsuya' : 'aero',
  // 3D unless 2.5D was chosen; ?3d=1 / ?3d=0 in the URL overrides the saved choice
  view3d: new URLSearchParams(location.search).has('3d')
    ? new URLSearchParams(location.search).get('3d') !== '0'
    : store.get('mj.3d') !== '0',
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
  // while a discard is on its way, an older poll answer would put the tile back
  const stale = op === 'poll' && state.pending && data.version <= state.pending.version;
  if (!data.same && data.status && !stale) {
    if (op === 'act') state.pending = null;
    apply(data);
  }
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
  const teams = data.mode === 'teams';
  $('#w-room').textContent = data.room;
  $('#w-mode').textContent = teams ? '· Por equipos' : '· Clásico';
  $('#waiting .teams').classList.toggle('hidden', !teams);
  $('#ready').classList.toggle('hidden', !teams);
  if (!teams) {
    $('#start').classList.add('hidden');
    $('#unassigned').innerHTML = `En la sala (${players.length}/4): ${players.map((p) => escapeHTML(p.name) + (p.you ? ' (tú)' : '')).join(', ')}`;
    $('#w-hint').textContent = 'La partida empieza sola al llegar a 4 jugadores; los asientos se sortean.';
    return;
  }
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
  ui.view3d = state.view3d;
  $('#board').classList.toggle('hidden', state.view3d);
  $('#stage3d').classList.toggle('hidden', !state.view3d);
  $('#hud3d').classList.toggle('hidden', !state.view3d);
  if (state.view3d) {
    renderHud(v, ui);
    ensure3d().then((t) => {
      if (state.view !== v) return;
      t.update(v, ui);
    });
    showCallouts($('#hud3d'), v, ui);
  } else {
    const board = $('#board');
    renderBoard(board, v, ui);
    showCallouts(board, v, ui);
    intro2d(v, ui);
  }
  renderPartner(v, ui);
  // A win first plays its reveal (3D) or lets the call show (2D) before the
  // score screen opens; in 3D an exhaustive draw first lays the hands down
  // (tenpai face up, noten face down).
  const res = v.phase === 'result' ? v.result : null;
  const revealed = res && (res.type === 'agari' || (state.view3d && res.type === 'draw' && !res.abortive));
  const winKey = revealed ? `${v.round}-${v.kyokuNum}-${v.honba}` : null;
  if (winKey && ui.winStarted !== winKey) {
    ui.winStarted = winKey;
    const finish = () => {
      if (ui.winDone === winKey) return;
      ui.winDone = winKey;
      hideDoraBanner();
      if (state.view) showGame(state.view);
    };
    // safety net in case the 3D reveal never reports back
    setTimeout(finish, state.view3d ? 13000 : 1300);
    ui.winFinish = finish;
  }
  const holdModal = winKey && ui.winDone !== winKey;
  if (holdModal) hideModal();
  else if (v.phase === 'result' && v.result) showModal(resultHTML(v));
  else if (v.phase === 'end' && v.final) showModal(finalHTML(v));
  else hideModal();

  if (v.options && v.options.kind === 'response' && ui.noCalls && !v.options.ron) send({ type: 'pass' });
  tick();
}

// ------------------------------------------------------------------ 3D view

// The 3D renderer (three.js) is only downloaded when the 3D view is used.
let table3d = null;
function ensure3d() {
  if (!table3d) {
    table3d = import('./three3d/table3d.js').then((m) => {
      const t = m.createTable3D($('#stage3d'), state.theme, {
        // a click on one of my 3D hand tiles
        onPick: (id) => discard(id),
      });
      t.setCallouts([...document.querySelectorAll('#hud3d .callout')]);
      t.onIntro(({ active }) => $('#hud3d').classList.toggle('intro', active));
      t.onPoints(({ open }) => {
        if (open) return;
        $('#scores3d').classList.add('hidden');
        $('#hud3d').classList.remove('points');
      });
      t.onWin(({ phase, result }) => {
        if (phase === 'dora') showDoraBanner(result);
        if (phase === 'done' && state.ui.winFinish) state.ui.winFinish();
      });
      return t;
    });
  }
  return table3d;
}

const setIfChanged = (el, html) => {
  if (el._h !== html) {
    el._h = html;
    el.innerHTML = html;
  }
};

// 2D board: during the deal pause show the phases and the dice roll.
const DIE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function intro2d(v, ui) {
  const key = `${v.round}-${v.kyokuNum}-${v.honba}`;
  if (!v.intro || v.intro.left < 400 || !v.wall || ui.intro2dKey === key) return;
  ui.intro2dKey = key;
  const box = $('#intro2d');
  const total = v.intro.total;
  const t0 = Date.now() - (total - v.intro.left);
  const [a, b] = v.wall.dice;
  clearInterval(intro2d.timer);
  box.classList.remove('hidden');
  intro2d.timer = setInterval(() => {
    const p = (Date.now() - t0) / total;
    if (p >= 1) {
      clearInterval(intro2d.timer);
      box.classList.add('hidden');
      return;
    }
    let html;
    if (p < 0.26) html = '<b>Revolviendo fichas…</b>';
    else if (p < 0.56) html = '<b>Armando los muros…</b>';
    else if (p < 0.72) {
      const r = () => 1 + Math.floor(Math.random() * 6);
      const rolling = p < 0.68;
      html = `<b>Tirando dados</b><span class="dice ${rolling ? 'rolling' : ''}">${DIE_FACE[rolling ? r() : a]}${DIE_FACE[rolling ? r() : b]}</span>`;
    } else html = `<b>Repartiendo…</b><span class="dice">${DIE_FACE[a]}${DIE_FACE[b]}</span><small>${a + b}</small>`;
    if (box._h !== html) {
      box._h = html;
      box.innerHTML = html;
    }
  }, 120);
}

// Dora count shown during the 3D win reveal: indicators, ura and the han
// each kind adds for the (first) winner.
function showDoraBanner(result) {
  const w = result.wins[0];
  const han = (k) => (w.yaku.find(([y]) => y === k) || [k, 0])[1];
  const group = (label, ids, n) => `<div class="dgroup"><span class="dl">${label}</span>${ids.map((id) => tile(id)).join('')}<b>${n}</b></div>`;
  let html = group('ドラ Dora', result.dora, han('dora'));
  if (w.ura && w.ura.length) html += group('裏ドラ Ura', w.ura, han('ura'));
  if (han('aka')) html += `<div class="dgroup"><span class="dl">赤ドラ Aka</span><b>${han('aka')}</b></div>`;
  const el = $('#dora3d');
  el.innerHTML = html;
  el.classList.remove('hidden');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function hideDoraBanner() {
  $('#dora3d').classList.add('hidden');
}

// Tetsuya-style portraits of the three opponents along the top of the 3D view:
// left = kamicha, centre = toimen, right = shimocha.
const AVATAR = [['#ffb199', '#ff5e7e'], ['#8fe3ff', '#2a8fe6'], ['#b9f58a', '#2fae2c'], ['#ffe08a', '#f08a12']];
function portraitsHTML(v) {
  return [3, 2, 1].map((r) => {
    const abs = (v.seat + r) % 4;
    const p = v.players[abs];
    const [a, b] = AVATAR[abs];
    const turn = v.turn === abs && v.phase === 'turn';
    const tags = [
      p.riichi ? '<i class="tag riichi">リーチ</i>' : '',
      v.partner && v.partner.seat === abs ? '<i class="tag mate">compañero</i>' : '',
      p.abandoned ? '<i class="tag off">abandonó</i>' : !p.online ? '<i class="tag off">desconectado</i>' : '',
    ].join('');
    return `<div class="pcard${turn ? ' turn' : ''}">
      <div class="avatar" style="--a:${a};--b:${b}">${escapeHTML((p.name || '?').trim().charAt(0).toUpperCase())}${p.bot ? '<span>🤖</span>' : ''}</div>
      <div class="pinfo">
        <b>${escapeHTML(p.name)}</b>
        <span><em class="${abs === v.dealer ? 'oya' : ''}">${WIND_KANJI[p.wind]}</em> ${p.score}</span>
        <span class="tags">${tags}</span>
      </div>
    </div>`;
  }).join('');
}

// Round, sticks, wall and my own score (shown in the Tetsuya setting, whose
// table has no centre panel).
function roundInfoHTML(v) {
  const me = v.players[v.seat];
  return `<b>${WIND_KANJI[v.round] || '?'}${v.kyokuNum + 1}局</b>
    <span>${v.honba}本場</span><span>供託 ${v.kyoutaku}</span><span>残り ${v.wallLeft}</span>
    <span class="mine"><em class="${v.seat === v.dealer ? 'oya' : ''}">${WIND_KANJI[me.wind]}</em> ${me.score}</span>`;
}

// The table's scores as seen from my seat: me at the bottom, the others in
// their places (left = kamicha, top = toimen, right = shimocha), with the
// gap to my score.
function scoresHTML(v) {
  const me = v.players[v.seat];
  const POS = ['bottom', 'right', 'top', 'left'];
  const cards = [0, 1, 2, 3].map((r) => {
    const abs = (v.seat + r) % 4;
    const p = v.players[abs];
    const diff = p.score - me.score;
    const gap = r === 0 ? '' : `<small class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)}</small>`;
    return `<div class="sc ${POS[r]}${r === 0 ? ' me' : ''}">
      <em class="${abs === v.dealer ? 'oya' : ''}">${WIND_KANJI[p.wind]}</em>
      <b>${escapeHTML(p.name)}</b><span>${p.score}</span>${gap}</div>`;
  }).join('');
  return `${cards}<div class="sc mid">${WIND_KANJI[v.round] || '?'}${v.kyokuNum + 1}局<small>本 ${v.honba} · 供 ${v.kyoutaku} · toca para cerrar</small></div>`;
}

function togglePoints() {
  if (!table3d) return;
  table3d.then((t) => {
    if (t.pointsOpen()) {
      t.closePoints();
      return;
    }
    const v = state.view;
    if (!v) return;
    if (t.openPoints(v, () => {
      $('#scores3d').innerHTML = scoresHTML(state.view || v);
      $('#scores3d').classList.remove('hidden');
    })) $('#hud3d').classList.add('points');
  });
}
$('#hud3d .points-btn').addEventListener('click', togglePoints);
$('#scores3d').addEventListener('click', togglePoints);

// Buttons, timer and notices over the 3D canvas (the hand itself is 3D, see
// three3d/hand3d.js).
function renderHud(v, ui) {
  const hud = $('#hud3d');
  setIfChanged(hud.querySelector('.portraits'), portraitsHTML(v));
  setIfChanged(hud.querySelector('.roundinfo'), roundInfoHTML(v));
  setIfChanged(hud.querySelector('.actions'), actionsHTML(v, ui));
  setIfChanged(hud.querySelector('.furiten-slot'), v.furiten ? '<span class="furiten">振聴 Furiten</span>' : '');
  const askedBy = v.partner && v.partnerRequest !== null ? v.players[v.partner.seat].name : null;
  setIfChanged(hud.querySelector('.ask'), askedBy ? `<span>${escapeHTML(askedBy)} te pide</span>${tile(v.partnerRequest)}` : '');
}

function showModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  m.classList.remove('hidden');
}

function hideModal() {
  $('#modal').classList.add('hidden');
}

// A discard shows at once: the predicted table (the tile out of the hand and
// in the pond) is drawn right away and the server's answer replaces it; if
// the server refuses, its answer puts the tile back.
function predictDiscard(v, tile, riichi) {
  const p = structuredClone(v);
  const me = p.players[p.seat];
  p.hand = sortTiles([...p.hand, ...(p.drawn !== null ? [p.drawn] : [])].filter((t) => t !== tile));
  me.discards = [...me.discards, { tile, tsumogiri: p.drawn === tile, riichi, called: false }];
  me.handCount = p.hand.length;
  me.hasDrawn = false;
  p.drawn = null;
  p.options = null;
  return p;
}

function discard(tile) {
  const v = state.view;
  const riichi = !!state.ui.riichiMode;
  const o = v && v.options;
  if (state.busy || !o || o.kind !== 'turn' || !(riichi ? o.riichi : o.discard).includes(tile)) return;
  state.pending = { version: state.version };
  showGame(predictDiscard(v, tile, riichi));
  send(riichi ? { type: 'riichi', tile } : { type: 'discard', tile }).finally(() => {
    // no usable answer (network error): back to the last real table
    if (state.pending) {
      state.pending = null;
      if (state.view) showGame(state.view);
    }
  });
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
    discard(Number(tileEl.dataset.id));
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
  await api('join', { name, mode: state.mode });
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
  state.room = `bots-${state.mode === 'teams' ? 't' : 'c'}-${token.slice(0, 10)}`;
  store.set('mj.name', name);
  store.set('mj.room', state.room);
  $('#room').value = state.room;
  state.lastHb = 0;
  await api('join', { name, mode: state.mode });
  pollLoop();
});

$('#nocalls').addEventListener('change', (e) => {
  state.ui.noCalls = e.target.checked;
});

// Setting (Frutiger Aero / Tetsuya parlour): CSS theme + 3D scene.
function setTheme(theme) {
  state.theme = theme === 'tetsuya' ? 'tetsuya' : 'aero';
  store.set('mj.theme', state.theme);
  document.documentElement.dataset.theme = state.theme;
  document.querySelectorAll('.theme-select').forEach((s) => { s.value = state.theme; });
  if (table3d) table3d.then((t) => t.setTheme(state.theme));
}
document.querySelectorAll('.theme-select').forEach((sel) => {
  sel.addEventListener('change', () => setTheme(sel.value));
});
setTheme(state.theme);

// View (3D / 2.5D), chosen in the lobby or the in-game menu.
function setView3d(on) {
  state.view3d = on;
  store.set('mj.3d', on ? '1' : '0');
  document.querySelectorAll('.view-select').forEach((s) => { s.value = on ? '3d' : '2d'; });
  if (state.view) showGame(state.view);
}
document.querySelectorAll('.view-select').forEach((sel) => {
  sel.value = state.view3d ? '3d' : '2d';
  sel.addEventListener('change', () => setView3d(sel.value === '3d'));
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

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.checked = r.value === state.mode;
  r.addEventListener('change', () => {
    state.mode = r.value;
    store.set('mj.mode', state.mode);
  });
});

$('#name').value = state.name;
$('#room').value = state.room;

detectTileset().finally(() => {
  // Resume a game in progress for this browser, if any.
  pollLoop();
});
