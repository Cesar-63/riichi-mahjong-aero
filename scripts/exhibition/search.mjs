// Plays seeded bot games with the four exhibition styles and looks for the
// match to show: one with a yakuman, and among those the most entertaining
// (lead changes, big hands, a close finish). Ordinary walls only: never the
// engine's "always a yakuman" wall.
//
// Usage: node scripts/exhibition/search.mjs [options]
//   --desde 1          first seed
//   --cantidad 200     how many games
//   --salida dir       where to write summary.jsonl and the yakuman games
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../../server/engine/game.js';
import { majiangAction } from '../../server/engine/majiang-bot.js';
import { STYLES, STYLE_IDS, styleAction } from './styles.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const first = Number(opt('desde', 1));
const count = Number(opt('cantidad', 200));
const out = opt('salida', 'exhibicion');
mkdirSync(out, { recursive: true });

export const RULES = { rounds: 2 }; // hanchan; the rest is the engine's default (25000/30000, uma 20/10/-10/-20)

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which style sits where also comes from the seed.
function seating(seed) {
  const rnd = mulberry32(seed ^ 0x5eed);
  const s = [...STYLE_IDS];
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

function kyokuName(s) {
  return `${'ESWN'[s.round]}${s.kyokuNum + 1}-${s.honba}`;
}

function play(seed) {
  const styles = seating(seed);
  const g = Game.create(styles.map((id) => STYLES[id].name), RULES, mulberry32(seed));
  const kyokus = [];
  let fallbacks = 0;
  let recorded = null;
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    if (steps > 20000) throw new Error(`seed ${seed}: the game does not end`);
    const seat = g.pendingSeats()[0];
    if (g.s.phase === 'result') {
      // every seat acknowledges the result: record the hand only once
      if (recorded === g.s.k) {
        g.act(seat, { type: 'ok' });
        continue;
      }
      recorded = g.s.k;
      const r = g.s.result;
      kyokus.push({
        name: kyokuName(g.s),
        type: r.type,
        reason: r.reason,
        wins: (r.wins || []).map((w) => ({
          seat: w.seat, from: w.from, tsumo: w.tsumo, han: w.han, fu: w.fu,
          yakuman: w.yakuman, label: w.label, points: w.handPoints, yaku: w.yaku,
        })),
        scores: r.scores,
        mjai: g.s.k.mjai.slice(),
      });
      g.act(seat, { type: 'ok' });
      continue;
    }
    let a = styleAction(styles[seat], g, seat);
    try {
      g.act(seat, a);
    } catch {
      // a style rule asked for something the engine refuses: plain majiang-ai
      fallbacks++;
      a = majiangAction(g, seat);
      g.act(seat, a);
    }
  }
  return { seed, styles, kyokus, final: g.s.final, fallbacks };
}

function leaderOf(scores) {
  return scores.indexOf(Math.max(...scores));
}

function summarize(game, ms) {
  const yakuman = [];
  const big = [];
  let leadChanges = 0;
  let leader = null;
  for (const k of game.kyokus) {
    for (const w of k.wins) {
      if (w.yakuman) yakuman.push({ kyoku: k.name, style: game.styles[w.seat], label: w.label, yaku: w.yaku });
      else if (w.label) big.push({ kyoku: k.name, style: game.styles[w.seat], label: w.label });
    }
    const l = leaderOf(k.scores);
    if (leader !== null && l !== leader) leadChanges++;
    leader = l;
  }
  const finals = [...game.final].sort((a, b) => b.score - a.score);
  const gap = finals[0].score - finals[1].score;
  const fun = leadChanges * 2 + big.length + (gap < 8000 ? 3 : 0) + (game.kyokus.length > 8 ? 1 : 0);
  return {
    seed: game.seed,
    styles: game.styles,
    hands: game.kyokus.length,
    yakuman,
    big,
    leadChanges,
    gap,
    final: game.final.map((f) => f.score),
    fun,
    fallbacks: game.fallbacks,
    ms,
  };
}

const t0 = Date.now();
const found = [];
for (let seed = first; seed < first + count; seed++) {
  const start = Date.now();
  const game = play(seed);
  const sum = summarize(game, Date.now() - start);
  appendFileSync(join(out, 'summary.jsonl'), `${JSON.stringify(sum)}\n`);
  if (sum.yakuman.length) {
    found.push(sum);
    writeFileSync(join(out, `partida-${seed}.json`), JSON.stringify(game));
  }
  const y = sum.yakuman.map((x) => `${x.label} (${STYLES[x.style].name})`).join(', ');
  console.log(`seed ${seed}: ${sum.hands} manos, ${sum.ms} ms${y ? `  ★ ${y}` : ''}`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`\n${count} partidas en ${secs.toFixed(0)} s; con yakuman: ${found.length}`);
for (const f of found.sort((a, b) => b.fun - a.fun)) {
  console.log(`  seed ${f.seed}: entretención ${f.fun}, ${f.leadChanges} cambios de líder, diferencia final ${f.gap}`);
}
