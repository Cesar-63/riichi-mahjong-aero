import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/engine/game.js';
import { parseIds, tileType, counts34 } from '../public/js/shared/tiles.js';
import { shanten } from '../server/engine/hand.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(g) {
  const s = g.s;
  const k = s.k;
  const total = s.players.reduce((a, p) => a + p.score, 0) + s.kyoutaku * 1000;
  assert.equal(total, 100000, 'points conserved');
  const ids = [
    ...k.wall,
    ...k.dead.slice(k.kanCount),
    ...k.hands.flat(),
    ...k.melds.flat().flatMap((m) => m.tiles),
    ...k.discards.flat().filter((d) => !d.called).map((d) => d.tile),
  ];
  assert.equal(new Set(ids).size, ids.length, 'no duplicated tiles');
  assert.equal(ids.length, 136 - k.kanCount, 'tile count');
  for (let i = 0; i < 4; i++) {
    const n = k.hands[i].length + k.melds[i].length * 3;
    const expected = s.phase === 'turn' && k.turn === i ? 14 : 13;
    if (s.phase !== 'result' && s.phase !== 'end') assert.equal(n, expected, `hand size seat ${i}`);
  }
}

function playRandom(seed, stats, smart = false) {
  const rng = mulberry32(seed);
  const g = Game.create(['A', 'B', 'C', 'D'], {}, rng);
  let steps = 0;
  while (g.s.phase !== 'end') {
    if (++steps > 20000) throw new Error('game did not terminate');
    const seats = g.pendingSeats();
    const seat = seats[Math.floor(rng() * seats.length)];
    const v = g.view(seat);
    const o = v.options;
    let a;
    if (g.s.phase === 'result') a = { type: 'ok' };
    else if (o.kind === 'turn') {
      if (o.tsumo && rng() < 0.9) a = { type: 'tsumo' };
      else if (o.riichi.length && rng() < 0.6) a = { type: 'riichi', tile: o.riichi[Math.floor(rng() * o.riichi.length)] };
      else if (o.ankan.length && rng() < 0.5) a = { type: 'ankan', t: o.ankan[0] };
      else if (o.kakan.length && rng() < 0.5) a = { type: 'kakan', t: o.kakan[0] };
      else if (o.kyuushu && rng() < 0.3) a = { type: 'kyuushu' };
      else if (smart) {
        const me = g.s.k.hands[seat];
        const melds = g.s.k.melds[seat].length;
        let best = null;
        let bestSh = 99;
        for (const id of o.discard) {
          const sh = shanten(counts34(me.filter((x) => x !== id)), melds) + rng() * 0.5;
          if (sh < bestSh) { bestSh = sh; best = id; }
        }
        a = { type: 'discard', tile: best };
      } else a = { type: 'discard', tile: o.discard[Math.floor(rng() * o.discard.length)] };
    } else {
      if (o.ron && rng() < 0.9) a = { type: 'ron' };
      else if (o.minkan && rng() < 0.3) a = { type: 'minkan' };
      else if (o.pon && rng() < (smart ? 0.15 : 0.3)) a = { type: 'pon', tiles: o.pon[0] };
      else if (o.chi && rng() < (smart ? 0.1 : 0.3)) a = { type: 'chi', tiles: o.chi[Math.floor(rng() * o.chi.length)].tiles };
      else a = { type: 'pass' };
    }
    g.act(seat, a);
    JSON.parse(JSON.stringify(g.s)); // must stay serializable
    checkInvariants(g);
    if (g.s.phase === 'result' && g.s.result.ready.every((x) => !x)) {
      const r = g.s.result;
      const key = r.type === 'agari' ? (r.wins[0].tsumo ? 'tsumo' : 'ron') : r.reason;
      stats[key] = (stats[key] || 0) + 1;
      if (r.type === 'agari') for (const w of r.wins) for (const [y] of w.yaku) stats[`y:${y}`] = (stats[`y:${y}`] || 0) + 1;
    }
  }
  const pts = g.s.final.reduce((a, f) => a + f.points, 0);
  assert.ok(Math.abs(pts) < 0.5, `final points sum ~0 (${pts})`);
  assert.equal(g.s.final.reduce((a, f) => a + f.score, 0), 100000);
  return g;
}

