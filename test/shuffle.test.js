import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShuffle } from '../public/js/three3d/shuffle.js';

// small deterministic generator, so a failure can be reproduced
const lcg = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('shuffled tiles are stirred all over the table, bounce off its edges and only ever overlap a little', () => {
  for (const seed of [1, 2, 3]) {
    const pile = createShuffle({ count: 136, hw: 0.5, hh: 2 / 3, ring: [0, 40], start: 10.5, square: 14.8, panel: 0, rand: lcg(seed) });
    assert.equal(pile.maxOverlap(), 0);
    let swirl = 0;
    let squeezed = 0;
    let path = 0;
    let reach = 0;
    // 1.2 s of stirring, then 0.6 s squeezing into the wall line (30 fps, the harder case)
    for (let f = 0; f < 54; f++) {
      const q = Math.max(0, Math.min(1, (f - 36) / 18));
      pile.setArea({ square: 14.8 - q * 3.5 });
      const before = pile.tiles.map((t) => [t.x, t.z]);
      pile.step(1 / 30, 1 - q * 0.75, q);
      if (q === 0) {
        pile.tiles.forEach((t, i) => {
          path += Math.hypot(t.x - before[i][0], t.z - before[i][1]);
          reach = Math.max(reach, Math.abs(t.x), Math.abs(t.z));
        });
        swirl = Math.max(swirl, pile.maxOverlap());
      }
      if (q === 1) squeezed = Math.max(squeezed, pile.maxOverlap());
    }
    const speed = path / 136 / (36 / 30);
    assert.ok(speed > 6, `seed ${seed}: tiles barely move (${speed.toFixed(2)} units/s)`);
    // they reach the table's edge (and are kept on it)
    assert.ok(reach > 12 && reach < 14.8, `seed ${seed}: furthest tile at ${reach.toFixed(2)}`);
    // a corner may dip into a neighbour while stirring, never deep
    assert.ok(swirl < 0.3, `seed ${seed}: tiles overlap by ${swirl.toFixed(3)} while stirring`);
    assert.ok(squeezed < 0.08, `seed ${seed}: tiles overlap by ${squeezed.toFixed(3)} once squeezed`);
    for (const t of pile.tiles) assert.ok(Math.abs(t.x) < 11.3 && Math.abs(t.z) < 11.3, 'tile left the pile area');
  }
});
