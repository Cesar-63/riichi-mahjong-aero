// Four playing styles for the bot exhibition match. Each one is a thin layer
// of simple, visible rules over majiang-ai (majiangAction), so a viewer can
// tell the bots apart. They only read what their seat could see: their own
// hand and the public table (rivers, melds, riichi declarations).
import { majiangAction } from '../../server/engine/majiang-bot.js';
import { shanten } from '../../server/engine/hand.js';
import { tileType, counts34, isYaochuu, isHonor, isTerminal } from '../../public/js/shared/tiles.js';

export const STYLES = {
  base: { name: 'Base', about: 'majiang-ai tal cual' },
  aggressive: { name: 'Agresivo', about: 'Declara riichi siempre que puede y llama pon de yakuhai' },
  defensive: { name: 'Defensivo', about: 'Ante un riichi rival, sin estar en tenpai, descarta lo más seguro; nunca llama' },
  fast: { name: 'Rápido', about: 'Llama chi y pon de fichas simples para ir a tanyao abierto' },
};

export const STYLE_IDS = Object.keys(STYLES);

const isSimple = (t) => !isYaochuu(t);

function yakuhai(game, seat) {
  return new Set([31, 32, 33, game.seatWind(seat), 27 + game.s.round]);
}

// --------------------------------------------------------------- aggressive

function aggressive(game, seat, a) {
  const o = game.view(seat).options;
  if (o.kind === 'turn') {
    // dama is for the timid: if the chosen discard can be a riichi, it is one
    if (a.type === 'discard' && o.riichi.includes(a.tile)) return { type: 'riichi', tile: a.tile };
    return a;
  }
  if (a.type === 'ron' || !o.pon) return a;
  const t = tileType(game.s.k.pending.tile);
  if (yakuhai(game, seat).has(t)) return { type: 'pon', tiles: o.pon[0] };
  return a;
}

// ---------------------------------------------------------------- defensive

// How dangerous a tile type is against the riichi seats: 0 is a tile in all
// their rivers (genbutsu); then honors with many copies already visible,
// terminals, 2 and 8, and the middle tiles last.
function danger(game, seat, t, riichiSeats) {
  const k = game.s.k;
  const inRiver = (x) => k.discards[x].some((d) => tileType(d.tile) === t);
  if (riichiSeats.every(inRiver)) return 0;
  let visible = k.hands[seat].filter((id) => tileType(id) === t).length;
  for (let x = 0; x < 4; x++) {
    visible += k.discards[x].filter((d) => tileType(d.tile) === t).length;
    for (const m of k.melds[x]) visible += m.tiles.filter((id) => tileType(id) === t).length;
  }
  if (isHonor(t)) return 1 + Math.max(0, 3 - visible);
  if (isTerminal(t)) return 5;
  const n = (t % 9) + 1;
  return n === 2 || n === 8 ? 6 : 7;
}

function defensive(game, seat, a) {
  const o = game.view(seat).options;
  const k = game.s.k;
  if (o.kind !== 'turn') return a.type === 'ron' ? a : { type: 'pass' };
  if (a.type !== 'discard' || k.riichi[seat]) return a;
  const riichiSeats = [0, 1, 2, 3].filter((x) => x !== seat && k.riichi[x]);
  if (!riichiSeats.length) return a;
  // still pushes with a ready hand: only folds when the discard leaves it not tenpai
  const after = k.hands[seat].filter((id) => id !== a.tile);
  if (shanten(counts34(after), k.melds[seat].length) <= 0) return a;
  let best = a.tile;
  let bestDanger = danger(game, seat, tileType(a.tile), riichiSeats);
  for (const id of o.discard) {
    const d = danger(game, seat, tileType(id), riichiSeats);
    if (d < bestDanger) {
      best = id;
      bestDanger = d;
    }
  }
  return { type: 'discard', tile: best };
}

// --------------------------------------------------------------------- fast

function openTanyaoPossible(game, seat) {
  return game.s.k.melds[seat].every((m) => m.tiles.every((id) => isSimple(tileType(id))));
}

function fast(game, seat, a) {
  const o = game.view(seat).options;
  const k = game.s.k;
  const hand = k.hands[seat];
  const melds = k.melds[seat].length;
  if (o.kind === 'turn') {
    // once open, the terminals and honors go first
    if (a.type !== 'discard' || !melds || !openTanyaoPossible(game, seat)) return a;
    if (!isSimple(tileType(a.tile))) return a;
    const junk = o.discard.find((id) => !isSimple(tileType(id)));
    return junk === undefined ? a : { type: 'discard', tile: junk };
  }
  if (a.type !== 'pass' || !openTanyaoPossible(game, seat)) return a;
  const called = k.pending.tile;
  if (!isSimple(tileType(called))) return a;
  const before = shanten(counts34(hand), melds);
  const options = [
    ...(o.pon || []).map((tiles) => ({ type: 'pon', tiles })),
    ...(o.chi || []).map((c) => ({ type: 'chi', tiles: c.tiles })),
  ];
  for (const call of options) {
    if (!call.tiles.every((id) => isSimple(tileType(id)))) continue;
    const rest = hand.filter((id) => !call.tiles.includes(id));
    if (rest.filter((id) => !isSimple(tileType(id))).length > 2) continue;
    if (shanten(counts34(rest), melds + 1) < before) return call;
  }
  return a;
}

const LAYERS = { base: (game, seat, a) => a, aggressive, defensive, fast };

// The move of `style` for `seat`; null when majiang-ai has no legal answer.
export function styleAction(style, game, seat) {
  const a = majiangAction(game, seat);
  if (!a) return null;
  return LAYERS[style](game, seat, a);
}
