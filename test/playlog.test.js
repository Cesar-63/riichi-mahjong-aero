import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeStep, tileLabel } from '../public/js/shared/playlog.js';

const { scenes } = JSON.parse(readFileSync(new URL('../public/lab/scenarios.json', import.meta.url)));
const scene = (id) => scenes.find((s) => s.id === id);
// every line of a scene, step after step
const play = (s) => s.steps.flatMap((st, i) => describeStep(i ? s.steps[i - 1].view : null, st.view));

test('tiles by their names', () => {
  assert.equal(tileLabel(4 * 4 + 1), '5萬');
  assert.equal(tileLabel(16), '5萬 rojo');
  assert.equal(tileLabel(4 * 33), '中');
  assert.equal(tileLabel(4 * 9), '1筒');
});

test('the play-by-play of the lab scenes', () => {
  const ron = play(scene('riichi-ron'));
  assert.equal(ron[0].kind, 'hand', 'a new hand first');
  assert.ok(ron.some((l) => l.kind === 'riichi' && l.text.includes('declara riichi')));
  const win = ron.filter((l) => l.kind === 'win');
  assert.equal(win.length, 1);
  assert.match(win[0].text, /gana por ron a .+: \d+/);
  // nothing said twice: the result once, each discard once
  const texts = ron.map((l) => l.text);
  assert.equal(new Set(texts).size, texts.length);

  const calls = play(scene('my-calls')).filter((l) => l.kind === 'call').map((l) => l.text);
  assert.ok(calls.some((t) => / pon de .+ de /.test(t)), calls.join(' | '));
  assert.ok(calls.some((t) => / chi de .+ de /.test(t)), calls.join(' | '));
  assert.ok(play(scene('kan')).some((l) => l.kind === 'call' && l.text.includes('kan cerrado')));

  const tsumo = play(scene('my-tsumo')).filter((l) => l.kind === 'win');
  assert.match(tsumo[0].text, /gana por tsumo/);
  const draw = play(scene('exhaustive')).filter((l) => l.kind === 'draw');
  assert.match(draw[0].text, /^Empate · tenpai: /);
  assert.equal(play(scene('double-ron')).filter((l) => l.kind === 'win').length, 2);
});
