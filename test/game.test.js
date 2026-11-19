import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/engine/game.js';
import { parseIds, tileType, counts34, isGlass } from '../public/js/shared/tiles.js';
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
    if (!['result', 'coin', 'end'].includes(s.phase)) assert.equal(n, expected, `hand size seat ${i}`);
  }
}

function playRandom(seed, stats, smart = false, config = {}) {
  const rng = mulberry32(seed);
  const g = Game.create(['A', 'B', 'C', 'D'], config, rng);
  let steps = 0;
  while (g.s.phase !== 'end') {
    if (++steps > 20000) throw new Error('game did not terminate');
    const seats = g.pendingSeats();
    const seat = seats[Math.floor(rng() * seats.length)];
    const v = g.view(seat);
    const o = v.options;
    let a;
    if (g.s.phase === 'result') a = { type: 'ok' };
    else if (o.kind === 'coin') a = { type: 'coin', call: rng() < 0.5 ? 'cara' : 'sello' };
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

test('a win carries its value without honba, and the honba apart', () => {
  // ron: seat 1 (pinfu) on seat 0's 4m, with 2 honba on the table
  let g = scripted(
    ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
    '9p',
  );
  g.s.honba = 2;
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  g.act(1, { type: 'ron' });
  let w = g.s.result.wins[0];
  assert.equal(w.honbaPoints, 600);
  assert.equal(w.handPoints + w.honbaPoints, w.points);
  assert.equal(w.tsumoSplit, null);
  assert.equal(g.s.players[0].score, 25000 - w.points, 'the discarder still pays the honba');
  // self draw by the dealer (seat 0): each one pays the split plus 100 per honba
  g = scripted(
    ['23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z', '4m11z22z33z44z55z66z'],
    '1m',
  );
  g.s.honba = 1;
  g.act(0, { type: 'tsumo' });
  w = g.s.result.wins[0];
  assert.equal(w.tsumoSplit.dealer, 0);
  assert.equal(w.handPoints, 3 * w.tsumoSplit.other);
  assert.equal(w.honbaPoints, 300);
  assert.equal(w.points, w.handPoints + 300);
  for (const x of [1, 2, 3]) assert.equal(g.s.players[x].score, 25000 - w.tsumoSplit.other - 100);
});

test('pao: the responsible player pays the hand and the honba, shown apart', () => {
  // the dealer draws daisangen; seat 2 is marked as having fed the last dragon
  const g = scripted(
    ['555z666z777z123m4m', '23m456p789s11p678s', '258m369p147s1234z', '258m258p258s1357z'],
    '4m',
  );
  g.s.honba = 1;
  g.s.k.pao[0].daisangen = 2;
  g.s.k.callsMade = true; // not a first draw: no tenhou on top
  g.act(0, { type: 'tsumo' });
  const w = g.s.result.wins[0];
  assert.equal(w.pao, 2);
  assert.equal(w.tsumoSplit, null, 'one player pays: no split');
  assert.equal(w.handPoints, 48000);
  assert.equal(w.honbaPoints, 300);
  assert.equal(g.s.players[2].score, 25000 - 48300);
});

test('double ron: each winner gets the honba apart', () => {
  const g = scripted(
    ['5m11z22z33z44z55z66z', '34m456p789s11p678s', '34m406p123s22p678p', '258m258p258s1357z'],
    '9p9m',
  );
  g.s.honba = 1;
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 4) });
  g.act(1, { type: 'ron' });
  g.act(2, { type: 'ron' });
  if (g.s.phase === 'response') g.act(3, { type: 'pass' });
  for (const w of g.s.result.wins) {
    assert.equal(w.honbaPoints, 300);
    assert.equal(w.handPoints + 300, w.points);
  }
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

test('streak: one holder; wins and dealer tenpai add, tenpai keeps, noten and other wins end it', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(5));
  const end = (result, renchan) => {
    g.endKyoku({ deltas: [0, 0, 0, 0], ...result }, renchan);
    const streaks = g.view(0).players.map((p) => p.streak);
    for (let s = 0; s < 4; s++) g.act(s, { type: 'ok' });
    return streaks;
  };
  const win = (...seats) => ({ type: 'agari', wins: seats.map((seat) => ({ seat })) });
  const draw = (...tenpai) => ({ type: 'draw', reason: 'exhaustive', tenpai });

  assert.deepEqual(g.view(0).players.map((p) => p.streak), [0, 0, 0, 0]);
  // seat 0 deals
  assert.deepEqual(end(win(2), false), [0, 0, 1, 0], 'a win from any seat starts it');
  // seat 1 deals
  assert.deepEqual(end(win(2), false), [0, 0, 2, 0], 'a second win in a row');
  // seat 2 deals and is tenpai at the draw, with seat 3
  assert.deepEqual(end(draw(2, 3), true), [0, 0, 3, 0], 'the holder, dealer and tenpai, adds one');
  // seat 2 still deals: noten this time, seat 3 tenpai
  assert.deepEqual(end(draw(3), false), [0, 0, 0, 0], 'noten loses it');
  // seat 3 deals
  assert.deepEqual(end(win(0), false), [1, 0, 0, 0]);
  assert.equal(g.dealer(), 0);
  // seat 0 deals, seat 1 wins: the streak passes to seat 1
  assert.deepEqual(end(win(1), false), [0, 1, 0, 0], 'somebody else winning takes it');
  // seat 1 deals and is the only one tenpai
  assert.deepEqual(end(draw(1), true), [0, 2, 0, 0]);
  // seat 1 deals again; seat 3 holds the streak and keeps it by being tenpai
  g.s.streaks = [0, 0, 0, 3];
  assert.deepEqual(end(draw(1, 3), true), [0, 0, 0, 3], 'non-dealer tenpai keeps; the tenpai dealer starts none meanwhile');
  assert.equal(g.dealer(), 1);
  assert.deepEqual(end(draw(1), true), [0, 1, 0, 0], 'the holder noten loses it, and the tenpai dealer starts one');
  g.s.streaks = [0, 0, 0, 3];
  assert.deepEqual(end({ type: 'draw', reason: 'kyuushu', abortive: true, tenpai: [] }, true), [0, 0, 0, 3], 'an abortive draw changes nothing');
  assert.deepEqual(end(win(0, 2), false), [0, 0, 0, 3], 'double ron: the streak stays as it was');
  assert.deepEqual(end(win(0, 3), false), [0, 0, 0, 3], 'double ron with the holder winning: the same');
});

