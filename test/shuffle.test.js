import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShuffle } from '../public/js/three3d/shuffle.js';

// small deterministic generator, so a failure can be reproduced
const lcg = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('shuffled tiles slide against each other instead of overlapping', () => {
  for (const seed of [1, 2, 3]) {
    const pile = createShuffle({ count: 136, hw: 0.5, hh: 2 / 3, outer: 11, panel: 3.45, rand: lcg(seed) });
    assert.equal(pile.maxOverlap(), 0);
    let worst = 0;
    // free shuffle, then squeeze into the wall line (30 fps, the harder case)
    for (let f = 0; f < 75; f++) {
      const squeeze = Math.max(0, Math.min(1, (f - 30) / 15));
      pile.setOuter(11 - squeeze * 0.8);
      pile.step(1 / 30, 1 - squeeze * 0.7, squeeze);
      worst = Math.max(worst, pile.maxOverlap());
    }
    assert.ok(worst < 0.08, `seed ${seed}: tiles overlap by ${worst.toFixed(3)}`);
    for (const t of pile.tiles) {
      assert.ok(Math.abs(t.x) < 10.2 && Math.abs(t.z) < 10.2, 'tile left the pile area');
      assert.ok(Math.abs(t.x) > 3.45 || Math.abs(t.z) > 3.45, 'tile on the centre panel');
    }
  }
});
