// Dumps whole seeded games of the engine as test cases for another engine
// (the own AI's, see docs/ai/ROADMAP.md, stage A): every mjai event, the
// legal options of every seat at every decision, the action taken, each
// hand's result and the final ranking. Tiles and actions are in mjai
// notation, so nothing depends on this engine's tile ids.
//
// Usage: npm run ai:fixtures -- [--games 100] [--seed 1] [--out fixtures/ai] [--style rare]
// Writes one JSON-lines file per game: game-<seed>.jsonl. Even seeds play a
// hanchan, odd ones a tonpuusen. Other styles provoke the rules random play
// hardly reaches:
//   rare     always riichi, kans and calls; terminals and honors go first
//            (nagashi, four kans)
//   closed   never calls, always riichi, winds go first (four riichi, four
//            winds, triple ron)
//   honors   keeps honors and calls only them (pao, big dragons and winds) Lines, by their `k`:
//   start   { seed, rules }
//   event   { e }                 one mjai event, hands and draws visible
//   options { seats: { seat: … } } what every seat that must decide may do
//   act     { seat, action }      the action taken (one seat at a time)
//   kyoku   { result }            how the hand ended, points and scores
//   end     { final }             ranking and final points
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Game } from '../server/engine/game.js';
import { shanten } from '../server/engine/hand.js';
import { mjaiTile } from '../server/engine/mjai.js';
import { counts34, sortTiles, isYaochuu, tileType } from '../public/js/shared/tiles.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = (ids) => sortTiles(ids).map(mjaiTile);
const uniq = (list) => [...new Set(list)];
// a tile type as the name of its plain (not red) tile
const typeName = (t) => mjaiTile(t * 4 + 1);

// A seat's legal options, without tile ids.
function plainOptions(o) {
  if (o.kind === 'turn') {
    return {
      kind: 'turn',
      discard: uniq(names(o.discard)),
      riichi: uniq(names(o.riichi)),
      tsumo: o.tsumo,
      ankan: o.ankan.map(typeName),
      kakan: o.kakan.map(typeName),
      kyuushu: o.kyuushu,
    };
  }
  return {
    kind: 'response',
    tile: mjaiTile(o.tile),
    from: o.from,
    ron: !!o.ron,
    pon: (o.pon || []).map(names),
    chi: (o.chi || []).map((c) => names(c.tiles)),
    minkan: !!o.minkan,
  };
}

function plainAction(a) {
  if (a.tile !== undefined) return { type: a.type, pai: mjaiTile(a.tile) };
  if (a.t !== undefined) return { type: a.type, pai: typeName(a.t) };
  if (a.tiles) return { type: a.type, consumed: names(a.tiles) };
  return { type: a.type };
}

function plainResult(r) {
  const out = {
    type: r.type,
    deltas: r.deltas,
    scores: r.scores,
    renchan: r.renchan,
    gameEnds: r.gameEnds,
  };
  if (r.type === 'draw') {
    out.reason = r.reason;
    out.tenpai = r.tenpai;
    if (r.nagashi) out.nagashi = r.nagashi;
  } else {
    out.wins = r.wins.map((w) => ({
      seat: w.seat,
      from: w.from,
      tsumo: w.tsumo,
      winTile: mjaiTile(w.winTile),
      yaku: w.yaku,
      han: w.han,
      fu: w.fu,
      yakuman: w.yakuman,
      points: w.points,
      pao: w.pao,
    }));
  }
  return out;
}

// Random but hand-minded play, as in test/mjai.test.js: enough wins, calls,
// kans, riichi and draws to visit the rules.
function choose(g, seat, o, rng, style) {
  if (style === 'rare') return chooseRare(g, seat, o, rng);
  if (style === 'closed') return chooseClosed(g, seat, o, rng);
  if (style === 'honors') return chooseHonors(g, seat, o, rng);
  if (o.kind === 'turn') {
    if (o.tsumo && rng() < 0.9) return { type: 'tsumo' };
    if (o.riichi.length && rng() < 0.6) return { type: 'riichi', tile: o.riichi[Math.floor(rng() * o.riichi.length)] };
    if (o.ankan.length && rng() < 0.5) return { type: 'ankan', t: o.ankan[0] };
    if (o.kakan.length && rng() < 0.5) return { type: 'kakan', t: o.kakan[0] };
    if (o.kyuushu && rng() < 0.3) return { type: 'kyuushu' };
    const hand = g.s.k.hands[seat];
    const melds = g.s.k.melds[seat].length;
    const score = (id) => shanten(counts34(hand.filter((x) => x !== id)), melds) + rng() * 1.5;
    return { type: 'discard', tile: o.discard.reduce((b, id) => (score(id) < score(b) ? id : b)) };
  }
  if (o.ron && rng() < 0.9) return { type: 'ron' };
  if (o.minkan && rng() < 0.3) return { type: 'minkan' };
  if (o.pon && rng() < 0.2) return { type: 'pon', tiles: o.pon[Math.floor(rng() * o.pon.length)] };
  if (o.chi && rng() < 0.15) return { type: 'chi', tiles: o.chi[Math.floor(rng() * o.chi.length)].tiles };
  return { type: 'pass' };
}

