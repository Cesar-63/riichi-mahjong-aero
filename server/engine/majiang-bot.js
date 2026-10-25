// Bot brain: kobalab's majiang-ai, the AI of the web game 電脳麻将 (MIT,
// https://github.com/kobalab/majiang-ai). It plays from its own model of the
// table, which a fresh player rebuilds on every decision by replaying the
// kyoku's mjai log from the bot's seat, so nothing is kept between calls.
import Player from '@kobalab/majiang-ai';
import Majiang from '@kobalab/majiang-core';
import { mjaiView, mjaiType } from './mjai.js';
import { evaluate, ronValue, tsumoValues } from './score.js';
import { tileType, isAka } from '../../public/js/shared/tiles.js';

// mjai name -> majiang tile: m1..m9 (m0 = red five), p.., s.., z1..z7 (E S W N P F C).
function pai(name) {
  if (name === '?') return '';
  const t = mjaiType(name);
  if (t >= 27) return `z${t - 26}`;
  return 'mps'[Math.floor(t / 9)] + (name.endsWith('r') ? 0 : (t % 9) + 1);
}

// majiang tile ("m0", "p3_*"...) -> { t, red }
function parsePai(p) {
  const n = Number(p[1]);
  if (p[0] === 'z') return { t: 26 + n, red: false };
  return { t: 'mps'.indexOf(p[0]) * 9 + (n || 5) - 1, red: n === 0 };
}

function rule(cfg) {
  return Majiang.rule({
    配給原点: cfg.startScore,
    場数: cfg.rounds,
    ダブル役満あり: false,
    リーチ後暗槓許可レベル: 1, // only if the hand's readings stay the same
  });
}

// The seat's view of the kyoku as majiang-core messages. Seats there count
// from the dealer (l = 0 is East); melds mark the tile taken with + = -
// (from the next player, the one opposite, the previous one).
function messages(log, seat) {
  const out = [];
  let oya = 0;
  let afterKan = false;
  const reaching = new Set();
  const pons = new Map();
  const rel = (x) => (x - oya + 4) % 4;
  const dir = (actor, target) => ['', '+', '=', '-'][(target - actor + 4) % 4];
  const key = (actor, p) => `${actor}${p[0]}${Number(p[1]) || 5}`;
  for (const e of mjaiView(log, seat)) {
    switch (e.type) {
      case 'start_kyoku': {
        oya = e.oya;
        const byWind = [0, 1, 2, 3].map((l) => (l + oya) % 4);
        out.push({
          qipai: {
            zhuangfeng: 'ESWN'.indexOf(e.bakaze),
            jushu: e.kyoku - 1,
            changbang: e.honba,
            lizhibang: e.kyotaku,
            defen: byWind.map((x) => e.scores[x]),
            baopai: pai(e.dora_marker),
            shoupai: byWind.map((x) => (x === seat ? e.tehais[x].map(pai).join('') : '')),
          },
        });
        break;
      }
      case 'tsumo':
        out.push({ [afterKan ? 'gangzimo' : 'zimo']: { l: rel(e.actor), p: pai(e.pai) } });
        afterKan = false;
        break;
      case 'reach':
        reaching.add(e.actor);
        break;
      case 'dahai': {
        const marks = (e.tsumogiri ? '_' : '') + (reaching.delete(e.actor) ? '*' : '');
        out.push({ dapai: { l: rel(e.actor), p: pai(e.pai) + marks } });
        break;
      }
      case 'chi': case 'pon': case 'daiminkan': {
        const p = pai(e.pai);
        const digits = e.consumed.map((x) => pai(x)[1]).join('');
        const m = Majiang.Shoupai.valid_mianzi(p[0] + digits + p[1] + dir(e.actor, e.target));
        if (e.type === 'pon') pons.set(key(e.actor, p), m);
        out.push({ fulou: { l: rel(e.actor), m } });
        afterKan = e.type === 'daiminkan';
        break;
      }
      case 'kakan': {
        const p = pai(e.pai);
        out.push({ gang: { l: rel(e.actor), m: pons.get(key(e.actor, p)) + p[1] } });
        afterKan = true;
        break;
      }
      case 'ankan': {
        const ps = e.consumed.map(pai);
        out.push({ gang: { l: rel(e.actor), m: Majiang.Shoupai.valid_mianzi(ps[0][0] + ps.map((x) => x[1]).join('')) } });
        afterKan = true;
        break;
      }
      case 'dora':
        out.push({ kaigang: { baopai: pai(e.dora_marker) } });
        break;
      default:
    }
  }
  return out;
}

