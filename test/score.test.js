import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIds, parseTypes, counts34 } from '../public/js/shared/tiles.js';
import { waits, isAgari } from '../server/engine/hand.js';
import { evaluate, ronValue, tsumoValues } from '../server/engine/score.js';

// Builds a ctx from tile strings. melds: [['pon','555z'], ...]
function ctx(closed, win, opts = {}) {
  const used = new Set();
  const melds = (opts.melds || []).map(([type, s]) => ({ type, tiles: parseIds(s, used) }));
  const hand = parseIds(closed, used);
  const winTile = parseIds(win, used)[0];
  return {
    closed: [...hand, winTile],
    melds,
    winTile,
    tsumo: !!opts.tsumo,
    seatWind: opts.seatWind ?? 28,
    roundWind: opts.roundWind ?? 27,
    riichi: opts.riichi || 0,
    ippatsu: !!opts.ippatsu,
    dora: opts.dora ? parseIds(opts.dora, used) : [],
    ura: opts.ura ? parseIds(opts.ura, used) : [],
  };
}

const keys = (r) => r.yaku.filter(([k]) => k !== 'ura').map(([k]) => k);

test('waits', () => {
  assert.equal(waits(counts34(parseIds('1112345678999m'))).length, 9);
  assert.deepEqual(waits(counts34(parseIds('23m456p789s11122z'))), [0, 3]);
  assert.ok(isAgari(counts34(parseIds('19m19p19s12345677z'))));
});

test('pinfu tsumo 20 fu', () => {
  const r = evaluate(ctx('23m456p789s11p678s', '4m', { tsumo: true }));
  assert.deepEqual(keys(r).sort(), ['pinfu', 'tsumo']);
  assert.equal(r.fu, 20);
  assert.equal(r.han, 2);
  assert.deepEqual(tsumoValues(r.base, false), { dealer: 700, other: 400 });
});

test('closed ron pinfu 30 fu riichi with ura', () => {
  const r = evaluate(ctx('23m456p789s11p678s', '1m', { riichi: 1, ura: '9s', dora: '1z' }));
  // ura 9s -> dora 1s: none in hand. keys include ura with 0.
  assert.ok(keys(r).includes('pinfu'));
  assert.equal(r.fu, 30);
  assert.equal(r.han, 2);
  assert.equal(ronValue(r.base, false), 2000);
});

test('open tanyao (kuitan)', () => {
  const r = evaluate(ctx('234m567p6s', '6s', { melds: [['pon', '888p'], ['chi', '345s']] }));
  assert.deepEqual(keys(r), ['tanyao']);
  assert.equal(r.fu, 30);
  assert.equal(ronValue(r.base, false), 1000);
});

test('no yaku returns null', () => {
  assert.equal(evaluate(ctx('123m456p11s78s', '9s', { melds: [['chi', '789s']] })), null);
});

test('aka dora counts', () => {
  const r = evaluate(ctx('234m067p5s', '5s', { melds: [['pon', '888p'], ['chi', '340s']] }));
  assert.ok(r);
  const aka = r.yaku.find(([k]) => k === 'aka');
  assert.equal(aka[1], 2);
});

test('chiitoitsu 25 fu', () => {
  const r = evaluate(ctx('1122m3344p5566s7z', '7z', { tsumo: true }));
  assert.deepEqual(keys(r).sort(), ['chiitoitsu', 'tsumo']);
  assert.equal(r.fu, 25);
  assert.deepEqual(tsumoValues(r.base, false), { dealer: 1600, other: 800 });
});

test('ryanpeikou beats chiitoi', () => {
  const r = evaluate(ctx('112233m445566p7p', '7p'));
  assert.ok(keys(r).includes('ryanpeikou'));
});

test('yakuhai + honitsu open, fu', () => {
  const r = evaluate(ctx('123m456m9m', '9m', { melds: [['pon', '777z'], ['pon', '111z']], seatWind: 27, roundWind: 27 }));
  // chun, double east triplet, honitsu open 2 -> 5 han mangan
  assert.equal(r.han, 1 + 2 + 2);
  assert.equal(ronValue(r.base, true), 12000);
});

test('kokushi and suuankou', () => {
  const k = evaluate(ctx('19m19p19s1234567z', '1z'));
  assert.equal(k.yakuman, 1);
  const s = evaluate(ctx('111m222p333s4445z', '5z', { tsumo: true }));
  assert.deepEqual(s.yakumanKeys, ['suuankou']);
  // ron on shanpon: sanankou + toitoi only
  const s2 = evaluate(ctx('111m222p333s44z55z', '5z'));
  assert.equal(s2.yakuman, 0);
  assert.ok(keys(s2).includes('sanankou'));
  assert.ok(keys(s2).includes('toitoi'));
});

test('kanchan vs ryanmen choose best', () => {
  // 3445m can be read 345+4 wait? Hand 234m 456m pair 55? choose max fu
  const r = evaluate(ctx('1355m456p789s333z', '2m', { riichi: 1 }));
  assert.ok(r);
  assert.equal(r.fu, 40); // closed ron 30 + kanchan 2 + honor ankou 8 = 40
});

test('parseTypes', () => {
  assert.deepEqual(parseTypes('0m'), [4]);
});
