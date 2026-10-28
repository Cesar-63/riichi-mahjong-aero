import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/engine/game.js';
import { mjaiView } from '../server/engine/mjai.js';
import { majiangAction } from '../server/engine/majiang-bot.js';
import { encode, OBS_ROWS } from '../server/engine/mortal/encoder.js';
import { mortalAction } from '../server/engine/mortal/mortal-bot.js';
import { parseIds, tileType, isAka } from '../public/js/shared/tiles.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// As in bot.test.js: chosen hands and wall front, seat 0 draws first.
function scripted(hands, wallStr, { kyokuNum = 0, scores } = {}) {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(7));
  g.s.kyokuNum = kyokuNum;
  if (scores) g.s.players.forEach((p, i) => { p.score = scores[i]; });
  const used = new Set();
  const k = g.s.k;
  k.hands = hands.map((h) => parseIds(h, used));
  const wallFront = parseIds(wallStr, used);
  const others = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  k.dead = others.splice(others.length - 14, 14);
  k.wall = [...wallFront, ...others];
  k.drawn = null;
  k.mjai = [];
  g.logStart();
  g.draw(0);
  return g;
}

const RON_HANDS = ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'];

test('the encoder sees the dealer\'s first decision, and only the dealer\'s', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(3));
  const log = g.s.k.mjai;
  const r = encode(mjaiView(log, 0), 0);
  assert.ok(r && r.cans.discard);
  assert.equal(r.obs.length, OBS_ROWS * 34);
  assert.equal(r.mask.length, 46);
  // the discard mask is exactly the tile kinds in hand (red fives apart)
  const kinds = new Set(g.s.k.hands[0].map((id) => (isAka(id) ? 34 + Math.floor(tileType(id) / 9) : tileType(id))));
  for (let a = 0; a <= 36; a++) assert.equal(!!r.mask[a], kinds.has(a), `discard ${a}`);
  assert.equal(encode(mjaiView(log, 1), 1), null, 'seat 1 has nothing to decide');
});

test('tonpuusen: only the game-progress rows of the observation change', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(3));
  const view = mjaiView(g.s.k.mjai, 0);
  const a = encode(view, 0);
  const b = encode(view, 0, { tonpuusen: true });
  const rows = new Set();
  for (let i = 0; i < a.obs.length; i++) if (a.obs[i] !== b.obs[i]) rows.add(Math.floor(i / 34));
  assert.ok(rows.size > 0 && rows.size <= 7, `${rows.size} rows differ`);
  assert.deepEqual(a.mask, b.mask);
});

test('a hard bot wins by tsumo and by ron', async () => {
  let g = scripted(['23m456p789s11p678s', '4m11z22z33z44z55z66z', '19m19p19s1234z56z7z', '258m258p258s1357z'], '1m');
  assert.deepEqual(await mortalAction(g, 0), { type: 'tsumo' });
  g = scripted(RON_HANDS, '9p');
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  assert.deepEqual(await mortalAction(g, 1), { type: 'ron' });
});

test('a hard bot does not win into last place either', async () => {
  const g = scripted(RON_HANDS, '9p', { kyokuNum: 3, scores: [40000, 10000, 25000, 25000] });
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  assert.deepEqual(await mortalAction(g, 1), { type: 'pass' });
});

test('two hard bots play a whole game with two normal ones, always with a legal move', async () => {
  const g = Game.create(['H0', 'N1', 'H2', 'N3'], {}, mulberry32(21));
  const seen = {};
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    assert.ok(steps < 5000, 'terminates');
    const seat = g.pendingSeats()[0];
    if (g.s.phase === 'result') {
      g.act(seat, { type: 'ok' });
      continue;
    }
    let a;
    if (seat % 2 === 0) {
      a = await mortalAction(g, seat);
      assert.ok(a, `Mortal's choice maps to a legal move (${g.s.phase})`);
      seen[a.type] = (seen[a.type] || 0) + 1;
    } else a = majiangAction(g, seat);
    g.act(seat, a);
  }
  assert.equal(g.s.final.reduce((n, f) => n + f.score, 0), 100000);
  assert.ok(seen.discard > 0 && seen.pass > 0);
});