// True when winning now would end the game with this seat still last
// (アガラス). The engine's end rules, without pao, and no ura dora (hidden).
function winsIntoLast(game, seat, from) {
  const s = game.s;
  const k = s.k;
  const tsumo = from === null;
  const tile = tsumo ? k.drawn : k.pending.tile;
  const res = evaluate({ ...game.buildCtx(seat, tile, tsumo, !tsumo && k.pending.kind !== 'discard'), ura: [] });
  if (!res) return false;
  const dealer = game.dealer();
  const scores = s.players.map((p) => p.score);
  if (tsumo) {
    const tv = tsumoValues(res.base, seat === dealer);
    for (let x = 0; x < 4; x++) {
      if (x === seat) continue;
      const pay = (x === dealer ? tv.dealer : tv.other) + s.honba * 100;
      scores[x] -= pay;
      scores[seat] += pay;
    }
  } else {
    const pay = ronValue(res.base, seat === dealer) + s.honba * 300;
    scores[from] -= pay;
    scores[seat] += pay;
  }
  scores[seat] += s.kyoutaku * 1000;
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || a - b);
  if (order[3] !== seat) return false;
  const top = Math.max(...scores);
  const cfg = s.config;
  if (scores.some((x) => x < 0)) return true;
  if (s.round >= cfg.rounds) return top >= cfg.targetScore || (s.kyokuNum === 3 && seat !== dealer);
  if (s.round === cfg.rounds - 1 && s.kyokuNum === 3) {
    return top >= cfg.targetScore && (seat !== dealer || order[0] === dealer);
  }
  return false;
}

// Engine action for majiang-ai's reply, or null if it does not map to a legal one.
function toAction(game, seat, reply) {
  const k = game.s.k;
  const o = game.view(seat).options;
  const same = (id, p) => tileType(id) === p.t && isAka(id) === p.red;
  if (o.kind === 'turn') {
    if (reply.hule && o.tsumo) return { type: 'tsumo' };
    if (reply.daopai && o.kyuushu) return { type: 'kyuushu' };
    if (reply.gang) {
      const { t } = parsePai(reply.gang);
      if (/\d{4}$/.test(reply.gang) && o.ankan.includes(t)) return { type: 'ankan', t };
      if (o.kakan.includes(t)) return { type: 'kakan', t };
    }
    if (reply.dapai) {
      const p = parsePai(reply.dapai);
      const ids = o.discard.filter((id) => same(id, p));
      const tsumogiri = reply.dapai.includes('_');
      const id = ids.find((x) => (x === k.drawn) === tsumogiri) ?? ids[0];
      if (id === undefined) return null;
      if (reply.dapai.endsWith('*') && o.riichi.includes(id)) return { type: 'riichi', tile: id };
      return { type: 'discard', tile: id };
    }
    return null;
  }
  if (reply.hule && o.ron) return { type: 'ron' };
  if (reply.fulou) {
    const m = reply.fulou;
    const s = m[0];
    const hand = m.match(/\d(?![+=-])/g).map((n) => parsePai(s + n));
    const sig = (list) => list.map((p) => `${p.t}${p.red ? 'r' : ''}`).sort().join();
    if (hand.length === 3) return o.minkan ? { type: 'minkan' } : null;
    const want = sig(hand);
    const ofIds = (ids) => sig(ids.map((id) => ({ t: tileType(id), red: isAka(id) })));
    const pon = (o.pon || []).find((ids) => ofIds(ids) === want);
    if (pon && hand[0].t === hand[1].t) return { type: 'pon', tiles: pon };
    const chi = (o.chi || []).find((c) => ofIds(c.tiles) === want);
    if (chi) return { type: 'chi', tiles: chi.tiles };
    return null;
  }
  return { type: 'pass' };
}

export function majiangAction(game, seat) {
  const s = game.s;
  const msgs = messages(s.k.mjai, seat);
  // The decision is about the last tile event; dora revealed after it
  // (by the discard that follows a kan) are already on the table.
  let i = msgs.length - 1;
  while (i > 0 && msgs[i].kaigang) i--;
  const order = [...msgs.slice(0, i), ...msgs.slice(i + 1)];

  const player = new Player();
  player.action({ kaiju: { id: seat, rule: rule(s.config), title: '', player: [], qijia: 0 } });
  for (const m of order) player.action(m);
  let reply = {};
  player.action(msgs[i], (r) => { reply = r || {}; });

  const turn = s.phase === 'turn';
  if (reply.hule && winsIntoLast(game, seat, turn ? null : s.k.pending.from)) {
    reply = turn ? { dapai: player.select_dapai() } : {};
  }
  // A kokushi robbing a closed kan is always worth it (majiang-ai skips it).
  if (!turn && s.k.pending.kind === 'ankan' && game.view(seat).options.ron) reply = { hule: '-' };
  const a = toAction(game, seat, reply);
  // e.g. a win the engine does not allow: discard instead
  if (!a && turn) return toAction(game, seat, { dapai: player.select_dapai() });
  return a;
}
