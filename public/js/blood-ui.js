// Blood duel on screen (see shared/blood.js and engine/game.js): the
// option in the menu and the waiting room, the cc each duelist has lost,
// the coin, what the result and final sheets say, and the effects that
// grow as the player bleeds (the hallucinations on the tiles are in
// three3d/hallucinate.js).
import { BLOOD_LIMIT, COIN_FROM, bloodStage } from './shared/blood.js';

// the options (server/handler.js BLOOD_MODES): name and what it means
export const BLOOD_OPTIONS = {
  none: ['Sin sangre', ''],
  washizu: ['Washizu original', '1000 puntos = 10 cc'],
  akagi: ['Apuesta de Akagi', '1000 puntos = 100 cc'],
};
export const bloodLabel = (b) => `${BLOOD_OPTIONS[b][0]}${BLOOD_OPTIONS[b][1] ? ` · ${BLOOD_OPTIONS[b][1]}` : ''}`;
export const bloodButtons = (current) => Object.entries(BLOOD_OPTIONS).map(([id, [name, note]]) =>
  `<button type="button" class="chalk-opt" data-blood="${id}" aria-pressed="${id === current}">${name}${note ? ` <small>${note}</small>` : ''}</button>`).join('');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cc = (n) => `${n.toLocaleString('es')} cc`;

const isDuelist = (v, abs) => !!v.blood && v.blood.duelists.includes(abs);
const isDead = (v, abs) => !!v.blood && v.blood.dead.includes(abs);
// by teams there are two duelists; on their own, all four
const byPairs = (v) => !!v.blood && v.blood.duelists.length === 2;
export const myLost = (v) => (v && v.blood && isDuelist(v, v.seat) ? v.blood.lost[v.seat] : null);

// On a rival's plaque: the blood they lost, from 500 cc (and by teams,
// which one is the duelist: the support has no tag, the plaque is short).
export function bloodTag(v, abs) {
  if (!v.blood || !isDuelist(v, abs)) return '';
  if (isDead(v, abs)) return '<i class="tag blood dead">desangrado</i>';
  const lost = v.blood.lost[abs];
  const role = byPairs(v) ? '<i class="tag blood-role duel">duelista</i>' : '';
  return `${role}${lost >= 500 ? `<i class="tag blood s${bloodStage(lost)}" title="Sangre perdida">${cc(lost)}</i>` : ''}`;
}

// A bag of blood that empties: on the paper chit with my own blood
function bagHTML(lost) {
  const left = Math.max(0, 1 - lost / BLOOD_LIMIT);
  return `<i class="blood-bag s${bloodStage(lost)}" aria-hidden="true"><i style="--left:${left.toFixed(3)}"></i></i>`;
}

// On the paper chit: my own blood, always (or that I am the support)
export function roundBloodHTML(v) {
  if (!v.blood) return '';
  const mode = BLOOD_OPTIONS[v.blood.mode] ? BLOOD_OPTIONS[v.blood.mode][0] : '';
  if (!isDuelist(v, v.seat)) {
    const mine = v.blood.duelists.find((x) => v.players[x].team === v.players[v.seat].team);
    return `<span class="blood-line">${mode} · eres el apoyo de <b>${esc(v.players[mine] ? v.players[mine].name : '')}</b></span>`;
  }
  const lost = v.blood.lost[v.seat];
  return `<span class="blood-line">${bagHTML(lost)} Sangre: <b>${cc(lost)}</b> de ${cc(BLOOD_LIMIT)}${lost >= COIN_FROM ? ' · <em>zona de la moneda</em>' : ''}</span>`;
}

// The result sheet: each duelist's blood and what comes next (coin, death)
export function resultBloodHTML(v) {
  const b = v.result && v.result.blood;
  if (!b || !v.blood) return '';
  const rows = v.blood.duelists.map((x) => {
    const p = v.players[x];
    const fate = b.dead.includes(x) ? '<em class="dead">se desangró</em>'
      : b.coins.includes(x) ? '<em class="coin">tira la moneda</em>' : '';
    return `<li class="${x === v.seat ? 'me' : ''}">${bagHTML(b.lost[x])}<span>${esc(p.name)}</span><b>${cc(b.lost[x])}</b>${fate}</li>`;
  }).join('');
  return `<ul class="r-blood" aria-label="Sangre perdida">${rows}</ul>`;
}

// The final sheet: a column with each one's blood
export function finalBloodCell(f) {
  if (f.blood === undefined) return null;
  if (f.blood === null) return '<span class="num blood-cell support">apoyo</span>';
  return `<span class="num blood-cell${f.blood.dead ? ' dead' : ''}">${f.blood.dead ? '† ' : ''}${cc(f.blood.lost)}</span>`;
}

