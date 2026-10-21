// DOM rendering of the table from a server view.
import {
  tileType, isAka, suitOf, numOf, imageName, HONOR_KANJI, SUIT_KANJI, WIND_KANJI,
  YAKU_NAMES, DRAW_NAMES, deadSlot,
} from './shared/tiles.js';

// Tile art: FluffyStuff/riichi-mahjong-tiles layout in /tiles if present
// (Front + face layered), a flat set via tiles/tileset.json, else CSS tiles.
export const tileset = { mode: 'text', ext: 'svg', layered: true, dir: 'tiles/' };

export async function detectTileset() {
  const probe = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  if (await probe('tiles/Front.svg')) {
    Object.assign(tileset, { mode: 'img', ext: 'svg', layered: true });
  } else {
    try {
      const res = await fetch('tiles/tileset.json', { cache: 'no-cache' });
      if (res.ok) {
        const cfg = await res.json();
        Object.assign(tileset, { mode: 'img', ext: cfg.ext || 'svg', layered: cfg.layered !== false });
      }
    } catch { /* no manifest: CSS tiles */ }
  }
  if (tileset.mode === 'img') await preloadTiles();
}

// Download and decode every tile image up front and keep them referenced, so
// tiles never appear blank while their face image loads.
const preloaded = [];
async function preloadTiles() {
  const names = new Set(tileset.layered ? [] : ['Back']);
  for (let t = 0; t < 34; t++) names.add(imageName(t * 4 + 1));
  for (const id of [16, 52, 88]) names.add(imageName(id));
  await Promise.all([...names].map((n) => {
    const img = new Image();
    img.src = `${tileset.dir}${n}.${tileset.ext}`;
    preloaded.push(img);
    return img.decode().catch(() => {});
  }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function face(id) {
  if (id === null || id === undefined || id < 0) {
    // Layered sets (FluffyStuff) ship a flat-colour Back; the themed CSS back looks better.
    if (tileset.mode === 'img' && !tileset.layered) return `<span class="tf back"><img src="${tileset.dir}Back.${tileset.ext}" alt="" decoding="sync"></span>`;
    return '<span class="tf back"></span>';
  }
  const t = tileType(id);
  if (tileset.mode === 'img') {
    const src = `${tileset.dir}${imageName(id)}.${tileset.ext}`;
    // Layered sets draw the tile body in CSS (so its 2.5D edge can follow the
    // seat rotation); flat sets are full tile images.
    return `<span class="tf img${tileset.layered ? ' layered' : ''}"><img src="${src}" alt="${imageName(id)}" decoding="sync"></span>`;
  }
  const aka = isAka(id) ? ' aka' : '';
  if (t >= 27) return `<span class="tf txt h${t - 27}${aka}"><b>${HONOR_KANJI[t - 27]}</b></span>`;
  return `<span class="tf txt s${suitOf(t)}${aka}"><b>${numOf(t)}</b><i>${SUIT_KANJI[suitOf(t)]}</i></span>`;
}

export function tile(id, { side = false, cls = '', attrs = '' } = {}) {
  if (side) return `<span class="tile side ${cls}" ${attrs}><span class="rot">${face(id)}</span></span>`;
  return `<span class="tile ${cls}" ${attrs}>${face(id)}</span>`;
}

export function tileOfType(t) {
  return tile(t * 4 + 1);
}

function meldHTML(m, owner) {
  if (m.type === 'ankan') {
    return `<span class="meld">${tile(-1)}${tile(m.tiles[1])}${tile(m.tiles[2])}${tile(-1)}</span>`;
  }
  const rel = (m.from - owner + 4) % 4; // 1 right, 2 across, 3 left
  const others = m.tiles.filter((x) => x !== m.called && x !== m.added);
  let sideHTML = tile(m.called, { side: true });
  if (m.type === 'kakan') {
    sideHTML = `<span class="kakan">${tile(m.added, { side: true })}${tile(m.called, { side: true })}</span>`;
  }
  const parts = others.map((x) => tile(x));
  const pos = rel === 3 ? 0 : rel === 2 ? 1 : parts.length;
  parts.splice(pos, 0, sideHTML);
  return `<span class="meld">${parts.join('')}</span>`;
}

function pondRows(discards) {
  const visible = [];
  let sideNext = false;
  for (const d of discards) {
    if (d.called) {
      if (d.riichi) sideNext = true;
      continue;
    }
    visible.push({ ...d, side: d.riichi || sideNext });
    if (d.riichi || sideNext) sideNext = false;
  }
  return [visible.slice(0, 6), visible.slice(6, 12), visible.slice(12)].map((row) => row.map((d) => ({
    key: `${d.tile}${d.side ? 's' : ''}`,
    html: tile(d.tile, { side: d.side, cls: d.tsumogiri ? 'tg' : '', attrs: `data-tile="${d.tile}"` }),
  })));
}

// Keyed update of a container's children: nodes whose key and markup are
// unchanged are kept, so their tile images are never recreated (recreating
// an SVG <img> shows a blank tile until the browser rasterizes it again).
function reconcile(container, items) {
  const old = new Map();
  for (const el of container.children) old.set(el.dataset.k, el);
  let prev = null;
  for (const { key, html } of items) {
    let el = old.get(key);
    if (el && el._h === html) old.delete(key);
    else {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      el = t.content.firstElementChild;
      el.dataset.k = key;
      el._h = html;
    }
    const ref = prev ? prev.nextSibling : container.firstChild;
    if (el !== ref) container.insertBefore(el, ref);
    prev = el;
  }
  for (const el of old.values()) el.remove();
}

function setHTML(el, html) {
  if (el._h !== html) {
    el._h = html;
    el.innerHTML = html;
  }
}

const ROT = [0, -90, 180, 90];
const CALL_TEXT = { chi: 'チー', pon: 'ポン', kan: 'カン', riichi: 'リーチ', ron: 'ロン', tsumo: 'ツモ' };

const WALL = 17; // stacks per side

function skeleton(board) {
  if (board._sk) return board._sk;
  const stacks = (r) => Array.from({ length: WALL }, (_, j) => {
    // Side walls overlap along the screen's vertical axis: paint lower stacks on top.
    const z = r === 1 ? WALL - j : r === 3 ? j + 1 : 1;
    return `<span class="wst n0" style="z-index:${z}"></span>`;
  }).join('');
  board.innerHTML = `<div class="center">
      <div class="round"></div><div class="sticks"></div><div class="wall-left"></div><div class="dora"></div>
    </div>
    ${ROT.map((deg, r) => `<div class="layer r${r}" style="transform:rotate(${deg}deg)">
      <div class="wall">${stacks(r)}</div>
      <div class="pond"><div class="prow"></div><div class="prow"></div><div class="prow"></div></div>
      <div class="ohand"></div>
      <div class="melds ${r === 0 ? 'mine' : ''}"></div>
      <div class="np"><div class="np-in"></div><div class="np-name"></div>${r === 0 ? '<div class="np-status"><span class="furiten-slot"></span><span class="timer"></span></div>' : ''}</div>
    </div>`).join('')}
    <div class="myhand"></div>
    <div class="ask"></div>
    <div class="actions"></div>
    <div class="callouts">${ROT.map((_, r) => `<div class="callout c${r}"></div>`).join('')}</div>`;
  const q = (sel, root = board) => root.querySelector(sel);
  board._sk = {
    round: q('.center .round'),
    sticks: q('.center .sticks'),
    wallLeft: q('.center .wall-left'),
    dora: q('.center .dora'),
    layers: [0, 1, 2, 3].map((r) => {
      const l = q(`.layer.r${r}`);
      return {
        wall: [...l.querySelectorAll('.wst')],
        rows: [...l.querySelectorAll('.prow')],
        ohand: q('.ohand', l),
        melds: q('.melds', l),
        np: q('.np', l),
        npIn: q('.np-in', l),
        name: q('.np-name', l),
        callout: q(`.callouts .c${r}`),
      };
    }),
    hand: q('.myhand'),
    ask: q('.ask'),
    furiten: q('.furiten-slot'),
    actions: q('.actions'),
  };
  return board._sk;
}

// Stack c (0..67) runs clockwise from seat 0's right end; returns its owner
// seat and its index j left-to-right as seen by that owner.
const stackPos = (c) => ({ seat: (4 - Math.floor(c / WALL)) % 4, j: WALL - 1 - (c % WALL) });

function renderWall(sk, v, rel) {
  const w = v.wall;
  if (!w) return;
  const rinshan = new Set();
  for (let r = 0; r < w.pops; r++) rinshan.add(deadSlot(r));
  const dora = new Map();
  for (let i = 0; i < w.doraCount; i++) dora.set(deadSlot(4 + i), v.dora[i]);
  const present = (slot) => !(slot < w.liveTaken || (slot >= 122 - w.pops && slot < 122) || rinshan.has(slot));
  for (let c = 0; c < 4 * WALL; c++) {
    const offset = (c - w.breakStack + 4 * WALL) % (4 * WALL);
    const top = 2 * offset;
    const n = (present(top) ? 1 : 0) + (present(top + 1) ? 1 : 0);
    const { seat, j } = stackPos(c);
    const el = sk.layers[rel(seat)].wall[j];
    const up = present(top) && dora.has(top) ? face(dora.get(top)) : '';
    const cls = `wst n${n}${offset >= 61 ? ' dead' : ''}${up ? ' up' : ''}`;
    if (el.className !== cls) el.className = cls;
    if (el._h !== up) {
      el._h = up;
      el.innerHTML = up;
    }
  }
}

// Flies a tile back from the wall slot that was just drawn to the drawer's hand.
function animateDraw(sk, v, ui, rel) {
  const d = v.wall && v.wall.lastDraw;
  if (!d || d.n === ui.lastDrawN) return;
  const first = ui.lastDrawN === undefined;
  ui.lastDrawN = d.n;
  if (first || v.phase !== 'turn' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { seat, j } = stackPos((v.wall.breakStack + (d.slot >> 1)) % (4 * WALL));
  const from = sk.layers[rel(seat)].wall[j];
  const to = d.seat === v.seat ? sk.hand.lastElementChild : sk.layers[rel(d.seat)].ohand.querySelector('[data-k="drawn"]');
  if (!from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const fly = document.createElement('div');
  fly.className = 'flytile';
  Object.assign(fly.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(fly);
  to.style.visibility = 'hidden';
  const anim = fly.animate([
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${(b.left - a.left) * 0.5}px, ${(b.top - a.top) * 0.5 - 30}px) scale(1.1)`, offset: 0.5 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})` },
  ], { duration: 360, easing: 'ease-in-out' });
  anim.onfinish = () => {
    fly.remove();
    to.style.visibility = '';
  };
}

const EDGE_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // --tx/--ty per seat layer

// Where the latest discard leaves from, measured before the hand is
// re-rendered: the drawn-tile slot for tsumogiri, a tile inside the hand for
// tedashi (opponents' hidden tiles: a deterministic spot among their backs).
function discardSource(sk, v, ui, rel) {
  const ev = [...v.events].reverse().find((e) => e.type === 'discard' || e.type === 'riichi');
  const id = ev ? ev.id : 0;
  const first = ui.lastDiscardEv === undefined;
  if (id === ui.lastDiscardEv) return null;
  ui.lastDiscardEv = id;
  if (first || !ev || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const d = v.players[ev.seat].discards.find((x) => x.tile === ev.tile);
  if (!d || d.called) return null;
  let src;
  if (ev.seat === v.seat) src = sk.hand.querySelector(`[data-id="${ev.tile}"]`);
  else {
    const oh = sk.layers[rel(ev.seat)].ohand;
    const backs = [...oh.querySelectorAll('[data-k^="b"]')];
    src = d.tsumogiri
      ? oh.querySelector('[data-k="drawn"]') || backs[backs.length - 1]
      : backs[ev.tile % Math.max(1, backs.length)];
  }
  return src ? { rect: src.getBoundingClientRect(), seat: ev.seat, tile: ev.tile } : null;
}

// Flies the discarded tile, face up, from its hand position into the pond.
function animateDiscard(sk, info, rel) {
  if (!info) return;
  const r = rel(info.seat);
  const target = sk.layers[r].rows.map((row) => row.querySelector(`[data-tile="${info.tile}"]`)).find(Boolean);
  if (!target) return;
  const a = info.rect;
  const b = target.getBoundingClientRect();
  const w = target.offsetWidth;
  const h = target.offsetHeight;
  const fly = document.createElement('div');
  fly.className = 'pond flydiscard';
  fly.innerHTML = target.outerHTML;
  Object.assign(fly.style, {
    left: `${b.left + b.width / 2 - w / 2}px`,
    top: `${b.top + b.height / 2 - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
  });
  fly.style.setProperty('--tx', EDGE_DIR[r][0]);
  fly.style.setProperty('--ty', EDGE_DIR[r][1]);
  document.body.appendChild(fly);
  target.style.visibility = 'hidden';
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  const s0 = Math.max(a.width, a.height) / Math.max(b.width, b.height);
  const anim = fly.animate([
    { transform: `translate(${dx}px, ${dy}px) rotate(${ROT[r]}deg) scale(${s0})` },
    { transform: `translate(0, 0) rotate(${ROT[r]}deg) scale(1)` },
  ], { duration: 280, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  anim.onfinish = () => {
    fly.remove();
    target.style.visibility = '';
  };
}

// The player's own hand: same nodes for the same tiles, legality only toggles
// classes. Used by the 2D board and by the 3D view's overlay.
export function renderHand(el, v, ui) {
  const o = v.options;
  const items = v.hand.map((id) => ({ key: String(id), html: tile(id, { attrs: `data-id="${id}"` }) }));
  if (v.drawn !== null) {
    items.push({ key: 'gap', html: '<span class="gap"></span>' });
    items.push({ key: String(v.drawn), html: tile(v.drawn, { attrs: `data-id="${v.drawn}"` }) });
  }
  reconcile(el, items);
  const myTurn = o && o.kind === 'turn';
  const legal = new Set(myTurn ? (ui.riichiMode ? o.riichi : o.discard) : []);
  for (const t of el.querySelectorAll('.tile')) {
    const id = Number(t.dataset.id);
    t.classList.toggle('can', legal.has(id));
    t.classList.toggle('no', !!myTurn && !legal.has(id));
    t.classList.toggle('asked', id === v.partnerRequest);
  }
}

export function renderBoard(board, v, ui) {
  const sk = skeleton(board);
  const me = v.seat;
  const rel = (abs) => (abs - me + 4) % 4;
  const discardFrom = discardSource(sk, v, ui, rel);
  const o = v.options;
  const lastDiscard = (() => {
    const ev = [...v.events].reverse().find((e) => e.type === 'discard' || e.type === 'riichi');
    return ev ? ev.tile : null;
  })();

  setHTML(sk.round, `${WIND_KANJI[v.round] || '?'}${v.kyokuNum + 1}局`);
  setHTML(sk.sticks, `<span title="Honba">本 ${v.honba}</span><span title="Depósitos de riichi">供 ${v.kyoutaku}</span>${v.wall ? `<span title="Dados">🎲 ${v.wall.dice.join('+')}</span>` : ''}`);
  setHTML(sk.wallLeft, `残り ${v.wallLeft}`);
  reconcile(sk.dora, [0, 1, 2, 3, 4].map((i) => {
    const id = i < v.dora.length ? v.dora[i] : -1;
    return { key: `${i}:${id}`, html: tile(id) };
  }));
  renderWall(sk, v, rel);

  v.players.forEach((p, abs) => {
    const L = sk.layers[rel(abs)];
    const isTurn = v.turn === abs && v.phase === 'turn';
    pondRows(p.discards).forEach((items, i) => reconcile(L.rows[i], items));
    const backs = rel(abs) === 0 ? [] : Array.from({ length: p.handCount }, (_, i) => ({ key: `b${i}`, html: tile(-1) }));
    if (backs.length && p.hasDrawn) backs.push({ key: 'gap', html: '<span class="gap"></span>' }, { key: 'drawn', html: tile(-1) });
    reconcile(L.ohand, backs);
    reconcile(L.melds, p.melds.map((m, i) => ({ key: `${i}:${m.type}:${m.tiles.join('-')}`, html: meldHTML(m, abs) })));
    L.np.className = `np${isTurn ? ' turn' : ''}${p.online ? '' : ' off'}`;
    setHTML(L.npIn, `<span class="wind ${abs === v.dealer ? 'oya' : ''}">${WIND_KANJI[p.wind]}</span>
      <span class="score">${p.score}</span>${p.riichi ? '<span class="stick"></span>' : ''}`);
    setHTML(L.name, `${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.abandoned ? ' (abandonó)' : p.online ? '' : ' (desconectado)'}`);
    L.callout.dataset.seat = abs;
  });
  board.querySelectorAll('.pond .tile.last').forEach((el) => el.classList.remove('last'));
  if (lastDiscard !== null) board.querySelector(`.pond [data-tile="${lastDiscard}"]`)?.classList.add('last');

  renderHand(sk.hand, v, ui);
  const askedBy = v.partner && v.partnerRequest !== null ? v.players[v.partner.seat].name : null;
  setHTML(sk.ask, askedBy ? `<span>${esc(askedBy)} te pide</span>${tile(v.partnerRequest)}` : '');
  setHTML(sk.furiten, v.furiten ? '<span class="furiten">振聴</span>' : '');
  setHTML(sk.actions, actionsHTML(v, ui));
  animateDiscard(sk, discardFrom, rel);
  animateDraw(sk, v, ui, rel);
}

function btn(label, action, cls = '') {
  return `<button class="act ${cls}" data-action='${esc(JSON.stringify(action))}'>${label}</button>`;
}

export function actionsHTML(v, ui) {
  const o = v.options;
  if (!o) return '';
  if (o.kind === 'turn') {
    if (ui.riichiMode) return `<span class="hint">Elige el descarte de riichi</span>${btn('Cancelar', { ui: 'riichiOff' }, 'pass')}`;
    if (ui.kanSelect) {
      const kans = [...o.ankan.map((t) => ({ type: 'ankan', t })), ...o.kakan.map((t) => ({ type: 'kakan', t }))];
      return kans.map((a) => `<button class="act choice" data-action='${JSON.stringify(a)}'>${tileOfType(a.t)}</button>`).join('') + btn('Cancelar', { ui: 'kanOff' }, 'pass');
    }
    let h = '';
    if (o.tsumo) h += btn('Tsumo', { type: 'tsumo' }, 'win');
    if (o.riichi.length) h += btn('Riichi', { ui: 'riichiOn' }, 'riichi');
    const kanCount = o.ankan.length + o.kakan.length;
    if (kanCount === 1) h += btn('Kan', o.ankan.length ? { type: 'ankan', t: o.ankan[0] } : { type: 'kakan', t: o.kakan[0] });
    else if (kanCount > 1) h += btn('Kan', { ui: 'kanOn' });
    if (o.kyuushu) h += btn('Kyuushu', { type: 'kyuushu' });
    return h;
  }
  // response
  if (ui.chiSelect) {
    return o.chi.map((c) => `<button class="act choice" data-action='${JSON.stringify({ type: 'chi', tiles: c.tiles })}'>${c.tiles.map((x) => tile(x)).join('')}</button>`).join('') + btn('Cancelar', { ui: 'chiOff' }, 'pass');
  }
  if (ui.ponSelect) {
    return o.pon.map((p) => `<button class="act choice" data-action='${JSON.stringify({ type: 'pon', tiles: p })}'>${p.map((x) => tile(x)).join('')}</button>`).join('') + btn('Cancelar', { ui: 'ponOff' }, 'pass');
  }
  let h = '';
  if (o.ron) h += btn('Ron', { type: 'ron' }, 'win');
  if (o.pon) h += o.pon.length === 1 ? btn('Pon', { type: 'pon', tiles: o.pon[0] }) : btn('Pon', { ui: 'ponOn' });
  if (o.minkan) h += btn('Kan', { type: 'minkan' });
  if (o.chi) h += o.chi.length === 1 ? btn('Chi', { type: 'chi', tiles: o.chi[0].tiles }) : btn('Chi', { ui: 'chiOn' });
  h += btn('Pasar', { type: 'pass' }, 'pass');
  return h;
}

export function showCallouts(board, v, ui) {
  for (const e of v.events) {
    if (e.id <= ui.lastEvent) continue;
    const text = CALL_TEXT[e.type];
    if (!text) continue;
    for (const seat of e.seats || [e.seat]) {
      const el = board.querySelector(`.callout[data-seat="${seat}"]`);
      if (!el) continue;
      el.innerHTML = `<span class="t-${e.type}">${text}</span>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
  }
  ui.lastEvent = Math.max(ui.lastEvent, ...v.events.map((e) => e.id));
}

// ---------------------------------------------------------------- modals

const yakuLabel = (k) => {
  const n = YAKU_NAMES[k] || [k, k];
  return `<span class="jp">${n[0]}</span> ${n[1]}`;
};

function deltasHTML(v, r) {
  const rows = v.players.map((p, i) => {
    const d = r.deltas[i];
    const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : '';
    return `<tr><td>${WIND_KANJI[p.wind]}</td><td>${esc(p.name)}</td><td>${r.scores[i]}</td><td class="${cls}">${d > 0 ? '+' : ''}${d || ''}</td></tr>`;
  });
  return `<table class="deltas">${rows.join('')}</table>`;
}

function handRow(hand, winTile, melds, owner) {
  return `<div class="handrow">${hand.map((x) => tile(x)).join('')}${winTile !== undefined ? `<span class="gap"></span>${tile(winTile)}` : ''}<span class="gap"></span>${(melds || []).map((m) => meldHTML(m, owner)).join('')}</div>`;
}

export function resultHTML(v) {
  const r = v.result;
  let h = '';
  if (r.type === 'agari') {
    for (const w of r.wins) {
      const p = v.players[w.seat];
      const how = w.tsumo ? 'Tsumo' : `Ron a ${esc(v.players[w.from].name)}`;
      const yaku = w.yaku.map(([k, han]) => `<li>${yakuLabel(k)}<b>${w.yakuman ? '役満' : `${han} han`}</b></li>`).join('');
      const pts = w.yakuman ? w.label : `${w.han} han ${w.fu} fu ${w.label}`;
      h += `<div class="win">
        <h3>${esc(p.name)} — ${how}</h3>
        ${handRow(w.hand, w.winTile, w.melds, w.seat)}
        <div class="inds"><span class="lbl">Dora</span>${r.dora.map((x) => tile(x)).join('')}${w.ura.length ? `<span class="lbl">Ura</span>${w.ura.map((x) => tile(x)).join('')}` : ''}</div>
        <ul class="yaku">${yaku}</ul>
        <div class="pts">${pts} · ${w.points} pts${w.pao !== null ? ` · Pao: ${esc(v.players[w.pao].name)}` : ''}</div>
      </div>`;
    }
  } else {
    const n = DRAW_NAMES[r.reason] || [r.reason, r.reason];
    h += `<h3>${n[0]} · ${n[1]}</h3>`;
    if (r.reason === 'exhaustive' || r.reason === 'nagashi') {
      h += '<div class="tenpai">';
      v.players.forEach((p, i) => {
        const t = r.tenpai.includes(i);
        h += `<div><b>${esc(p.name)}</b>: ${t ? 'Tenpai' : 'Noten'}${r.nagashi && r.nagashi.includes(i) ? ' · Nagashi Mangan' : ''}${t ? handRow(r.hands[i]) : ''}</div>`;
      });
      h += '</div>';
    }
    if (r.reason === 'kyuushu' && r.hand) h += `<div><b>${esc(v.players[r.seat].name)}</b>${handRow(r.hand)}</div>`;
  }
  h += deltasHTML(v, r);
  const ready = r.ready[v.seat];
  h += `<div class="modal-actions">${ready ? '<span class="hint">Esperando a los demás…</span>' : '<button class="act" data-action=\'{"type":"ok"}\'>OK</button>'}<span class="timer"></span></div>`;
  return h;
}

// Teammate's hand, outside the board: docked in the side margin next to the
// teammate's seat when there is room, else a collapsible strip on top.
export function renderPartner(v, ui) {
  const panel = document.getElementById('partner');
  const p = v.partner;
  if (!p || v.phase === 'end') {
    panel.classList.add('hidden');
    return;
  }
  const board = Math.min(innerWidth, innerHeight - 4);
  // 3D view fills the screen: dock on wide screens over the scenery at the side
  const margin = ui.view3d ? (innerWidth >= 1100 ? 260 : 0) : (innerWidth - board) / 2;
  const docked = margin >= 190;
  const side = (p.seat - v.seat + 4) % 4 === 1 ? 'right' : 'left';
  const open = ui.partnerOpen;
  panel.className = `${docked ? 'docked' : 'floating'} ${side}${open ? ' open' : ''}`;
  const width = docked ? margin - 24 : Math.min(innerWidth - 24, 640);
  const perRow = docked ? 7 : 14;
  const tw = Math.max(18, Math.min(46, Math.floor((width - 20) / (perRow + 0.6)) - 3));
  panel.style.width = `${width}px`;
  panel.style.setProperty('--pt', `${tw}px`);
  const name = v.players[p.seat].name;
  setHTML(document.getElementById('partner-toggle'), `${open ? '▾' : '▸'} Mano de ${esc(name)} <span class="hint">(compañero)</span>`);
  document.getElementById('partner-toggle').setAttribute('aria-expanded', String(open));
  const items = p.hand.map((id) => ({ key: String(id), html: tile(id, { attrs: `data-id="${id}"` }) }));
  if (p.drawn !== null) {
    items.push({ key: 'gap', html: '<span class="gap"></span>' });
    items.push({ key: String(p.drawn), html: tile(p.drawn, { attrs: `data-id="${p.drawn}"` }) });
  }
  const hand = document.getElementById('partner-hand');
  reconcile(hand, items);
  for (const el of hand.querySelectorAll('.tile')) el.classList.toggle('asked', Number(el.dataset.id) === p.myRequest);
}

export function finalHTML(v) {
  const rows = v.final.map((f) => `<tr><td>${f.rank}º</td><td>${esc(f.name)}${f.seat === v.seat ? ' (tú)' : ''}</td><td>${f.score}</td><td class="${f.points >= 0 ? 'pos' : 'neg'}">${f.points > 0 ? '+' : ''}${f.points.toFixed(1)}</td></tr>`).join('');
  let teams = '';
  if (v.players.every((p) => p.team)) {
    const sum = { N: 0, S: 0 };
    for (const f of v.final) sum[v.players[f.seat].team] += f.points;
    const fmt = (x) => `${x > 0 ? '+' : ''}${(Math.round(x * 10) / 10).toFixed(1)}`;
    const myTeam = v.players[v.seat].team;
    const win = sum.N === sum.S ? null : sum.N > sum.S ? 'N' : 'S';
    const label = { N: 'Equipo Norte', S: 'Equipo Sur' };
    teams = `<div class="teamres">${['N', 'S'].map((t) => `<div class="${t === win ? 'won' : ''} ${t === myTeam ? 'mine' : ''}">
        <b>${label[t]}</b><span>${v.players.filter((p) => p.team === t).map((p) => esc(p.name)).join(' · ')}</span>
        <span class="${sum[t] >= 0 ? 'pos' : 'neg'}">${fmt(sum[t])}</span></div>`).join('')}</div>
      <p class="pts">${win ? `¡Gana el ${label[win]}!${win === myTeam ? ' 🎉' : ''}` : 'Empate entre equipos'}</p>`;
  }
  return `<h2>Fin de la partida</h2>
    ${teams}
    <table class="deltas final"><tr><th></th><th>Jugador</th><th>Puntos</th><th>Resultado</th></tr>${rows}</table>
    <div class="modal-actions"><button class="act" data-ui="lobby">Volver al lobby</button></div>`;
}