// Greedy for riichi, kans and calls; terminals and honors go first.
function chooseRare(g, seat, o, rng) {
  const pickOne = (list) => list[Math.floor(rng() * list.length)];
  if (o.kind === 'turn') {
    if (o.tsumo) return { type: 'tsumo' };
    if (o.kyuushu && rng() < 0.5) return { type: 'kyuushu' };
    if (o.ankan.length) return { type: 'ankan', t: o.ankan[0] };
    if (o.kakan.length) return { type: 'kakan', t: o.kakan[0] };
    if (o.riichi.length) return { type: 'riichi', tile: pickOne(o.riichi) };
    const ends = o.discard.filter((id) => isYaochuu(tileType(id)));
    return { type: 'discard', tile: pickOne(ends.length ? ends : o.discard) };
  }
  if (o.ron) return { type: 'ron' };
  if (o.minkan) return { type: 'minkan' };
  if (o.pon) return { type: 'pon', tiles: pickOne(o.pon) };
  if (o.chi && rng() < 0.3) return { type: 'chi', tiles: pickOne(o.chi).tiles };
  return { type: 'pass' };
}

// Never calls; riichi whenever it can; winds first, then terminals.
function chooseClosed(g, seat, o, rng) {
  const pickOne = (list) => list[Math.floor(rng() * list.length)];
  if (o.kind === 'turn') {
    if (o.tsumo) return { type: 'tsumo' };
    if (o.riichi.length) return { type: 'riichi', tile: pickOne(o.riichi) };
    const winds = o.discard.filter((id) => tileType(id) >= 27 && tileType(id) <= 30);
    if (winds.length) return { type: 'discard', tile: winds[0] };
    const ends = o.discard.filter((id) => isYaochuu(tileType(id)));
    return { type: 'discard', tile: pickOne(ends.length ? ends : o.discard) };
  }
  return o.ron ? { type: 'ron' } : { type: 'pass' };
}

// Keeps honors and calls only them; suited tiles go first.
function chooseHonors(g, seat, o, rng) {
  const pickOne = (list) => list[Math.floor(rng() * list.length)];
  if (o.kind === 'turn') {
    if (o.tsumo) return { type: 'tsumo' };
    if (o.ankan.length) return { type: 'ankan', t: o.ankan[0] };
    if (o.kakan.length) return { type: 'kakan', t: o.kakan[0] };
    const suited = o.discard.filter((id) => tileType(id) < 27);
    return { type: 'discard', tile: pickOne(suited.length ? suited : o.discard) };
  }
  if (o.ron) return { type: 'ron' };
  if (tileType(o.tile) >= 27) {
    if (o.minkan) return { type: 'minkan' };
    if (o.pon) return { type: 'pon', tiles: o.pon[0] };
  }
  return { type: 'pass' };
}

// One whole game as a list of lines (objects).
export function dumpGame(seed, style = 'random') {
  const rng = mulberry32(seed);
  const g = Game.create(['A', 'B', 'C', 'D'], { rounds: seed % 2 === 0 ? 2 : 1 }, rng);
  const lines = [{ k: 'start', seed, rules: g.s.config }];
  let k = g.s.k;
  let sent = 0;
  const flush = () => {
    for (; sent < k.mjai.length; sent++) lines.push({ k: 'event', e: k.mjai[sent] });
  };
  flush();
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    if (steps > 50000) throw new Error(`game ${seed} does not end`);
    const seats = g.pendingSeats();
    if (g.s.phase === 'result') {
      for (const seat of seats) g.act(seat, { type: 'ok' });
    } else {
      const all = {};
      for (const seat of seats) all[seat] = plainOptions(g.view(seat).options);
      lines.push({ k: 'options', seats: all });
      const seat = seats[Math.floor(rng() * seats.length)];
      const a = choose(g, seat, g.view(seat).options, rng, style);
      lines.push({ k: 'act', seat, action: plainAction(a) });
      g.act(seat, a);
      flush();
      if (g.s.phase === 'result') lines.push({ k: 'kyoku', result: plainResult(g.s.result) });
    }
    if (g.s.phase !== 'end' && g.s.k !== k) {
      k = g.s.k;
      sent = 0;
      flush();
    }
  }
  lines.push({ k: 'end', final: g.s.final });
  return lines;
}

function main() {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const games = Number(arg('games', 100));
  const first = Number(arg('seed', 1));
  const out = arg('out', 'fixtures/ai');
  const style = arg('style', 'random');
  mkdirSync(out, { recursive: true });
  const seen = {};
  for (let seed = first; seed < first + games; seed++) {
    const lines = dumpGame(seed, style);
    for (const l of lines) {
      if (l.k === 'event') seen[l.e.type] = (seen[l.e.type] || 0) + 1;
      if (l.k === 'kyoku' && l.result.type === 'draw') seen[`draw:${l.result.reason}`] = (seen[`draw:${l.result.reason}`] || 0) + 1;
    }
    writeFileSync(join(out, `game-${seed}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
  console.log(`${games} games in ${out}`);
  console.log(seen);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
