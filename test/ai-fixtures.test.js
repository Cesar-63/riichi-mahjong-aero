import test from 'node:test';
import assert from 'node:assert/strict';
import { dumpGame } from '../scripts/ai-fixtures.mjs';

test('a dumped game is the same every time for a seed', () => {
  assert.deepEqual(dumpGame(7), dumpGame(7));
  assert.notDeepEqual(dumpGame(7), dumpGame(8));
});

test('a dumped game is whole: hands start and end, actions are legal, points add up', () => {
  for (const seed of [1, 2, 3, 4]) {
    const lines = dumpGame(seed);
    assert.equal(lines[0].k, 'start');
    assert.equal(lines[0].rules.rounds, seed % 2 === 0 ? 2 : 1);
    assert.equal(lines.at(-1).k, 'end');
    assert.equal(lines.at(-1).final.length, 4);

    const events = lines.filter((l) => l.k === 'event').map((l) => l.e);
    const starts = events.filter((e) => e.type === 'start_kyoku');
    const kyokus = lines.filter((l) => l.k === 'kyoku');
    assert.equal(starts.length, kyokus.length, 'one result per hand');
    assert.equal(events.filter((e) => e.type === 'end_kyoku').length, starts.length);
    assert.ok(JSON.stringify(lines).indexOf('"?"') < 0, 'nothing is hidden');

    // each hand's deltas take the scores from one start to the next
    kyokus.forEach((kl, i) => {
      const before = starts[i].scores;
      const riichi = [0, 0, 0, 0];
      let from = events.indexOf(starts[i]);
      for (; events[from].type !== 'end_kyoku'; from++) {
        if (events[from].type === 'reach_accepted') riichi[events[from].actor]++;
      }
      const after = before.map((s, x) => s + kl.result.deltas[x] - riichi[x] * 1000);
      assert.deepEqual(kl.result.scores, after, `scores after hand ${i + 1} of game ${seed}`);
      if (starts[i + 1]) assert.deepEqual(starts[i + 1].scores, after);
    });

    // every action taken was offered to that seat
    lines.forEach((l, i) => {
      if (l.k !== 'act') return;
      const o = lines[i - 1].seats[l.seat];
      const a = l.action;
      assert.ok(o, 'the acting seat had options');
      if (a.type === 'discard') assert.ok(o.discard.includes(a.pai));
      if (a.type === 'riichi') assert.ok(o.riichi.includes(a.pai));
      if (a.type === 'tsumo') assert.ok(o.tsumo);
      if (a.type === 'ron') assert.ok(o.ron);
      if (a.type === 'pon') assert.ok(o.pon.some((p) => p.join() === a.consumed.join()));
      if (a.type === 'chi') assert.ok(o.chi.some((c) => c.join() === a.consumed.join()));
    });
  }
});
