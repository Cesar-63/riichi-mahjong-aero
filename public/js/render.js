// DOM pieces around the 3D table: tile images, call buttons, callouts,
// the result and final screens and the teammate's hand.
import {
  tileType, isAka, suitOf, numOf, imageName, HONOR_KANJI, SUIT_KANJI,
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

export function tile(id, { cls = '', attrs = '' } = {}) {
  return `<span class="tile ${cls}" ${attrs}>${face(id)}</span>`;
}

export function tileOfType(t) {
  return tile(t * 4 + 1);
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

// Calls as they are shouted across the table: Spanish first, the Japanese
// call under it.
const CALL_TEXT = {
  chi: ['¡Chi!', 'チー'], pon: ['¡Pon!', 'ポン'], kan: ['¡Kan!', 'カン'],
  riichi: ['¡Riichi!', 'リーチ'], ron: ['¡Ron!', 'ロン'], tsumo: ['¡Tsumo!', 'ツモ'],
};

// Paper button: the label, with the Japanese term small underneath.
function btn(label, jp, action, cls = '') {
  const seal = cls.includes('win') ? '<span class="stamp" aria-hidden="true">和</span>' : '';
  return `<button class="paper act ${cls}" type="button" data-action='${esc(JSON.stringify(action))}'><span class="es">${label}</span><span class="jp">${jp}</span>${seal}</button>`;
}
const choice = (action, tiles) => `<button class="paper act choice" type="button" data-action='${esc(JSON.stringify(action))}'>${tiles}</button>`;

export function actionsHTML(v, ui) {
  const o = v.options;
  if (!o) return '';
  if (o.kind === 'turn') {
    if (ui.riichiMode) return `<span class="hint">Elige el descarte de riichi</span>${btn('Cancelar', '取消', { ui: 'riichiOff' }, 'pass')}`;
    if (ui.kanSelect) {
      const kans = [...o.ankan.map((t) => ({ type: 'ankan', t })), ...o.kakan.map((t) => ({ type: 'kakan', t }))];
      return kans.map((a) => choice(a, tileOfType(a.t))).join('') + btn('Cancelar', '取消', { ui: 'kanOff' }, 'pass');
    }
    let h = '';
    if (o.tsumo) h += btn('Tsumo', 'ツモ', { type: 'tsumo' }, 'win');
    if (o.riichi.length) h += btn('Riichi', 'リーチ', { ui: 'riichiOn' }, 'riichi');
    const kanCount = o.ankan.length + o.kakan.length;
    if (kanCount === 1) h += btn('Kan', 'カン', o.ankan.length ? { type: 'ankan', t: o.ankan[0] } : { type: 'kakan', t: o.kakan[0] });
    else if (kanCount > 1) h += btn('Kan', 'カン', { ui: 'kanOn' });
    if (o.kyuushu) h += btn('Nueve terminales', '九種九牌', { type: 'kyuushu' });
    return h;
  }
  // response
  if (ui.chiSelect) {
    return o.chi.map((c) => choice({ type: 'chi', tiles: c.tiles }, c.tiles.map((x) => tile(x)).join(''))).join('') + btn('Cancelar', '取消', { ui: 'chiOff' }, 'pass');
  }
  if (ui.ponSelect) {
    return o.pon.map((p) => choice({ type: 'pon', tiles: p }, p.map((x) => tile(x)).join(''))).join('') + btn('Cancelar', '取消', { ui: 'ponOff' }, 'pass');
  }
  let h = '';
  if (o.pon) h += o.pon.length === 1 ? btn('Pon', 'ポン', { type: 'pon', tiles: o.pon[0] }) : btn('Pon', 'ポン', { ui: 'ponOn' });
  if (o.chi) h += o.chi.length === 1 ? btn('Chi', 'チー', { type: 'chi', tiles: o.chi[0].tiles }) : btn('Chi', 'チー', { ui: 'chiOn' });
  if (o.minkan) h += btn('Kan', 'カン', { type: 'minkan' });
  if (o.ron) h += btn('Ron', 'ロン', { type: 'ron' }, 'win');
  h += btn('Pasar', '見送り', { type: 'pass' }, 'pass');
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
      el.innerHTML = `<span class="t-${e.type}"><b>${text[0]}</b><i>${text[1]}</i></span>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
  }
  ui.lastEvent = Math.max(ui.lastEvent, ...v.events.map((e) => e.id));
}

// ---------------------------------------------------------------- result

const WIND_ES = ['Este', 'Sur', 'Oeste', 'Norte'];
// limit hands get a big stamp with their kanji faint behind it
const LIMITS = {
  Mangan: '満貫', Haneman: '跳満', Baiman: '倍満', Sanbaiman: '三倍満',
  'Kazoe Yakuman': '数え役満', Yakuman: '役満', '2x Yakuman': '二倍役満',
};
const limitName = (label) => (label === '2x Yakuman' ? 'Doble Yakuman' : label);
// yaku whose name says nothing in Spanish get a short note instead of kanji
const YAKU_NOTE = {
  pinfu: 'mano sin puntos extra', tanyao: 'solo del 2 al 8', tsumo: 'robada con la mano cerrada',
  haku: 'trío de dragón blanco', hatsu: 'trío de dragón verde', chun: 'trío de dragón rojo',
  aka: 'cincos rojos',
};

// The four seats in wind order on wooden plaques, with what each one got.
function plaquesHTML(v, r, winners) {
  const order = [0, 1, 2, 3].sort((a, b) => v.players[a].wind - v.players[b].wind);
  return order.map((i) => {
    const p = v.players[i];
    const d = r.deltas[i];
    const delta = d ? ` <b class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</b>` : '';
    return `<div class="plaque${winners.includes(i) ? ' won' : ''}${i === v.seat ? ' me' : ''}"><span class="name">${WIND_ES[p.wind]} · ${esc(p.name)}</span><span class="score">${r.scores[i]}${delta}</span></div>`;
  }).join('');
}

function acceptHTML(v, r) {
  if (r.ready[v.seat]) return '<div class="accept waiting">Esperando a los demás…<span class="timer"></span></div>';
  return '<button class="paper act accept" type="button" data-action=\'{"type":"ok"}\'><span class="es">Aceptar</span><span class="jp"><span class="timer"></span> · 確認</span></button>';
}

function stampHTML(name, kanji, cls = '') {
  return `<div class="stamp-big ${cls}"><span class="bgk" aria-hidden="true">${kanji}</span><span class="name">${name}</span></div>`;
}

// Score sheet over the top of the screen; the 3D camera frames the winning
// hand and its dora underneath (see table3d.js).
export function resultHTML(v) {
  const r = v.result;
  const round = `${WIND_ES[v.round]} ${v.kyokuNum + 1}${v.honba ? ` · Honba ${v.honba}` : ''}`;
  let body = '';
  let winners = [];
  if (r.type === 'agari') {
    const [w, ...more] = r.wins;
    winners = r.wins.map((x) => x.seat);
    const p = v.players[w.seat];
    const how = w.tsumo ? 'Tsumo' : 'Ron';
    const extra = [w.tsumo ? 'pagan todos' : `Ron a ${esc(v.players[w.from].name)}`];
    if (v.honba) extra.push(`incluye ${v.honba} honba`);
    if (w.pao !== null) extra.push(`pao: paga ${esc(v.players[w.pao].name)}`);
    // (ura dora is listed even when it adds nothing)
    const shown = w.yaku.filter(([, han]) => han || w.yakuman);
    const yaku = shown.map(([k, han]) => {
      const n = YAKU_NAMES[k] || [k, k];
      const note = YAKU_NOTE[k] ? `<small class="note">${YAKU_NOTE[k]}</small>` : `<small class="jp">${n[0]}</small>`;
      const count = w.yakuman ? '' : ` <em>${han}</em>`;
      return `<li>${n[1]}${count} ${note}</li>`;
    }).join('');
    const label = LIMITS[w.label] ? stampHTML(limitName(w.label), LIMITS[w.label], w.yakuman || w.label === 'Kazoe Yakuman' ? 'yakuman' : '') : '';
    body = `<div class="r-head">
        <div class="r-round">${round} · gana ${esc(p.name)} (${WIND_ES[p.wind]})</div>
        <div class="r-hanfu">${w.yakuman ? '' : `<span>${w.han} han</span><span>${w.fu} fu</span>`}<span>${how}</span></div>
        <div class="r-points">${w.points}</div>
        <div class="r-sub">${extra.join(' · ')}</div>
        ${more.map((m) => `<div class="r-sub also">También gana ${esc(v.players[m.seat].name)}: ${m.points}${m.label ? ` · ${limitName(m.label)}` : ''}</div>`).join('')}
      </div>
      ${label ? `<div class="streak" aria-hidden="true"></div>${label}` : ''}
      <ul class="r-yaku${shown.length > 4 ? ' many' : ''}">${yaku}</ul>`;
  } else {
    const n = DRAW_NAMES[r.reason] || [r.reason, r.reason];
    const name = { exhaustive: 'Empate', nagashi: 'Nagashi Mangan', kyuushu: 'Nueve terminales', suufon: 'Cuatro vientos', suucha: 'Cuatro riichi', suukaikan: 'Cuatro kanes', sanchahou: 'Triple ron' }[r.reason] || n[1];
    const why = {
      exhaustive: 'Se acabó la pared', nagashi: 'Descartes solo de terminales y honores',
      kyuushu: `${r.seat !== undefined ? esc(v.players[r.seat].name) : 'Un jugador'} anuló la mano`,
      suufon: 'Los cuatro descartaron el mismo viento', suucha: 'Los cuatro declararon riichi',
      suukaikan: 'Cuatro kanes de jugadores distintos', sanchahou: 'Tres jugadores hicieron ron',
    }[r.reason] || '';
    winners = r.nagashi || [];
    let list = '';
    if (r.reason === 'exhaustive' || r.reason === 'nagashi') {
      list = `<ul class="r-yaku">${v.players.map((pl, i) => {
        const t = r.tenpai.includes(i);
        return `<li>${esc(pl.name)} <em>${t ? 'Tenpai' : 'Noten'}</em> <small class="jp">${t ? '聴牌' : '不聴'}</small>${r.nagashi && r.nagashi.includes(i) ? ' <small class="note">nagashi mangan</small>' : ''}</li>`;
      }).join('')}</ul>`;
    }
    if (r.reason === 'kyuushu' && r.hand) list = `<div class="r-hand">${r.hand.map((x) => tile(x)).join('')}</div>`;
    body = `<div class="r-head">
        <div class="r-round">${round} · sin ganador</div>
        <div class="r-hanfu"><span>${why}</span></div>
      </div>
      <div class="streak" aria-hidden="true"></div>${stampHTML(name, n[0], 'draw')}
      ${list}`;
  }
  return `<div class="r-sheet">
      <div class="r-glow" aria-hidden="true"></div>
      ${body}
    </div>
    <div class="r-bottom">${plaquesHTML(v, r, winners)}${acceptHTML(v, r)}</div>`;
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
  setHTML(document.getElementById('partner-toggle'), `${open ? '▾' : '▸'} Mano de ${esc(name)} <span class="hint">compañero · 相方</span>`);
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

// Paper score sheet at the end of the game.
export function finalHTML(v, room) {
  const fmt = (x) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 10) / 10).toFixed(1)}`;
  const rows = v.final.map((f) => `<span class="rank">${f.rank}.º</span>
      <span class="who">${esc(f.name)}${f.seat === v.seat ? ' <small>(tú)</small>' : ''}</span>
      <span class="num">${f.score}</span>
      <span class="num ${f.points >= 0 ? 'pos' : 'neg'}">${fmt(f.points)}</span>`).join('');
  let teams = '';
  if (v.players.every((p) => p.team)) {
    const sum = { N: 0, S: 0 };
    for (const f of v.final) sum[v.players[f.seat].team] += f.points;
    const myTeam = v.players[v.seat].team;
    const win = sum.N === sum.S ? null : sum.N > sum.S ? 'N' : 'S';
    const label = { N: 'Equipo Norte', S: 'Equipo Sur' };
    teams = `<div class="teamres">${['N', 'S'].map((t) => `<div class="${t === win ? 'won' : ''} ${t === myTeam ? 'mine' : ''}">
        <b>${label[t]}${t === myTeam ? ' <small>(tu equipo)</small>' : ''}</b><span class="names">${v.players.filter((p) => p.team === t).map((p) => esc(p.name)).join(' · ')}</span>
        <span class="num ${sum[t] >= 0 ? 'pos' : 'neg'}">${fmt(sum[t])}</span></div>`).join('')}</div>
      <p class="team-verdict">${win ? `¡Gana el ${label[win]}!` : 'Empate entre equipos'}</p>`;
  }
  const where = room && !room.startsWith('bots-') ? ` · sala «${esc(room)}»` : ' · práctica';
  return `<div class="f-sheet">
      <span class="stamp-win" aria-hidden="true">Gana<i>勝</i></span>
      <div class="f-head"><span class="f-title">Resultados <span class="jp">成績表</span></span><span class="f-where">Fin de la partida · al Este${where}</span></div>
      ${teams}
      <div class="f-grid">
        <span class="th">Puesto</span><span class="th">Jugador</span><span class="th num">Puntos</span><span class="th num">Resultado</span>
        ${rows}
      </div>
      <p class="f-note">Uma +20/+10/−10/−20 · oka +20 al primero · retorno 30.000 · resultado en miles</p>
    </div>
    <div class="f-actions"><button class="paper" type="button" data-ui="lobby"><span class="es">Volver al lobby</span><span class="jp">退出</span></button></div>`;
}
