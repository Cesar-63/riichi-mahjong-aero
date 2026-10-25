// Bots play with majiang-ai (see majiang-bot.js). They honour their
// teammate's discard request whenever they would discard anyway, and fall
// back to a plain safe move if the AI ever fails or answers something illegal.
import { majiangAction } from './majiang-bot.js';

export function botAction(game, seat, requested = null) {
  const s = game.s;
  if (s.phase === 'result') return { type: 'ok' };
  const v = game.view(seat);
  const o = v.options;
  if (!o) return null;
  let a = null;
  try {
    a = majiangAction(game, seat);
  } catch (e) {
    console.error('bot brain failed', e);
  }
  if (o.kind === 'turn') {
    const discarding = !a || a.type === 'discard' || a.type === 'riichi';
    if (discarding && requested !== null && o.discard.includes(requested)) return { type: 'discard', tile: requested };
    return a || { type: 'discard', tile: o.discard.includes(v.drawn) ? v.drawn : o.discard[o.discard.length - 1] };
  }
  return a || { type: 'pass' };
}