test('random games run to completion with invariants', () => {
  const stats = {};
  for (let seed = 1; seed <= 60; seed++) playRandom(seed, stats, seed % 4 !== 0);
  if (process.env.STATS) console.log(stats);
  assert.ok(stats.ron > 0 && stats.tsumo > 0 && stats.exhaustive > 0);
});

// Builds a game and overwrites the wall/hands for a scripted scenario.
function scripted(hands, wallStr) {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(7));
  const used = new Set();
  const k = g.s.k;
  k.hands = hands.map((h) => parseIds(h, used));
  const rest = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  const wallFront = parseIds(wallStr, used);
  const others = rest.filter((i) => !used.has(i));
  k.dead = others.splice(others.length - 14, 14);
  k.wall = [...wallFront, ...others];
  k.drawn = null;
  g.draw(0);
  return g;
}

test('ron, furiten and riichi flow', () => {
  // Seat 1 waits on 1m/4m (pinfu). Seat 0 discards 4m.
  const g = scripted(
    ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
    '9p',
  );
  const k = g.s.k;
  const four = k.hands[0].find((id) => tileType(id) === 3);
  g.act(0, { type: 'discard', tile: four });
  assert.equal(g.s.phase, 'response');
  assert.ok(g.view(1).options.ron);
  g.act(1, { type: 'ron' });
  assert.equal(g.s.phase, 'result');
  const w = g.s.result.wins[0];
  assert.equal(w.seat, 1);
  assert.ok(w.yaku.some(([y]) => y === 'pinfu'));
  assert.equal(g.s.players[1].score, 25000 + w.points);
  assert.equal(g.s.players[0].score, 25000 - w.points);
});

test('passing a winning tile gives temporary furiten', () => {
  const g = scripted(
    ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
    '9p1m',
  );
  const four = g.s.k.hands[0].find((id) => tileType(id) === 3);
  g.act(0, { type: 'discard', tile: four });
  g.act(1, { type: 'pass' });
  assert.equal(g.s.k.furitenTemp[1], true);
  // seat 1 draws 1m: tsumo still allowed
  assert.equal(g.s.k.turn, 1);
  assert.ok(g.view(1).options.tsumo);
});

test('tonpuusen end conditions', () => {
  const draw = { type: 'draw', reason: 'exhaustive', deltas: [0, 0, 0, 0], tenpai: [] };
  const at = (kyokuNum, scores, round = 0) => {
    const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(3));
    g.s.round = round;
    g.s.kyokuNum = kyokuNum;
    g.s.players.forEach((p, i) => { p.score = scores[i]; });
    return g;
  };
  let g = at(3, [31000, 23000, 23000, 23000]);
  g.endKyoku({ ...draw }, false);
  assert.equal(g.s.result.gameEnds, true, 'E4 ends when someone has 30000');

  g = at(3, [26000, 26000, 24000, 24000]);
  g.endKyoku({ ...draw }, false);
  assert.equal(g.s.result.gameEnds, false, 'nobody at 30000: South extension');
  for (let s = 0; s < 4; s++) g.act(s, { type: 'ok' });
  assert.equal(g.s.round, 1);
  assert.equal(g.s.kyokuNum, 0);

  g = at(3, [20000, 20000, 20000, 40000]);
  g.endKyoku({ ...draw }, true);
  assert.equal(g.s.result.gameEnds, true, 'all-last dealer on top: agari-yame');

  g = at(3, [40000, 20000, 20000, 20000]);
  g.endKyoku({ ...draw }, true);
  assert.equal(g.s.result.gameEnds, false, 'all-last dealer renchan not on top continues');

  g = at(1, [26000, 26000, 24000, 24000], 1);
  g.endKyoku({ ...draw, deltas: [5000, -5000, 0, 0] }, false);
  assert.equal(g.s.result.gameEnds, true, 'extension: sudden death at 30000');

  g = at(1, [26000, 26000, 24000, 24000]);
  g.endKyoku({ ...draw, deltas: [0, -27000, 27000, 0] }, false);
  assert.equal(g.s.result.gameEnds, true, 'bust ends the game');
});

