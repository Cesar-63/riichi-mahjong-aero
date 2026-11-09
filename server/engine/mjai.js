// mjai notation: the event format shared by Mortal, akochan and mjai-reviewer.
// Each kyoku keeps its full event log in `k.mjai` (see Game); bots read the
// log from their own seat's point of view.
import { tileType, isAka } from '../../public/js/shared/tiles.js';

const HONORS = ['E', 'S', 'W', 'N', 'P', 'F', 'C'];
const SUITS = 'mps';

// Tile id (0..135) -> mjai name: 1m..9m, 1p.., 1s.., 5mr/5pr/5sr, E S W N P F C.
export function mjaiTile(id) {
  const t = tileType(id);
  if (t >= 27) return HONORS[t - 27];
  return `${(t % 9) + 1}${SUITS[Math.floor(t / 9)]}${isAka(id) ? 'r' : ''}`;
}

// Tile type (0..33) of a mjai name; red fives count as fives.
export function mjaiType(name) {
  const h = HONORS.indexOf(name);
  if (h >= 0) return 27 + h;
  return SUITS.indexOf(name[1]) * 9 + Number(name[0]) - 1;
}

export const mjaiWind = (round) => HONORS[round];

// What a seat may know: the other players' starting hands and draws are hidden.
export function mjaiView(log, seat) {
  return log.map((e) => {
    if (e.type === 'start_kyoku') {
      return { ...e, tehais: e.tehais.map((h, i) => (i === seat ? h : h.map(() => '?'))) };
    }
    if (e.type === 'tsumo' && e.actor !== seat) return { ...e, pai: '?' };
    return e;
  });
}
