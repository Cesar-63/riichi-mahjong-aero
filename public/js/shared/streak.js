// A player's streak (the server counts it: Game.updateStreaks) and what it
// brings to the table. A streak shows from STREAK_FROM in a row, with the
// first climate; each one more brings the next, and the last one stays.
export const STREAK_FROM = 2;
export const STREAK_CLIMATES = ['cielo', 'mar', 'fuego'];

// The climate of a streak: 'cielo', 'mar', 'fuego' or null (no streak yet).
export function climateOf(streak) {
  if (!(streak >= STREAK_FROM)) return null;
  return STREAK_CLIMATES[Math.min(streak - STREAK_FROM, STREAK_CLIMATES.length - 1)];
}