// a fluid-wall game with given hands; the fed seat and its yakuman as the deal would pick them
function fluidGame(hands, seat, key) {
  const g = Game.create(['A', 'B', 'C', 'D'], { wall: 'yakuman' }, mulberry32(9));
  const used = new Set();
  const k = g.s.k;
  k.hands = hands.map((h) => parseIds(h, used));
  const rest = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  k.dead = rest.splice(0, 14); // low tiles, so the honors stay in the live wall
  k.wall = rest;
  k.drawn = null;
  k.fluid = { seat, key };
  g.fluidPlan();
  return g;
}

test('fluid wall: a seat picked at random, and the yakuman nearest to its hand', () => {
  const seats = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const g = Game.create(['A', 'B', 'C', 'D'], { wall: 'yakuman' }, mulberry32(seed));
    const f = g.s.k.fluid;
    seats.add(f.seat);
    assert.ok(f.key, 'a yakuman is picked at the deal');
    assert.deepEqual(g.view(2).fluid, { seat: f.seat, yakuman: f.key, left: f.need.length }, 'everybody is told');
    checkInvariants(g);
  }
  assert.equal(seats.size, 4, 'any seat can be the one');
});

test('fluid wall: every draw of the fed seat takes it straight to its yakuman', () => {
  // seat 0 holds eight of the thirteen orphans
  const g = fluidGame(['19m19p19s12z258p47s', '234567m234567p2s', '345678m34567s33p', '456m456p456s2233m'], 0, 'kokushi');
  const k = g.s.k;
  assert.equal(k.fluid.need.length, 6, 'five orphans and the pair');
  const orphan = (id) => [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33].includes(tileType(id));
  g.draw(0);
  let fed = 0;
  let guard = 200;
  while (g.s.phase !== 'result' && guard--) {
    if (g.s.phase === 'response') {
      for (const s of g.pendingSeats()) g.act(s, { type: 'pass' });
      continue;
    }
    const seat = k.turn;
    if (seat !== 0) {
      g.act(seat, { type: 'discard', tile: k.drawn });
      continue;
    }
    assert.ok(orphan(k.drawn), 'every draw of the fed seat is a tile it needs');
    fed++;
    if (g.view(0).options.tsumo) {
      g.act(0, { type: 'tsumo' });
      break;
    }
    g.act(0, { type: 'discard', tile: k.hands[0].find((id) => !orphan(id)) });
  }
  assert.equal(fed, 6, 'the yakuman comes in as many draws as tiles were missing');
  assert.equal(g.s.result.type, 'agari');
  assert.ok(g.s.result.wins[0].yakuman, 'and it is a yakuman');
  checkInvariants(g);
});