test('kuikae forbids swap discard after chi', () => {
  // Seat 1 chis 4m with 23m and may not discard 1m (suji) nor 4m.
  const g = scripted(
    ['4m11z22z33z44z55z66z', '1234m456p789s11p6s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
    '9p',
  );
  const four = g.s.k.hands[0].find((id) => tileType(id) === 3);
  g.act(0, { type: 'discard', tile: four });
  const o = g.view(1).options;
  const chi = o.chi.find((c) => c.tiles.map(tileType).sort().join() === '1,2');
  g.act(1, { type: 'chi', tiles: chi.tiles });
  for (const s of [2, 3]) if (g.s.phase === 'response' && g.view(s).options) g.act(s, { type: 'pass' });
  const t = g.view(1).options;
  assert.equal(t.kind, 'turn');
  assert.ok(!t.discard.some((id) => tileType(id) === 3 || tileType(id) === 0), 'no 1m/4m');
  assert.ok(t.discard.length > 0);
});

test('double ron: both winners paid by the discarder', () => {
  const g = scripted(
    ['5m11z22z33z44z55z66z', '34m456p789s11p678s', '34m406p123s22p678p', '258m258p258s1357z'],
    '9p9m',
  );
  const five = g.s.k.hands[0].find((id) => tileType(id) === 4);
  g.act(0, { type: 'discard', tile: five });
  assert.ok(g.view(1).options.ron && g.view(2).options.ron);
  g.act(1, { type: 'ron' });
  g.act(2, { type: 'ron' });
  if (g.s.phase === 'response') g.act(3, { type: 'pass' });
  const r = g.s.result;
  assert.equal(r.wins.length, 2);
  assert.equal(r.deltas.reduce((a, b) => a + b, 0), 0);
  assert.equal(r.deltas[0], -(r.wins[0].points + r.wins[1].points));
});

test('wall view: slots taken match draws, kans and dead-wall usage', async () => {
  const { deadSlot } = await import('../server/engine/game.js');
  // dead-wall slots are distinct and inside 122..135
  const slots = Array.from({ length: 14 }, (_, i) => deadSlot(i));
  assert.equal(new Set(slots).size, 14);
  assert.ok(slots.every((x) => x >= 122 && x <= 135));
  assert.deepEqual(slots.slice(0, 4), [134, 135, 132, 133]); // rinshan from the stack next to the break
  assert.equal(deadSlot(4), 130); // first dora indicator: top of the third stack from the break

  const rng = mulberry32(11);
  const g = Game.create(['A', 'B', 'C', 'D'], {}, rng);
  const w0 = g.view(0).wall;
  assert.equal(w0.liveTaken, 53); // 13 x 4 dealt + dealer's first draw
  assert.equal(w0.lastDraw.slot, 52);
  assert.ok(w0.dice.every((d) => d >= 1 && d <= 6));
  const sum = w0.dice[0] + w0.dice[1];
  assert.equal(w0.breakStack % 17, sum);
  for (let n = 0; n < 4; n++) {
    const seat = g.s.k.turn;
    g.act(seat, { type: 'discard', tile: g.view(seat).options.discard[0] });
    while (g.s.phase === 'response') g.act(g.pendingSeats()[0], { type: 'pass' });
    if (g.s.phase !== 'turn') break;
    const w = g.view(0).wall;
    assert.equal(w.lastDraw.slot, w.liveTaken - 1);
  }
});
