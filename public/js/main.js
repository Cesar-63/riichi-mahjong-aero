import {
  renderPartner, showCallouts, resultHTML, finalHTML, detectTileset, actionsHTML, tile,
} from './render.js';
import { sortTiles } from './shared/tiles.js';

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
  // lobby choice: 'classic', 'teams' or 'practice' (against bots)
  mode: ['teams', 'practice'].includes(store.get('mj.mode')) ? store.get('mj.mode') : 'classic',
  practiceMate: store.get('mj.practiceMate') === '1',
  name: store.get('mj.name') || '',
  version: -1,
  view: null,
  clockOffset: 0,
  polling: false,
  lastHb: 0,
  busy: false,
  leftFinished: false,
  ui: { partnerOpen: store.get('mj.partnerOpen') !== '0', riichiMode: false, kanSelect: false, chiSelect: false, ponSelect: false, lastEvent: 0, autoSort: store.get('mj.autoSort') !== '0', autoWin: false, noCalls: false, autoTsumogiri: false, oneClick: store.get('mj.oneClick') === '1', dblTsumo: store.get('mj.dblTsumo') === '1', rightTsumo: store.get('mj.rightTsumo') === '1', optKey: '' },
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
  // automatic play is per game (sorting is a preference and stays)
  Object.assign(state.ui, { autoWin: false, noCalls: false, autoTsumogiri: false });
  showAutoButtons();
  $('#game').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  hideModal();
  const q = $('#queue');
  const inRoom = !!data.inQueue;
  $('#lobby').classList.toggle('waiting', inRoom);
  $('#entry').classList.toggle('hidden', inRoom);
  $('#waiting').classList.toggle('hidden', !inRoom);
  $('#queue-hint').classList.add('hidden');
  if (data.spectator) {
    q.innerHTML = `Hay una partida en curso en la sala «${escapeHTML(data.room)}» (${data.names.map(escapeHTML).join(', ')}). Prueba otro nombre de sala.`;
    return;
  }
  if (!inRoom) {
    const n = data.queue ? data.queue.length : 0;
    q.textContent = n ? `${n}/4 en la sala «${data.room}»` : '';
    $('#queue-hint').classList.toggle('hidden', !n);
    return;
  }
  q.textContent = '';
  const players = data.queue;
  const me = players.find((p) => p.you);
  const teams = data.mode === 'teams';
  $('#w-room').textContent = data.room;
  $('#waiting .w-mode').textContent = teams ? 'Por equipos' : 'Clásico';
  $('#waiting .w-jp').textContent = teams ? '団体戦' : '個人戦';
  $('#w-title').textContent = teams ? 'Elige tu equipo' : 'En la sala';
  $('#w-title-jp').textContent = teams ? '組分け' : '待合室';
  $('#w-felt-note').textContent = teams ? 'Los compañeros se sientan uno al lado del otro' : 'Los asientos se sortean al empezar';
  $('#waiting .teams').classList.toggle('hidden', !teams);
  $('#ready').classList.toggle('hidden', !teams);
  // seats around the drawing of the table: Norte at the bottom and right,
  // Sur at the top and left (teammates sit side by side)
  const seats = [...document.querySelectorAll('#waiting .w-seat')];
  const plate = (p, team) => {
    if (!p) return `<span class="free">Asiento libre${team ? ` · ${TEAM_NAME[team]}` : ''}</span>`;
    const status = teams ? (p.ready ? '<i class="ok">listo</i>' : '<i>esperando</i>') : '';
    return `<span class="who">${team ? `<b>${TEAM_NAME[team]}</b>` : ''}<span>${escapeHTML(p.name)}${p.you ? ' <small>(tú)</small>' : ''}</span></span>${status}`;
  };
  if (teams) {
    const n = players.filter((p) => p.team === 'N');
    const so = players.filter((p) => p.team === 'S');
    [[n[0], 'N'], [n[1], 'N'], [so[0], 'S'], [so[1], 'S']].forEach(([p, t], i) => {
      seats[i].className = `w-seat ${p ? `t${t}` : 'empty'}`;
      setIfChanged(seats[i], plate(p, t));
    });
  } else {
    seats.forEach((el, i) => {
      const p = players[i];
      el.className = `w-seat${p ? '' : ' empty'}`;
      setIfChanged(el, plate(p));
    });
  }
  if (!teams) {
    $('#start').classList.add('hidden');
    $('#unassigned').innerHTML = `En la sala (${players.length}/4): ${players.map((p) => escapeHTML(p.name) + (p.you ? ' (tú)' : '')).join(', ')}`;
    $('#w-hint').textContent = 'La partida empieza sola al llegar el cuarto jugador; los asientos se sortean.';
    return;
  }
  const row = (p) => `<li class="${p.ready ? 'ready' : ''}">${escapeHTML(p.name)}${p.you ? ' <small>(tú)</small>' : ''}${p.host ? ' <span class="badge">anfitrión</span>' : ''}</li>`;
  for (const team of ['N', 'S']) {
    const box = document.querySelector(`.team[data-team="${team}"]`);
    const members = players.filter((p) => p.team === team);
    box.querySelector('ul').innerHTML = members.map(row).join('') + '<li class="empty">— libre —</li>'.repeat(2 - members.length);
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
  else if (!all) hint = 'Esperando a que los cuatro estén listos, dos por equipo.';
  else hint = me.host ? '¡Todo listo! Pulsa Comenzar.' : 'Cuando los cuatro estén listos, el anfitrión empieza la partida.';
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
  renderHud(v, ui);
  ensure3d().then((t) => {
    if (state.view !== v) return;
    t.update(v, ui);
  });
  showCallouts($('#hud3d'), v, ui);
  renderPartner(v, ui);
  // A win first plays its reveal before the score screen opens, and an
  // exhaustive draw first lays the hands down (tenpai face up, noten face
  // down).
  const res = v.phase === 'result' ? v.result : null;
  const revealed = res && (res.type === 'agari' || (res.type === 'draw' && !res.abortive));
  const winKey = revealed ? `${v.round}-${v.kyokuNum}-${v.honba}` : null;
  if (winKey && ui.winStarted !== winKey) {
    ui.winStarted = winKey;
    const finish = () => {
      if (ui.winDone === winKey) return;
      ui.winDone = winKey;
      hideDoraBanner();
      if (state.view) showGame(state.view);
    };
    // safety net in case the reveal never reports back
    setTimeout(finish, 13000);
    ui.winFinish = finish;
  }
  const holdModal = winKey && ui.winDone !== winKey;
  if (holdModal) hideModal();
  else if (v.phase === 'result' && v.result) showModal(resultHTML(v), 'result');
  else if (v.phase === 'end' && v.final) showModal(finalHTML(v, state.room), 'final');
  else hideModal();

  autoPlay(v, ui);
  tick();
}

