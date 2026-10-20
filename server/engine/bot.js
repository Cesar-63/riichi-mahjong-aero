// Test-mode bot: always discards the tile it just drew (or the rightmost
// legal tile after a call), calls pon or chi whenever it can, and never wins,
// declares riichi or kans. It honours its teammate's discard request.
export function botAction(game, seat, requested = null) {
  const s = game.s;
  if (s.phase === 'result') return { type: 'ok' };
  const v = game.view(seat);
  const o = v.options;
  if (!o) return null;
  if (o.kind === 'turn') {
    if (requested !== null && o.discard.includes(requested)) return { type: 'discard', tile: requested };
    return { type: 'discard', tile: o.discard.includes(v.drawn) ? v.drawn : o.discard[o.discard.length - 1] };
  }
  if (o.pon) return { type: 'pon', tiles: o.pon[0] };
  if (o.chi) return { type: 'chi', tiles: o.chi[0].tiles };
  return { type: 'pass' };
}
