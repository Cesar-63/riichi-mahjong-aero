// Bots come in two levels. Normal ones play with majiang-ai (majiang-bot.js);
// hard ones with Mortal (mortal/), loaded only when a hard bot plays, and
// fall back to majiang-ai if it fails. Both honour their teammate's discard
// request whenever they would discard anyway and keep quiet (no riichi, the
// same discard) when the teammate said "no riichi", and fall back to a plain
// safe move if the AI ever answers something illegal.
import { majiangAction } from './majiang-bot.js';
import { spareTile } from './fluid.js';

export const LEVELS = ['normal', 'hard'];

async function hardAction(game, seat) {
  try {
    const { mortalAction } = await import('./mortal/mortal-bot.js');
    return await mortalAction(game, seat);
  } catch (e) {
    console.error('hard bot failed', e);
    return null;
  }
}

export async function botAction(game, seat, requested = null, level = 'normal', noRiichi = false) {
  const s = game.s;
  if (s.phase === 'result') return { type: 'ok' };
  const v = game.view(seat);
  const o = v.options;
  if (!o) return null;
  // Fluid wall: the bot the wall feeds goes along with it. It keeps what
  // the yakuman needs, throws the rest away, calls nothing and wins only
  // by drawing the last tile.
  const f = game.k.fluid;
  if (f && f.seat === seat && f.keep) {
    if (o.kind !== 'turn') return { type: 'pass' };
    if (o.tsumo && f.need.length === 0) return { type: 'tsumo' };
    const spare = spareTile(game.k.hands[seat], f.keep);
    if (spare !== null && o.discard.includes(spare)) return { type: 'discard', tile: spare };
  }
  let a = level === 'hard' ? await hardAction(game, seat) : null;
  if (!a) {
    try {
      a = majiangAction(game, seat);
    } catch (e) {
      console.error('bot brain failed', e);
    }
  }
  if (o.kind === 'turn') {
    // told not to riichi: the same tile goes out without the declaration (dama)
    if (noRiichi && a && a.type === 'riichi') a = { type: 'discard', tile: a.tile };
    const discarding = !a || a.type === 'discard' || a.type === 'riichi';
    if (discarding && requested !== null && o.discard.includes(requested)) return { type: 'discard', tile: requested };
    return a || { type: 'discard', tile: o.discard.includes(v.drawn) ? v.drawn : o.discard[o.discard.length - 1] };
  }
  return a || { type: 'pass' };
}