test('fluid wall: the others get a tile the yakuman needs only while there are copies to spare', () => {
  // seat 0 goes for chuuren in bamboo: it holds one 1s and one 9s, so it
  // still needs two of each; the wall has three of each, one to spare
  const g = fluidGame(['123456789s11p22p', '234567p234567m5z', '345678p345678m6z', '456p456m11223z7z'], 0, 'chuuren');
  const k = g.s.k;
  const count = (t) => k.wall.filter((id) => tileType(id) === t).length;
  assert.equal(k.fluid.need.filter((t) => t === 26).length, 2);
  assert.equal(count(26), 3);
  // a 9s on top of the wall: seat 1 may take the spare one
  const top = (t) => {
    const i = k.wall.findIndex((id) => tileType(id) === t);
    [k.wall[0], k.wall[i]] = [k.wall[i], k.wall[0]];
  };
  top(26);
  g.fluidDraw(1, false);
  assert.equal(tileType(k.wall[0]), 26, 'the fourth copy is free');
  k.wall.shift();
  // now the two left are both needed: the next 9s is moved out of the way
  top(26);
  g.fluidDraw(2, false);
  assert.notEqual(tileType(k.wall[0]), 26, 'the last copies are kept for the yakuman');
  assert.equal(count(26), 2);
});

test('fluid wall: after a kan the replacement tile takes the fed seat to its yakuman too, and a call does not change the yakuman', () => {
  // seat 0 goes for daisangen with three whites already
  const g = fluidGame(['5555z66z7z123m456p', '234567p234567s1z', '345678p345678s2z', '456m789m112233s3z'], 0, 'daisangen');
  const k = g.s.k;
  let need = [...k.fluid.need];
  assert.ok([32, 33].every((t) => need.includes(t)), 'the two dragons it lacks are on the list');
  g.draw(0);
  assert.ok(need.includes(tileType(k.drawn)));
  const before = k.wall.length + k.dead.length;
  need = [...k.fluid.need];
  g.act(0, { type: 'ankan', t: 31 });
  assert.ok(k.rinshan && need.includes(tileType(k.drawn)), 'the tile from the dead wall is one it was missing');
  assert.equal(k.fluid.key, 'daisangen');
  assert.equal(k.wall.length + k.dead.length, before - 1, 'the walls only swapped tiles');
  checkInvariants(g); // no tile duplicated or lost
});

test('the wall is the usual one unless the room asks for the fluid one', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(9));
  assert.equal(g.s.k.fluid, undefined);
  assert.equal(g.view(0).fluid, null);
});

test('washizu: three of every four copies are glass, and a red five is the opaque one', () => {
  for (let t = 0; t < 34; t++) {
    const ids = [0, 1, 2, 3].map((c) => t * 4 + c);
    assert.equal(ids.filter(isGlass).length, 3, `type ${t}`);
  }
  for (const red of [16, 52, 88]) assert.equal(isGlass(red), false);
});

