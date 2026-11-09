import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../server/engine/game.js';
import { mjaiTile, mjaiView } from '../server/engine/mjai.js';
import { shanten } from '../server/engine/hand.js';
import { counts34 } from '../public/js/shared/tiles.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rebuilds every concealed hand and the dora indicators from the log alone.
function replay(log) {
  const hands = [[], [], [], []];
  const dora = [];
  const take = (seat, names) => {
    for (const n of names) {
      const i = hands[seat].indexOf(n);
      assert.ok(i >= 0, `seat ${seat} holds ${n}`);
      hands[seat].splice(i, 1);
    }
  };
  for (const e of log) {
    switch (e.type) {
      case 'start_kyoku':
        e.tehais.forEach((h, i) => { hands[i] = h.slice(); });
        dora.push(e.dora_marker);
        break;
      case 'tsumo': hands[e.actor].push(e.pai); break;
      case 'dahai': take(e.actor, [e.pai]); break;
      case 'chi': case 'pon': case 'daiminkan': case 'ankan': take(e.actor, e.consumed); break;
      case 'kakan': take(e.actor, [e.pai]); break;
      case 'dora': dora.push(e.dora_marker); break;
      default:
    }
  }
  return { hands, dora };
}

function checkLog(g) {
  const k = g.s.k;
  const { hands, dora } = replay(k.mjai);
  const names = (ids) => ids.map(mjaiTile).sort();
  for (let i = 0; i < 4; i++) assert.deepEqual(hands[i].sort(), names(k.hands[i]), `hand ${i} matches the log`);
  assert.deepEqual(dora, k.dead.slice(4, 4 + k.doraCount).map(mjaiTile), 'dora indicators match');
}

// Random play (like game.test.js) that also checks the log after every action
// and returns the whole game as one mjai log.
function playLogged(seed) {
  const rng = mulberry32(seed);
  const g = Game.create(['A', 'B', 'C', 'D'], {}, rng);
  const game = [{ type: 'start_game', names: ['A', 'B', 'C', 'D'] }];
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    assert.ok(steps < 20000, 'terminates');
    const seats = g.pendingSeats();
    const seat = seats[Math.floor(rng() * seats.length)];
    const o = g.view(seat).options;
    let a;
    if (g.s.phase === 'result') a = { type: 'ok' };
    else if (o.kind === 'turn') {
      if (o.tsumo && rng() < 0.9) a = { type: 'tsumo' };
      else if (o.riichi.length && rng() < 0.6) a = { type: 'riichi', tile: o.riichi[Math.floor(rng() * o.riichi.length)] };
      else if (o.ankan.length && rng() < 0.5) a = { type: 'ankan', t: o.ankan[0] };
      else if (o.kakan.length && rng() < 0.5) a = { type: 'kakan', t: o.kakan[0] };
      else if (o.kyuushu && rng() < 0.3) a = { type: 'kyuushu' };
      else {
        // mostly shanten-minded discards, so that hands get won
        const hand = g.s.k.hands[seat];
        const melds = g.s.k.melds[seat].length;
        const score = (id) => shanten(counts34(hand.filter((x) => x !== id)), melds) + rng() * 1.5;
        a = { type: 'discard', tile: o.discard.reduce((b, id) => (score(id) < score(b) ? id : b)) };
      }
    } else if (o.ron && rng() < 0.9) a = { type: 'ron' };
    else if (o.minkan && rng() < 0.3) a = { type: 'minkan' };
    else if (o.pon && rng() < 0.2) a = { type: 'pon', tiles: o.pon[0] };
    else if (o.chi && rng() < 0.1) a = { type: 'chi', tiles: o.chi[Math.floor(rng() * o.chi.length)].tiles };
    else a = { type: 'pass' };
    const before = g.s.k;
    g.act(seat, a);
    if (g.s.phase === 'end' || g.s.k !== before) {
      // the kyoku just closed: its log is complete
      assert.equal(before.mjai.at(-1).type, 'end_kyoku');
      game.push(...before.mjai);
    } else checkLog(g);
  }
  game.push({ type: 'end_game' });
  return game;
}

test('the mjai log follows the game: hands, calls, kans and dora', () => {
  const dir = process.env.MJAI_DUMP;
  if (dir) mkdirSync(dir, { recursive: true });
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const log = playLogged(seed);
    for (const e of log) seen.add(e.type);
    if (dir) writeFileSync(join(dir, `game-${seed}.json`), `${log.map((e) => JSON.stringify(e)).join('\n')}\n`);
  }
  for (const t of ['tsumo', 'dahai', 'reach', 'reach_accepted', 'chi', 'pon', 'daiminkan', 'ankan', 'kakan', 'dora', 'hora', 'ryukyoku']) {
    assert.ok(seen.has(t), `random games produce ${t} events`);
  }
});

test('a seat sees its own tiles only', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(3));
  const view = mjaiView(g.s.k.mjai, 2);
  const start = view[0];
  assert.equal(start.type, 'start_kyoku');
  assert.deepEqual(start.tehais[2], g.s.k.mjai[0].tehais[2]);
  assert.ok(start.tehais[0].every((x) => x === '?'));
  assert.equal(view[1].type, 'tsumo');
  assert.equal(view[1].pai, '?', "the dealer's draw is hidden from seat 2");
  assert.notEqual(mjaiView(g.s.k.mjai, 0)[1].pai, '?');
});
