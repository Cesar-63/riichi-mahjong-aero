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
import { STYLES } from './styles.js';
import { play } from './match.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const first = Number(opt('desde', 1));
const count = Number(opt('cantidad', 200));
const out = opt('salida', 'exhibicion');
mkdirSync(out, { recursive: true });

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