test('washizu: a view shows the glass tiles of the rivals\' hands and never an opaque one', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], { washizu: true }, mulberry32(11));
  const k = g.s.k;
  for (let seat = 0; seat < 4; seat++) {
    const v = g.view(seat);
    assert.equal(v.players[seat].glass, null, 'not my own hand');
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue;
      const { hand, drawn } = v.players[i].glass;
      const drawnHere = k.turn === i ? k.drawn : null;
      const concealed = k.hands[i].filter((id) => id !== drawnHere);
      assert.deepEqual(hand, concealed.filter(isGlass).sort((a, b) => a - b), 'every glass tile of the hand');
      assert.equal(drawn, drawnHere !== null && isGlass(drawnHere) ? drawnHere : null, 'the drawn one too, if glass');
      const opaque = k.hands[i].filter((id) => !isGlass(id));
      assert.ok(opaque.every((id) => !JSON.stringify(v.players[i].glass).match(new RegExp(`\\b${id}\\b`))), 'no opaque tile');
    }
  }
  // after a discard the next player draws, and the views follow
  const dealer = g.dealer();
  g.act(dealer, { type: 'discard', tile: k.drawn });
  while (g.s.phase === 'response') g.act(g.pendingSeats()[0], { type: 'pass' });
  const next = (dealer + 1) % 4;
  const v = g.view(dealer);
  assert.equal(v.players[next].hasDrawn, true);
  assert.equal(v.players[next].glass.drawn, isGlass(k.drawn) ? k.drawn : null);
});

test('without washizu nobody sees a rival tile', () => {
  const g = Game.create(['A', 'B', 'C', 'D'], {}, mulberry32(12));
  assert.ok(g.view(0).players.every((p) => p.glass === null));
});

// ------------------------------------------------------------ blood duel

// a game where the blood check runs on hand-written scores
function bloodGame(config, scores) {
  const g = Game.create(['A', 'B', 'C', 'D'], config, mulberry32(5));
  if (scores) g.s.players.forEach((p, i) => { p.score = scores[i]; });
  return g;
}
const noDraw = { type: 'draw', reason: 'exhaustive', deltas: [0, 0, 0, 0], tenpai: [] };
const allOk = (g) => { for (const x of g.pendingSeats()) g.act(x, { type: 'ok' }); };

test('blood: off by default; the modes set the rate and the uma of the manga', () => {
  assert.equal(bloodGame({}).s.blood, null);
  assert.equal(bloodGame({}).view(0).blood, null);
  assert.equal(bloodGame({ blood: 'nope' }).s.blood, null, 'an unknown mode is no blood');
  const g = bloodGame({ blood: 'akagi' });
  assert.deepEqual(g.s.config.uma, [30, 10, -10, -30]);
  assert.equal(g.view(0).blood.rate, 100);
  assert.equal(bloodGame({ blood: 'washizu' }).view(0).blood.rate, 10);
  assert.deepEqual(g.view(0).blood.lost, [0, 0, 0, 0]);
});

test('blood: on their own, what a duelist is down from 25000 is drawn as blood, and winning gives it back', () => {
  const g = scripted(
    ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
    '9p',
  );
  g.s.config.blood = 'akagi';
  g.s.blood = { duelists: [0, 1, 2, 3], checked: [0, 0, 0, 0], duel: [0, 0, 0, 0], dead: [], tosses: [], settled: null };
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  g.act(1, { type: 'ron' });
  const w = g.s.result.wins[0];
  assert.equal(g.view(2).blood.lost[0], w.points / 10, 'the direct hit: 100 cc per 1000');
  assert.equal(g.view(2).blood.lost[1], 0, 'ahead: nothing lost');
  assert.deepEqual(g.s.result.blood.lost, g.view(0).blood.lost);
  // washizu: ten times less
  g.s.config.blood = 'washizu';
  assert.equal(g.view(2).blood.lost[0], w.points / 100);
  // won back: the blood goes back in
  g.s.players[0].score = 26000;
  assert.equal(g.view(0).blood.lost[0], 0);
});

test('blood: the riichi stick is 100 cc, and it is not allowed when it would kill', () => {
  const g = scripted(
    ['23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z', '4m11z22z33z44z55z66z'],
    '9s',
  );
  g.s.config.blood = 'akagi';
  g.s.blood = { duelists: [0, 1, 2, 3], checked: [0, 0, 0, 0], duel: [0, 0, 0, 0], dead: [], tosses: [], settled: null };
  g.s.players[0].score = 6000; // 1900 cc: a stick takes it to 2000, still alive
  assert.ok(g.turnOptions(0).riichi.length > 0);
  g.s.players[0].score = 5000; // 2000 cc: a stick would be 2100
  assert.equal(g.turnOptions(0).riichi.length, 0);
  g.s.config.blood = 'washizu';
  assert.ok(g.turnOptions(0).riichi.length > 0, 'at 10 cc a stick is far from the limit');
});

