import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/engine/game.js';
import { botAction } from '../server/engine/bot.js';
import { majiangAction } from '../server/engine/majiang-bot.js';
import { parseIds, tileType } from '../public/js/shared/tiles.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A kyoku with chosen hands and wall front; seat 0 draws first. The mjai log
// is restarted so the bots see the scripted deal.
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

test('the bot wins by tsumo', async () => {
  const g = scripted(['23m456p789s11p678s', '4m11z22z33z44z55z66z', '19m19p19s1234z56z7z', '258m258p258s1357z'], '1m');
  assert.ok(g.view(0).options.tsumo);
  assert.deepEqual(await botAction(g, 0), { type: 'tsumo' });
});

test('the bot wins by ron', async () => {
  const g = scripted(RON_HANDS, '9p');
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  assert.ok(g.view(1).options.ron);
  assert.deepEqual(await botAction(g, 1), { type: 'ron' });
});

test('in the last hand the bot does not win into last place', async () => {
  // East 4, seat 1 far behind: a cheap ron would end the game with it last.
  const last = { kyokuNum: 3, scores: [40000, 10000, 25000, 25000] };
  let g = scripted(RON_HANDS, '9p', last);
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  assert.ok(g.view(1).options.ron);
  assert.deepEqual(await botAction(g, 1), { type: 'pass' });
  // the same ron is taken when it does not leave the bot last
  g = scripted(RON_HANDS, '9p', { kyokuNum: 3, scores: [40000, 20000, 20000, 20000] });
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  assert.deepEqual(await botAction(g, 1), { type: 'ron' });
});

test('a hand saved before the mjai log existed: bots fall back, the next hand logs', async (t) => {
  t.mock.method(console, 'error', () => {});
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(5));
  delete g.s.k.mjai;
  const first = g.s.k;
  for (let steps = 0; g.s.k === first; steps++) {
    assert.ok(steps < 2000);
    const seat = g.pendingSeats()[0];
    g.act(seat, await botAction(g, seat));
  }
  assert.equal(g.s.k.mjai[0].type, 'start_kyoku');
});

test('four bots play a whole game, always answering a legal move', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(11));
  const seen = {};
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    assert.ok(steps < 5000, 'terminates');
    const seat = g.pendingSeats()[0];
    if (g.s.phase === 'result') {
      g.act(seat, { type: 'ok' });
      continue;
    }
    const a = majiangAction(g, seat);
    assert.ok(a, `the AI's answer maps to a legal move (${g.s.phase})`);
    seen[a.type] = (seen[a.type] || 0) + 1;
    g.act(seat, a);
  }
  assert.equal(g.s.final.reduce((n, f) => n + f.score, 0), 100000);
  assert.ok(seen.discard > 0 && seen.pass > 0);
  assert.ok(seen.ron || seen.tsumo, 'somebody won a hand');
});
