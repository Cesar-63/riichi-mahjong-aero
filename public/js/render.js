// DOM pieces around the 3D table: tile images, call buttons, callouts,
// the result and final screens and the teammate's hand.
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
    // Layered sets draw the tile body in CSS; flat sets are full tile images.
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

const CALL_TEXT = { chi: 'チー', pon: 'ポン', kan: 'カン', riichi: 'リーチ', ron: 'ロン', tsumo: 'ツモ' };

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

export function showCallouts(root, v, ui) {
  for (const e of v.events) {
    if (e.id <= ui.lastEvent) continue;
    const text = CALL_TEXT[e.type];
    if (!text) continue;
    for (const seat of e.seats || [e.seat]) {
      const el = root.querySelector(`.callout[data-seat="${seat}"]`);
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

// Teammate's hand: docked at the side of the screen next to the teammate's
// seat on wide screens, else a collapsible strip on top.
export function renderPartner(v, ui) {
  const panel = document.getElementById('partner');
  const p = v.partner;
  if (!p || v.phase === 'end') {
    panel.classList.add('hidden');
    return;
  }
  const margin = innerWidth >= 1100 ? 260 : 0;
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