test('blood: over 2000 cc a duelist dies at once, the game ends and they go last', () => {
  const g = bloodGame({ blood: 'akagi' }, [44000, 30000, 30000, 4000]);
  g.endKyoku({ ...noDraw }, false);
  assert.deepEqual(g.s.result.blood.dead, [3]);
  assert.equal(g.s.result.gameEnds, true);
  allOk(g);
  assert.equal(g.s.phase, 'end');
  assert.equal(g.s.final[3].seat, 3);
  assert.equal(g.s.final[3].blood.dead, true);
});

test('blood: between 1500 and 2000 cc (both included) the duelist tosses a coin', () => {
  for (const [score, coin] of [[10500, false], [10000, true], [5000, true], [4900, false]]) {
    const g = bloodGame({ blood: 'akagi' }, [40000, 30000, 100000 - 70000 - score, score]);
    g.endKyoku({ ...noDraw }, false);
    const b = g.s.result.blood;
    assert.equal(b.coins.includes(3), coin, `${score}: coin`);
    if (score === 4900) assert.deepEqual(b.dead, [3], '2010 cc: dead without a coin');
  }
});

test('blood: a right call keeps the duelist playing, a wrong one kills', () => {
  for (const [roll, alive] of [[0.1, true], [0.9, false]]) {
    // the others stay out of the coin zone in the final settlement
    const g = bloodGame({ blood: 'akagi' }, [35000, 29000, 26000, 10000]);
    g.endKyoku({ ...noDraw }, false);
    allOk(g);
    assert.equal(g.s.phase, 'coin');
    assert.deepEqual(g.pendingSeats(), [3]);
    assert.equal(g.view(3).options.kind, 'coin');
    assert.equal(g.view(0).options, null);
    assert.deepEqual(g.view(0).blood.coin.seats, [3]);
    assert.throws(() => g.act(0, { type: 'coin', call: 'cara' }));
    assert.throws(() => g.act(3, { type: 'coin', call: 'canto' }));
    g.rng = () => roll; // < 0.5: cara
    g.act(3, { type: 'coin', call: 'cara' });
    const toss = g.s.events.find((e) => e.type === 'coin');
    assert.deepEqual([toss.face, toss.ok], [alive ? 'cara' : 'sello', alive]);
    if (alive) {
      assert.equal(g.s.phase, 'turn', 'the next hand starts');
      assert.deepEqual(g.s.blood.dead, []);
    } else {
      assert.equal(g.s.phase, 'end');
      assert.equal(g.s.final[3].seat, 3);
      assert.equal(g.s.final[3].blood.dead, true);
    }
  }
});

test('blood: inside the zone, bleeding more tosses again; staying or healing does not', () => {
  const g = bloodGame({ blood: 'akagi' }, [40000, 30000, 20000, 10000]);
  g.endKyoku({ ...noDraw }, false);
  allOk(g);
  g.rng = () => 0.1;
  g.act(3, { type: 'coin', call: 'cara' });
  g.endKyoku({ ...noDraw }, false);
  assert.deepEqual(g.s.result.blood.coins, [], 'the same 1500 cc: no coin');
  g.endKyoku({ ...noDraw, deltas: [1000, 0, 0, -1000] }, false);
  assert.deepEqual(g.s.result.blood.coins, [3], '1600 cc: another coin');
  g.s.coin = null;
  g.endKyoku({ ...noDraw, deltas: [-2000, 0, 0, 2000] }, false);
  assert.deepEqual(g.s.result.blood.coins, [], 'healed to 1400 cc');
  g.endKyoku({ ...noDraw, deltas: [1000, 0, 0, -1000] }, false);
  assert.deepEqual(g.s.result.blood.coins, [3], 'back in the zone: a coin again');
});

test('blood: the timer and the bots call the coin at random', () => {
  const g = bloodGame({ blood: 'akagi' }, [40000, 30000, 20000, 10000]);
  g.endKyoku({ ...noDraw }, false);
  allOk(g);
  g.defaultAction(3);
  assert.equal(g.s.events.filter((e) => e.type === 'coin').length, 1);
  assert.notEqual(g.s.phase, 'coin');
});