// Automatic play, toggled from the sidebar on the left edge as in Mahjong
// Soul: R wins as soon as possible, C passes chi/pon/kan on the others'
// discards (my own kan, riichi or tsumo are untouched), D discards every
// drawn tile. All three together play like a riichi. Each decision is acted
// on once. A (auto sort) is on top of them.
function autoPlay(v, ui) {
  const o = v.options;
  if (!o || state.busy || ui.autoKey === ui.optKey) return;
  const act = (action) => {
    ui.autoKey = ui.optKey;
    send(action);
  };
  if (o.kind === 'response') {
    if (o.ron) {
      if (ui.autoWin) act({ type: 'ron' });
    } else if (ui.noCalls) act({ type: 'pass' });
    return;
  }
  if (o.tsumo) {
    // without automatic wins the choice stays with the player
    if (ui.autoWin) act({ type: 'tsumo' });
    return;
  }
  if (ui.autoTsumogiri && v.drawn !== null && o.discard.includes(v.drawn)) {
    const key = ui.optKey;
    ui.autoKey = key;
    // let the drawn tile land in the hand first
    setTimeout(() => {
      if (ui.optKey !== key || !state.view) return;
      if (state.busy) ui.autoKey = null;
      else discard(v.drawn);
    }, 350);
  }
}

// the sidebar shows only the letters until its arrow opens it
$('#hud3d .auto-toggle').addEventListener('click', (e) => {
  const open = $('#hud3d .autobar').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
  e.currentTarget.setAttribute('aria-label', open ? 'Ocultar los nombres' : 'Mostrar los nombres');
});

function showAutoButtons() {
  for (const b of document.querySelectorAll('#hud3d [data-auto]')) b.setAttribute('aria-pressed', String(!!state.ui[b.dataset.auto]));
}
for (const b of document.querySelectorAll('#hud3d [data-auto]')) {
  b.addEventListener('click', () => {
    const key = b.dataset.auto;
    state.ui[key] = !state.ui[key];
    showAutoButtons();
    if (key === 'autoSort') {
      store.set('mj.autoSort', state.ui.autoSort ? '1' : '0');
      if (table3d) table3d.then((t) => t.setAutoSort(state.ui.autoSort));
      return;
    }
    // a pending decision is taken right away
    state.ui.autoKey = null;
    if (state.view) autoPlay(state.view, state.ui);
  });
}
showAutoButtons();

// ------------------------------------------------------------------ 3D view

