import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickCounts, trayScore, carriedDeposits, pileLayout, VALUES, COMPARTMENTS, STICK, MIN_SHOWN } from '../public/js/three3d/sticks.js';

test('the sticks in the drawer add up to the score', () => {
  assert.deepEqual(stickCounts(25000), [1, 2, 4, 10]); // ten 100s, not five
  assert.deepEqual(stickCounts(24700), [1, 2, 4, 7]); // a dealer with 3 honba sticks out
  assert.deepEqual(stickCounts(33000), [2, 2, 2, 10]);
  for (let score = -5000; score <= 150000; score += 100) {
    const counts = stickCounts(score);
    const sum = counts.reduce((s, n, i) => s + n * VALUES[i], 0);
    assert.equal(sum, Math.max(0, score), `score ${score}`);
    assert.ok(counts.every((n) => Number.isInteger(n) && n >= 0));
  }
});

test('the honba sticks on the table come out of the tray', () => {
  assert.equal(trayScore(25000, 3), 24700);
  assert.equal(trayScore(25000, 0), 25000);
  assert.equal(trayScore(200, 5), 0);
});

test('riichi deposits from earlier hands wait in the middle', () => {
  const players = (riichi) => [0, 1, 2, 3].map((i) => ({ riichi: riichi.includes(i) }));
  assert.equal(carriedDeposits({ phase: 'turn', kyoutaku: 2, players: players([]) }), 2);
  // this hand's riichi sticks are in front of their players, not in the pile
  assert.equal(carriedDeposits({ phase: 'turn', kyoutaku: 3, players: players([1]) }), 2);
  // a win took the pot
  assert.equal(carriedDeposits({ phase: 'result', kyoutaku: 0, players: players([1, 2]) }), 0);
  assert.equal(carriedDeposits({ phase: 'end', kyoutaku: 2, players: players([]) }), 0);
});

test('every stick lies inside its compartment and shows a strip', () => {
  for (let score = 0; score <= 120000; score += 100) {
    stickCounts(score).forEach((n, c) => {
      const width = COMPARTMENTS[c] - 0.12;
      const pile = pileLayout(n, width, score / 100 * 4 + c);
      assert.equal(pile.length, n);
      for (const s of pile) {
        assert.ok(Math.abs(s.x) + STICK.wide / 2 <= width / 2 + 1e-9 || n * MIN_SHOWN > width, `score ${score}: stick out of its compartment`);
        assert.ok(s.shown >= MIN_SHOWN - 1e-9, `score ${score}: a stick is hidden (${s.shown})`);
      }
      assert.deepEqual(pile, pileLayout(n, width, score / 100 * 4 + c)); // the same every time
    });
  }
});

test('the tray arranged by the player keeps every stick and stays tidy', async () => {
  const { trayLayout, trayOrder, moveGroup, compartmentAt, trayCompartments, snapToTray, TRAY_W } = await import('../public/js/three3d/sticks.js');
  const sum = (sticks) => sticks.reduce((a, s) => a + s.value, 0);
  assert.deepEqual(trayOrder(null), VALUES);
  assert.deepEqual(trayOrder([100, 100, 1000, 5000]), VALUES, 'not an order');
  // the groups trade places, and the widths go with them
  const order = moveGroup(VALUES, 100, 0);
  assert.deepEqual(order, [100, 5000, 1000, 10000]);
  const comps = trayCompartments(order);
  assert.equal(comps[0].right - comps[0].left, COMPARTMENTS[3]);
  assert.ok(Math.abs(comps[3].right - TRAY_W / 2) < 1e-9);
  assert.equal(compartmentAt(order, -TRAY_W / 2 + 0.5), 0);
  assert.equal(compartmentAt(order, 99), 3);
  // a stick put down on a wall between compartments goes to one side
  const wall = comps[0].right;
  const snapped = snapToTray(order, wall, 1);
  assert.ok(Math.abs(snapped.x - wall) >= STICK.wide / 2, 'clear of the wall');
  assert.equal(snapped.z, 0.1);
  // all the score is there, whatever the arrangement
  const moved = [{ value: 1000, x: -2, z: 0, yaw: 0.1 }, { value: 100, x: 3, z: 0 }, { value: 100, x: 3, z: 0 }];
  for (let score = 0; score <= 60000; score += 700) {
    const sticks = trayLayout(score, { order, moved }, 7);
    assert.equal(sum(sticks), score - (score % 100), `score ${score}`);
    for (const s of sticks) {
      assert.ok(Math.abs(s.x) <= TRAY_W / 2, 'inside the tray');
      assert.ok(s.y > 0);
    }
  }
  // moved by hand: kept while the score changes, and two in the same place
  // lie one on the other
  const before = trayLayout(25000, { order, moved }, 7).filter((s) => s.moved >= 0);
  const after = trayLayout(24000, { order, moved }, 7).filter((s) => s.moved >= 0);
  assert.deepEqual(after.map((s) => s.x), before.map((s) => s.x), 'paying a riichi stick takes it from the heaps');
  const [, a, b] = before;
  assert.equal(a.x, b.x);
  assert.ok(b.y >= a.y + STICK.thick - 1e-9, 'the second one lies on the first');
  // fewer sticks of that value than were moved: the first ones moved stay
  const poor = trayLayout(100, { order, moved }, 7).filter((s) => s.moved >= 0);
  assert.deepEqual(poor.map((s) => s.moved), [1]);
});

