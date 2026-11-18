// One exhibition match: four bots with the four styles, a hanchan from a
// seed. Shared by search.mjs (which looks for the match to show) and
// scenes.mjs (which turns the chosen one into lab scenes), so both play
// exactly the same game.
import { Game } from '../../server/engine/game.js';
import { majiangAction } from '../../server/engine/majiang-bot.js';
import { STYLES, STYLE_IDS, styleAction } from './styles.js';

export const RULES = { rounds: 2 }; // hanchan; the rest is the engine's default (25000/30000, uma 20/10/-10/-20)

// Who plays each style at the exhibition table (characters.js ids).
export const CAST = { base: 'momo', aggressive: 'kaito', defensive: 'shiro', fast: 'michihime' };

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which style sits where also comes from the seed.
export function seating(seed) {
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

// Plays the match. names: the table's names (the styles' by default).
// onKyoku(game), when given, is called as each hand starts, before its
// first move; onAct(game, seat, action) after every move that reaches the
// engine (the acknowledgements of a result are not moves).
export function play(seed, { names = null, onKyoku = null, onAct = null } = {}) {
  const styles = seating(seed);
  const g = Game.create(names || styles.map((id) => STYLES[id].name), RULES, mulberry32(seed));
  const kyokus = [];
  let fallbacks = 0;
  let recorded = null;
  let started = null;
  for (let steps = 0; g.s.phase !== 'end'; steps++) {
    if (steps > 20000) throw new Error(`seed ${seed}: the game does not end`);
    if (g.s.phase !== 'result' && started !== g.s.k) {
      started = g.s.k;
      if (onKyoku) onKyoku(g);
    }
    const seat = g.pendingSeats()[0];
    if (g.s.phase === 'result') {
      // every seat acknowledges the result: record the hand only once
      if (recorded !== g.s.k) {
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
      }
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
    if (onAct) onAct(g, seat, a);
  }
  return { seed, styles, kyokus, final: g.s.final, fallbacks };
}
