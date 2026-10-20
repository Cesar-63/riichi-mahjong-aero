// DOM rendering of the table from a server view.
import {
  tileType, isAka, suitOf, numOf, imageName, HONOR_KANJI, SUIT_KANJI, WIND_KANJI,
  YAKU_NAMES, DRAW_NAMES,
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
  const names = new Set(['Back', ...(tileset.layered ? ['Front'] : [])]);
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
    if (tileset.mode === 'img') return `<span class="tf back"><img src="${tileset.dir}Back.${tileset.ext}" alt="" decoding="sync"></span>`;
    return '<span class="tf back"></span>';
  }
  const t = tileType(id);
  if (tileset.mode === 'img') {
    const src = `${tileset.dir}${imageName(id)}.${tileset.ext}`;
    const bg = tileset.layered ? `<img src="${tileset.dir}Front.${tileset.ext}" alt="" decoding="sync">` : '';
    return `<span class="tf img">${bg}<img src="${src}" alt="${imageName(id)}" decoding="sync"></span>`;
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

function skeleton(board) {
  if (board._sk) return board._sk;
  board.innerHTML = `<div class="center">
      <div class="round"></div><div class="sticks"></div><div class="wall"></div><div class="dora"></div>
    </div>
    ${ROT.map((deg, r) => `<div class="layer r${r}" style="transform:rotate(${deg}deg)">
      <div class="pond"><div class="prow"></div><div class="prow"></div><div class="prow"></div></div>
      <div class="ohand"></div>
      <div class="melds ${r === 0 ? 'mine' : ''}"></div>
      <div class="np"><div class="np-in"></div></div>
      <div class="name"></div>
      <div class="callout"></div>
    </div>`).join('')}
    <div class="myhand"></div>
    <div class="status"><span class="furiten-slot"></span><span class="timer"></span></div>
    <div class="actions"></div>`;
  const q = (sel, root = board) => root.querySelector(sel);
  board._sk = {
    round: q('.center .round'),
    sticks: q('.center .sticks'),
    wall: q('.center .wall'),
    dora: q('.center .dora'),
    layers: [0, 1, 2, 3].map((r) => {
      const l = q(`.layer.r${r}`);
      return {
        rows: [...l.querySelectorAll('.prow')],
        ohand: q('.ohand', l),
        melds: q('.melds', l),
        np: q('.np', l),
        npIn: q('.np-in', l),
        name: q('.name', l),
        callout: q('.callout', l),
      };
    }),
    hand: q('.myhand'),
    furiten: q('.furiten-slot'),
    actions: q('.actions'),
  };
  return board._sk;
}

export function renderBoard(board, v, ui) {
  const sk = skeleton(board);
  const me = v.seat;
  const rel = (abs) => (abs - me + 4) % 4;
  const o = v.options;
  const lastDiscard = (() => {
    const ev = [...v.events].reverse().find((e) => e.type === 'discard' || e.type === 'riichi');
    return ev ? ev.tile : null;
  })();

  setHTML(sk.round, `${WIND_KANJI[v.round] || '?'}${v.kyokuNum + 1}局`);
  setHTML(sk.sticks, `<span title="Honba">本 ${v.honba}</span><span title="Depósitos de riichi">供 ${v.kyoutaku}</span>`);
  setHTML(sk.wall, `残り ${v.wallLeft}`);
  reconcile(sk.dora, [0, 1, 2, 3, 4].map((i) => {
    const id = i < v.dora.length ? v.dora[i] : -1;
    return { key: `${i}:${id}`, html: tile(id) };
  }));

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
    setHTML(L.name, `<span>${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.abandoned ? ' (abandonó)' : p.online ? '' : ' (desconectado)'}</span>`);
    L.callout.dataset.seat = abs;
  });
  board.querySelectorAll('.pond .tile.last').forEach((el) => el.classList.remove('last'));
  if (lastDiscard !== null) board.querySelector(`.pond [data-tile="${lastDiscard}"]`)?.classList.add('last');

  // own hand: same nodes for the same tiles, legality only toggles classes
  const items = v.hand.map((id) => ({ key: String(id), html: tile(id, { attrs: `data-id="${id}"` }) }));
  if (v.drawn !== null) {
    items.push({ key: 'gap', html: '<span class="gap"></span>' });
    items.push({ key: String(v.drawn), html: tile(v.drawn, { attrs: `data-id="${v.drawn}"` }) });
  }
  reconcile(sk.hand, items);
  const myTurn = o && o.kind === 'turn';
  const legal = new Set(myTurn ? (ui.riichiMode ? o.riichi : o.discard) : []);
  for (const el of sk.hand.querySelectorAll('.tile')) {
    const id = Number(el.dataset.id);
    el.classList.toggle('can', legal.has(id));
    el.classList.toggle('no', !!myTurn && !legal.has(id));
  }
  setHTML(sk.furiten, v.furiten ? '<span class="furiten">振聴 Furiten</span>' : '');
  setHTML(sk.actions, actionsHTML(v, ui));
}

function btn(label, action, cls = '') {
  return `<button class="act ${cls}" data-action='${esc(JSON.stringify(action))}'>${label}</button>`;
}

function actionsHTML(v, ui) {
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
      el.innerHTML = `<span>${text}</span>`;
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
        <div class="inds"><span>Dora</span>${r.dora.map((x) => tile(x)).join('')}${w.ura.length ? `<span>Ura</span>${w.ura.map((x) => tile(x)).join('')}` : ''}</div>
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

export function finalHTML(v) {
  const rows = v.final.map((f) => `<tr><td>${f.rank}º</td><td>${esc(f.name)}${f.seat === v.seat ? ' (tú)' : ''}</td><td>${f.score}</td><td class="${f.points >= 0 ? 'pos' : 'neg'}">${f.points > 0 ? '+' : ''}${f.points.toFixed(1)}</td></tr>`).join('');
  return `<h2>Fin de la partida</h2>
    <table class="deltas final"><tr><th></th><th>Jugador</th><th>Puntos</th><th>Resultado</th></tr>${rows}</table>
    <div class="modal-actions"><button class="act" data-ui="lobby">Volver al lobby</button></div>`;
}