test('blood: the final settlement pays the negative final points in blood (uma 30-10, oka 20)', () => {
  const g = bloodGame({ blood: 'washizu' }, [45000, 30000, 15000, 10000]);
  g.finish();
  // final points: +65, +10, -25, -50 -> 0, 0, 250 cc, 500 cc
  assert.deepEqual(g.s.final.map((f) => f.points), [65, 10, -25, -50]);
  assert.deepEqual(g.s.final.map((f) => f.blood.lost), [0, 0, 250, 500]);
  assert.equal(g.s.phase, 'end');
  const a = bloodGame({ blood: 'akagi' }, [45000, 34000, 11000, 10000]);
  a.finish();
  // 3rd: -19 + -10 = -29 -> 2900 cc: dead; 2nd: +4 + 10 = 14 -> 0
  assert.deepEqual(a.s.final.map((f) => [f.seat, f.blood.lost, f.blood.dead]), [[0, 0, false], [1, 0, false], [2, 2900, true], [3, 5000, true]]);
});

test('blood: a final settlement in the coin zone tosses before the end', () => {
  const z = bloodGame({ blood: 'akagi' }, [36000, 30000, 25000, 9000]);
  z.s.blood.dead.push(3);
  z.finish();
  // 3rd at 25000: -5 - 10 = -15 -> 1500 cc: coin
  assert.equal(z.s.phase, 'coin');
  assert.deepEqual(z.pendingSeats(), [2]);
  z.rng = () => 0.1;
  z.act(2, { type: 'coin', call: 'cara' });
  assert.equal(z.s.phase, 'end');
  assert.deepEqual(z.s.final.find((f) => f.seat === 2).blood, { lost: 1500, dead: false });
});

test('blood by teams: only the two duelists bleed, and only on what they pay each other', () => {
  // seats 0-1 one team, 2-3 the other; duelists 1 and 2
  const mk = () => {
    const g = scripted(
      ['4m11z22z33z44z55z66z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'],
      '9p',
    );
    g.s.config.blood = 'akagi';
    g.s.blood = { duelists: [1, 2], checked: [0, 0, 0, 0], duel: [0, 0, 0, 0], dead: [], tosses: [], settled: null };
    return g;
  };
  // seat 1 (duelist) rons its own support (seat 0): no blood
  let g = mk();
  g.act(0, { type: 'discard', tile: g.s.k.hands[0].find((id) => tileType(id) === 3) });
  g.act(1, { type: 'ron' });
  assert.deepEqual(g.view(0).blood.lost, [null, 0, 0, null], 'not between the duelists');
  // the same hand dealt in by the rival duelist (seat 2)
  g = mk();
  const k = g.s.k;
  [k.hands[0], k.hands[2]] = [k.hands[2], k.hands[0]];
  g.s.k.turn = 2;
  g.s.k.drawn = k.hands[2][k.hands[2].length - 1];
  g.s.phase = 'turn';
  g.act(2, { type: 'discard', tile: k.hands[2].find((id) => tileType(id) === 3) });
  g.act(1, { type: 'ron' });
  const w = g.s.result.wins[0];
  assert.equal(g.view(0).blood.lost[2], w.points / 10);
  assert.equal(g.s.blood.duel[1], w.points);
  assert.equal(g.s.result.blood.lost[0], null, 'the support does not bleed');
});

test('blood by teams: the final settlement is the difference between the duelists', () => {
  const g = bloodGame({ blood: 'washizu', duelists: [0, 2] }, [40000, 20000, 30000, 10000]);
  g.s.blood.duel = [-3000, 0, 3000, 0];
  g.finish();
  // final: seat 0 +60, seat 2 +10: seat 2 owes 50 - 3 = 47 -> 470 cc
  const by = Object.fromEntries(g.s.final.map((f) => [f.seat, f.blood]));
  assert.deepEqual(by[0], { lost: 0, dead: false });
  assert.deepEqual(by[2], { lost: 470, dead: false });
  assert.equal(by[1], null);
});

test('blood: random games run to completion, alone and by teams', () => {
  let coins = 0;
  let dead = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const config = { blood: 'akagi', duelists: seed % 2 ? null : [0, 3] };
    const g = playRandom(seed, {}, true, config);
    coins += g.s.blood.tosses.length;
    dead += g.s.blood.dead.length;
    for (const f of g.s.final) assert.equal(f.blood === null, !g.isDuelist(f.seat));
  }
  assert.ok(coins > 0 && dead > 0, `coins ${coins}, dead ${dead}`);
});
