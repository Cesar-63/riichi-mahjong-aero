// Bots come in two levels. Normal ones play with majiang-ai (majiang-bot.js);
// hard ones with Mortal (mortal/), loaded only when a hard bot plays, and
// fall back to majiang-ai if it fails. Both honour their teammate's discard
// request whenever they would discard anyway, and fall back to a plain safe
// move if the AI ever answers something illegal.
import { majiangAction } from './majiang-bot.js';

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

export async function botAction(game, seat, requested = null, level = 'normal') {
  const s = game.s;
  if (s.phase === 'result') return { type: 'ok' };
  const v = game.view(seat);
  const o = v.options;
  if (!o) return null;
  let a = level === 'hard' ? await hardAction(game, seat) : null;
  if (!a) {
    try {
      a = majiangAction(game, seat);
    } catch (e) {
      console.error('bot brain failed', e);
    }
  }
  if (o.kind === 'turn') {
    const discarding = !a || a.type === 'discard' || a.type === 'riichi';
    if (discarding && requested !== null && o.discard.includes(requested)) return { type: 'discard', tile: requested };
    return a || { type: 'discard', tile: o.discard.includes(v.drawn) ? v.drawn : o.discard[o.discard.length - 1] };
  }
  return a || { type: 'pass' };
}