test('the payments thrown on the table add up to what the engine moved', async () => {
  const { paymentFlows, paymentSticks } = await import('../public/js/three3d/sticks.js');
  const { Game } = await import('../server/engine/game.js');
  const { shanten } = await import('../server/engine/hand.js');
  const { counts34 } = await import('../public/js/shared/tiles.js');
  assert.deepEqual(paymentSticks(7700), [5000, 1000, 1000, 100, 100, 100, 100, 100, 100, 100]);
  assert.deepEqual(paymentSticks(48000), [10000, 10000, 10000, 10000, 5000, 1000, 1000, 1000]);
  assert.equal(paymentSticks(120000, 12).length, 12, 'never more than asked');
  // hand-made: a pao ron, a tsumo with honba, a double ron and the riichi pot
  const ron = paymentFlows({ phase: 'result', dealer: 0, result: { type: 'agari', deltas: [-16300, 33600, -16300, -1000],
    wins: [{ seat: 1, from: 0, tsumo: false, points: 32600, handPoints: 32000, honbaPoints: 600, pao: 2 }] } });
  assert.deepEqual(ron.flows, [{ from: 2, to: 1, amount: 16000 }, { from: 0, to: 1, amount: 16600 }]);
  assert.deepEqual(ron.pot, { to: 1, count: 1 });
  const tsumo = paymentFlows({ phase: 'result', dealer: 2, result: { type: 'agari', deltas: [-1100, 4200, -2100, -1100],
    wins: [{ seat: 1, from: null, tsumo: true, points: 4300, handPoints: 4000, honbaPoints: 300, pao: null, tsumoSplit: { dealer: 2000, other: 1000 } }] } });
  assert.deepEqual(tsumo.flows, [{ from: 0, to: 1, amount: 1100 }, { from: 2, to: 1, amount: 2100 }, { from: 3, to: 1, amount: 1100 }]);
  assert.equal(tsumo.pot, null);
  assert.deepEqual(paymentFlows({ phase: 'turn' }), { flows: [], pot: null });
  // two noten pay two tenpai 1500: in 100 sticks, 800 and 700
  const draw = paymentFlows({ phase: 'result', result: { type: 'draw', deltas: [1500, 1500, -1500, -1500] } });
  assert.ok(draw.flows.every((f) => f.amount % 100 === 0));
  assert.deepEqual(draw.flows.map((f) => f.amount).sort(), [700, 700, 800, 800]);

  // and on random games of the engine, every hand
  let state = 99;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let checked = 0;
  for (let game = 0; game < 6; game++) {
    const g = Game.create(['A', 'B', 'C', 'D'], {}, rng);
    for (let steps = 0; g.s.phase !== 'end' && steps < 20000; steps++) {
      const seats = g.pendingSeats();
      const seat = seats[Math.floor(rng() * seats.length)];
      const v = g.view(seat);
      if (g.s.phase === 'result') {
        const { flows, pot } = paymentFlows(v);
        const net = [0, 0, 0, 0];
        for (const f of flows) {
          net[f.from] -= f.amount;
          net[f.to] += f.amount;
        }
        if (pot) net[pot.to] += pot.count * 1000;
        assert.deepEqual(net, v.result.deltas, JSON.stringify(v.result.deltas));
        checked++;
        g.act(seat, { type: 'ok' });
        continue;
      }
      const o = v.options;
      let a = { type: 'pass' };
      if (o.kind === 'turn') {
        if (o.tsumo) a = { type: 'tsumo' };
        else if (o.riichi.length && rng() < 0.6) a = { type: 'riichi', tile: o.riichi[0] };
        else {
          const hand = g.s.k.hands[seat];
          const score = (id) => shanten(counts34(hand.filter((x) => x !== id)), g.s.k.melds[seat].length) + rng() * 1.5;
          a = { type: 'discard', tile: o.discard.reduce((b, id) => (score(id) < score(b) ? id : b)) };
        }
      } else if (o.ron) a = { type: 'ron' };
      else if (o.pon && rng() < 0.2) a = { type: 'pon', tiles: o.pon[0] };
      g.act(seat, a);
    }
  }
  assert.ok(checked > 20, `${checked} hands`);
});
