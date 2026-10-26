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
