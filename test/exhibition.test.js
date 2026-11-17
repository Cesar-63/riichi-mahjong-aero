import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/engine/game.js';
import { parseIds, tileType } from '../public/js/shared/tiles.js';
import { STYLE_IDS, styleAction } from '../scripts/exhibition/styles.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A kyoku with chosen hands and wall front; seat 0 draws first.
function scripted(hands, wallStr) {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(7));
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

test('the four styles play a whole game with legal moves only', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(3));
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    assert.ok(steps < 5000, 'terminates');
    const seat = g.pendingSeats()[0];
    if (g.s.phase === 'result') {
      g.act(seat, { type: 'ok' });
      continue;
    }
    const a = styleAction(STYLE_IDS[seat], g, seat);
    assert.ok(a, 'every style answers');
    g.act(seat, a); // throws on an illegal move
  }
  assert.equal(g.s.final.reduce((n, f) => n + f.score, 0), 100000);
});

test('the defensive style folds to a tile in the riichi player\'s river', () => {
  const g = scripted(['258m258p258s1357z', '19m19p19s1234z56z7z', '123m456p789s11p23s', '4m11z22z33z44z55z6z'], '9m');
  const k = g.s.k;
  k.riichi[1] = { ippatsu: false };
  k.discards[1] = [{ tile: parseIds('8s')[0], tsumogiri: false, riichi: true, called: false }];
  const a = styleAction('defensive', g, 0);
  assert.equal(a.type, 'discard');
  assert.equal(tileType(a.tile), tileType(parseIds('8s')[0]));
});

test('the defensive style never calls', () => {
  // seat 1 could pon the 5z seat 0 throws
  const g = scripted(['258m258p258s1357z', '55z19m19p19s1234z6z', '123m456p789s11p23s', '456m11z22z33z44z67z'], '9m');
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 31) });
  assert.ok(g.view(1).options.pon, 'seat 1 can pon');
  assert.equal(styleAction('defensive', g, 1).type, 'pass');
});