// Heads or tails. The seat that must call sees the two buttons; the rest
// wait for it.
export function coinHTML(v) {
  if (!v.blood || !v.blood.coin) return '';
  const { seats, tosses } = v.blood.coin;
  const mine = v.options && v.options.kind === 'coin';
  const who = seats.map((x) => {
    const t = tosses[x];
    const state = t ? (t.ok ? `<em class="ok">${t.face}: sigue</em>` : `<em class="dead">${t.face}: se desangró</em>`) : '<em>eligiendo…</em>';
    return `<li><span>${esc(v.players[x].name)}${x === v.seat ? ' <small>(tú)</small>' : ''}</span><b>${cc(v.blood.lost[x])}</b>${state}</li>`;
  }).join('');
  const call = mine
    ? `<p class="coin-ask">Perdiste <b>${cc(v.blood.lost[v.seat])}</b>. Elige y la moneda decide si sigues jugando.</p>
      <div class="coin-calls">
        <button class="paper act coin-call" type="button" data-action='{"type":"coin","call":"cara"}'><span class="coin-face cara" aria-hidden="true">顔</span><span class="es">Cara</span></button>
        <button class="paper act coin-call" type="button" data-action='{"type":"coin","call":"sello"}'><span class="coin-face sello" aria-hidden="true">印</span><span class="es">Sello</span></button>
      </div><span class="timer"></span>`
    : '<p class="coin-ask">Al borde: la moneda decide.</p>';
  return `<div class="coin-sheet crumpled">
      <h2>Cara o sello <span class="jp">表か裏か</span></h2>
      <ul class="coin-who">${who}</ul>
      ${call}
    </div>`;
}

// ---------------------------------------------------------------- effects

// Each toss is seen as a coin spinning in the air and landing (also when
// the game has already moved on to the next hand).
export function showCoinTosses(v, ui) {
  if (!v.blood) return;
  const seen = ui.coinSeen ?? null;
  const tosses = v.events.filter((e) => e.type === 'coin');
  if (seen === null) {
    // entering a game: the tosses already seen are not played again
    ui.coinSeen = Math.max(0, ...v.events.map((e) => e.id));
    return;
  }
  for (const e of tosses) {
    if (e.id <= seen) continue;
    playToss(v, e);
  }
  ui.coinSeen = Math.max(seen, ...tosses.map((e) => e.id));
}

const queue = [];
function playToss(v, e) {
  queue.push({ name: v.players[e.seat].name, me: e.seat === v.seat, ...e });
  if (queue.length === 1) nextToss();
}
function nextToss() {
  const t = queue[0];
  if (!t) return;
  let el = document.getElementById('coin-fx');
  if (!el) {
    el = document.createElement('div');
    el.id = 'coin-fx';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  const verdict = t.ok ? (t.me ? '¡Sigues vivo!' : `${esc(t.name)} sigue`) : (t.me ? 'Te desangraste' : `${esc(t.name)} se desangró`);
  el.className = `show ${t.face} ${t.ok ? 'ok' : 'dead'}`;
  el.innerHTML = `<div class="coin" aria-hidden="true"><span class="side cara">顔</span><span class="side sello">印</span></div>
    <p><small>${t.me ? 'Elegiste' : `${esc(t.name)} eligió`} ${t.call}</small><b>${t.face === 'cara' ? 'Cara' : 'Sello'}</b><span>${verdict}</span></p>`;
  setTimeout(() => {
    el.className = '';
    queue.shift();
    setTimeout(nextToss, 250);
  }, 3400);
}

// The screen as the blood goes: pale from 500 cc, hallucinations from 1000
// (the 3D table), heartbeat, tunnel and double vision from 1500. When I
// die, red and then black before the result. Off with the setting or with
// reduced motion (the paleness stays, it does not move).
// root: what turns pale (the game screen; the lab's stage).
export function applyBloodScreen(v, ui, { effects = true, root = document.getElementById('game') } = {}) {
  const game = root;
  game.classList.add('blood-root');
  const lost = myLost(v);
  const dead = v && isDead(v, v.seat);
  const stage = lost === null ? 0 : dead ? 3 : bloodStage(lost);
  for (let s = 1; s <= 3; s++) game.classList.toggle(`blood-${s}`, stage >= s && effects);
  game.classList.toggle('blood-fx-on', !!effects);
  if (dead && !ui.deathShown) {
    ui.deathShown = true;
    let el = document.getElementById('blood-death');
    if (!el) {
      el = document.createElement('div');
      el.id = 'blood-death';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    el.className = '';
    void el.offsetWidth;
    el.className = 'show';
    setTimeout(() => { el.className = ''; }, 4200);
  }
  return stage;
}