// The 3D renderer (three.js) is downloaded when the first game starts.
let table3d = null;
function ensure3d() {
  if (!table3d) {
    table3d = import('./three3d/table3d.js').then((m) => {
      const t = m.createTable3D($('#stage3d'), {
        // a click on one of my 3D hand tiles
        onPick: (id) => discard(id),
      });
      t.setCallouts([...document.querySelectorAll('#hud3d .callout')]);
      t.setOneClick(state.ui.oneClick);
      t.setAutoSort(state.ui.autoSort);
      t.onIntro(({ active }) => $('#hud3d').classList.toggle('intro', active));
      // the top band folds away while the camera shows the whole table
      t.onView((name) => {
        $('#game').classList.toggle('v-overview', name === 'overview' || name === 'free');
      });
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

// Dora count shown during the 3D win reveal: indicators, ura and the han
// each kind adds for the (first) winner.
function showDoraBanner(result) {
  const w = result.wins[0];
  const han = (k) => (w.yaku.find(([y]) => y === k) || [k, 0])[1];
  const group = (label, ids, n) => `<div class="dgroup"><span class="dl">${label}</span>${ids.map((id) => tile(id)).join('')}<b>${n}</b></div>`;
  let html = group('Dora <i class="jp">ドラ</i>', result.dora, han('dora'));
  if (w.ura && w.ura.length) html += group('Ura <i class="jp">裏ドラ</i>', w.ura, han('ura'));
  if (han('aka')) html += `<div class="dgroup"><span class="dl">Rojas <i class="jp">赤ドラ</i></span><b>${han('aka')}</b></div>`;
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

// The three opponents along the top band: a framed portrait (it hides the
// chair) over a wooden plaque with wind, name, tags and score; left =
// kamicha, centre = toimen, right = shimocha. No portrait art yet: a
// silhouette on the player's own colour.
const WIND_ES = ['Este', 'Sur', 'Oeste', 'Norte'];
const BACKDROP = [['#7d7842', '#5f5b31'], ['#8a7a52', '#64583a'], ['#6f7a5a', '#4f573e'], ['#7a5a52', '#57403a']];
const SILHOUETTE = '<svg viewBox="0 0 200 140" aria-hidden="true"><ellipse cx="100" cy="52" rx="30" ry="36"/><path d="M14 140 C 22 96, 60 84, 100 84 C 140 84, 178 96, 186 140 Z"/></svg>';
function portraitsHTML(v) {
  return [3, 2, 1].map((r) => {
    const abs = (v.seat + r) % 4;
    const p = v.players[abs];
    const [a, b] = BACKDROP[abs];
    const turn = v.turn === abs && v.phase === 'turn';
    const tags = [
      p.riichi ? '<i class="tag riichi">Riichi</i>' : '',
      v.partner && v.partner.seat === abs ? '<i class="tag mate">compañero</i>' : '',
      p.abandoned ? '<i class="tag off">abandonó</i>' : !p.online ? '<i class="tag off">sin conexión</i>' : '',
      turn ? '<i class="tag turn">su turno</i>' : '',
    ].join('');
    const pos = ['', 'right', 'top', 'left'][r];
    return `<div class="seatcard ${pos}${turn ? ' turn' : ''}">
      <div class="frame" style="--a:${a};--b:${b}">${SILHOUETTE}${p.bot ? '<span class="bot">bot</span>' : ''}</div>
      <div class="plaque"><span class="wind${abs === v.dealer ? ' oya' : ''}">${WIND_ES[p.wind]}</span><b>${escapeHTML(p.name)}</b>${tags}<span class="score">${p.score}</span></div>
    </div>`;
  }).join('');
}

// Paper chit with the round, sticks on the table, wall and my own score.
function roundInfoHTML(v) {
  const me = v.players[v.seat];
  return `<span class="round">${WIND_ES[v.round] || '?'} ${v.kyokuNum + 1}${v.honba ? ` <small>· Honba ${v.honba}</small>` : ''}</span>
    <span>Depósitos ${v.kyoutaku} · Quedan ${v.wallLeft}</span>
    <span>Tú: <b class="${v.seat === v.dealer ? 'oya' : ''}">${WIND_ES[me.wind]}</b> · ${me.score}</span>`;
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
      <em class="${abs === v.dealer ? 'oya' : ''}">${WIND_ES[p.wind]}</em>
      <b>${escapeHTML(p.name)}</b><span>${p.score}</span>${gap}</div>`;
  }).join('');
  return `${cards}<div class="sc mid">${WIND_ES[v.round] || '?'} ${v.kyokuNum + 1}<small>Honba ${v.honba} · Depósitos ${v.kyoutaku} · toca para cerrar</small></div>`;
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
  setIfChanged(hud.querySelector('.furiten-slot'), v.furiten ? '<span class="furiten">Furiten <i class="jp">振聴</i></span>' : '');
  const askedBy = v.partner && v.partnerRequest !== null ? v.players[v.partner.seat].name : null;
  setIfChanged(hud.querySelector('.ask'), askedBy ? `<span>${escapeHTML(askedBy)} te pide</span>${tile(v.partnerRequest)}` : '');
}

// kind: 'result' (sheet over the 3D table) or 'final' (the score sheet)
function showModal(html, kind) {
  const m = $('#modal');
  m.className = kind;
  setIfChanged(m, html);
}

function hideModal() {
  $('#modal').className = 'hidden';
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
  // the prediction becomes the view on screen (the 3D table only draws the
  // current view), until the server's answer replaces it
  state.view = predictDiscard(v, tile, riichi);
  showGame(state.view);
  send(riichi ? { type: 'riichi', tile } : { type: 'discard', tile }).catch(() => {
    toast('Sin conexión, la ficha vuelve a tu mano');
  }).finally(() => {
    // no usable answer (network error): back to the last real table
    if (state.pending) {
      state.pending = null;
      state.view = v;
      showGame(v);
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

// Joining a room, or a practice room of my own against the bots.
$('#join').addEventListener('click', async () => {
  const name = $('#name').value.trim();
  if (!name) {
    toast('Escribe tu nombre');
    $('#name').focus();
    return;
  }
  const practice = state.mode === 'practice';
  const mode = practice ? (state.practiceMate ? 'teams' : 'classic') : state.mode;
  const room = practice
    ? `bots-${mode === 'teams' ? 't' : 'c'}-${token.slice(0, 10)}`
    : $('#room').value.trim().toLowerCase() || 'publica';
  state.name = name;
  state.room = room;
  store.set('mj.name', name);
  store.set('mj.room', room);
  if (!practice) $('#room').value = room;
  state.lastHb = 0;
  await api('join', { name, mode });
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

// Discard style: click to pick a tile up and again to discard it (the
// default), or a single click.
// Tsumogiri shortcuts (off by default; kept in the browser): a double click
// off my hand tiles, or a right click anywhere, discards the drawn tile.
for (const [id, key, name] of [['#dbltsumo', 'dblTsumo', 'mj.dblTsumo'], ['#righttsumo', 'rightTsumo', 'mj.rightTsumo']]) {
  $(id).checked = state.ui[key];
  $(id).addEventListener('change', (e) => {
    state.ui[key] = e.target.checked;
    store.set(name, state.ui[key] ? '1' : '0');
  });
}
function tsumogiri() {
  const v = state.view;
  if (v && v.options && v.options.kind === 'turn' && v.drawn !== null) discard(v.drawn);
}
$('#stage3d').addEventListener('dblclick', (e) => {
  if (!state.ui.dblTsumo || !table3d) return;
  table3d.then((t) => {
    if (!t.overHandTile(e)) tsumogiri();
  });
});
$('#stage3d').addEventListener('contextmenu', (e) => {
  if (!state.ui.rightTsumo) return;
  e.preventDefault();
  tsumogiri();
});

$('#oneclick').checked = state.ui.oneClick;
$('#oneclick').addEventListener('change', (e) => {
  state.ui.oneClick = e.target.checked;
  store.set('mj.oneClick', state.ui.oneClick ? '1' : '0');
  if (table3d) table3d.then((t) => t.setOneClick(state.ui.oneClick));
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

$('#rules-link').addEventListener('click', (e) => {
  e.preventDefault();
  $('#rules-dialog').showModal();
});
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
  }
  if (!$('#lobby').classList.contains('hidden')) return;
  showLobby({ queue: [], inQueue: false, room: state.room });
  pollLoop();
});

// Practice needs no room name; it can be played as a team with Bot 1.
function showMode() {
  const practice = state.mode === 'practice';
  $('#entry').classList.toggle('practice', practice);
  $('#join .es').textContent = practice ? 'Empezar práctica' : 'Entrar a la sala';
  $('#join .jp').textContent = practice ? '稽古' : '入場';
}
document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.checked = r.value === state.mode;
  r.addEventListener('change', () => {
    state.mode = r.value;
    store.set('mj.mode', state.mode);
    showMode();
  });
});
$('#practice-mate').checked = state.practiceMate;
$('#practice-mate').addEventListener('change', (e) => {
  state.practiceMate = e.target.checked;
  store.set('mj.practiceMate', state.practiceMate ? '1' : '0');
});
showMode();

$('#name').value = state.name;
$('#room').value = state.room.startsWith('bots-') ? 'publica' : state.room;

detectTileset().finally(() => {
  // Resume a game in progress for this browser, if any.
  pollLoop();
});
