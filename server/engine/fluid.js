// Fluid wall, first experiment: "always a yakuman". The wall is not fixed
// at the shuffle. The hands are dealt as usual; then the game picks a seat
// at random and the yakuman nearest to its hand, and from then on every
// tile that seat draws (from the live wall or, after a kan, from the dead
// wall) takes it straight there. The others only get a tile the yakuman
// needs when the wall has copies to spare (Game.fluidDraw).
//
// A plan is how a hand reaches a yakuman with the tiles left in the live
// wall: { key, need, keep }. need: the tile types still to draw (one entry
// per tile); keep: how many of each type the finished hand holds in its
// concealed part. Every plan is a hand of triplets and a pair (or the two
// odd shapes, kokushi and chuuren); only the set that daisangen and
// shousuushii leave free may be a sequence. Enough for an experiment.
import { tileType, counts34 } from '../../public/js/shared/tiles.js';

const ALL = Array.from({ length: 34 }, (_, t) => t);
const HONORS = [27, 28, 29, 30, 31, 32, 33];
const WINDS = [27, 28, 29, 30];
const DRAGONS = [31, 32, 33];
const TERMINALS = [0, 8, 9, 17, 18, 26];
const ORPHANS = [...TERMINALS, ...HONORS];
const GREENS = [19, 20, 21, 23, 25, 32]; // 2, 3, 4, 6, 8 of bamboo and the green dragon

// Sets of three and a pair. forced: triplets the yakuman is made of;
// allowed: the types the other sets may be; pairs: the types the pair may
// be; anyMelds: how many calls may be anything (a chi, a pon out of the
// pattern); closed: no open calls at all; run: the one set left over may
// also be a sequence (so a hand that already holds one keeps it).
function setsPlan(have, melds, avail, { forced = [], allowed = ALL, pairs = allowed, anyMelds = 0, closed = false, run = false }) {
  const used = new Set(); // types already taken by a set
  let any = anyMelds;
  const pending = new Set(forced);
  for (const m of melds) {
    if (closed && m.type !== 'ankan') return null;
    const t = tileType(m.tiles[0]);
    if (m.type !== 'chi' && pending.has(t)) pending.delete(t);
    else if (m.type !== 'chi' && allowed.includes(t)) used.add(t);
    else if (any > 0) any--;
    else return null;
    if (m.type !== 'chi') used.add(t);
  }
  const free = 4 - melds.length - pending.size;
  if (free < 0) return null;
  // what a set of n of type t still has to draw (null: the wall cannot give it)
  const cost = (t, n) => {
    const miss = Math.max(0, n - have[t]);
    return miss <= avail[t] ? miss : null;
  };
  let best = null;
  for (const pair of pairs) {
    if (used.has(pair) || pending.has(pair)) continue;
    const pairCost = cost(pair, 2);
    if (pairCost === null) continue;
    const sets = [...pending];
    const rest = allowed
      .filter((t) => t !== pair && !used.has(t) && !pending.has(t) && cost(t, 3) !== null)
      .sort((a, b) => cost(a, 3) - cost(b, 3));
    // the cheapest sequence clear of the pair and of the other sets, if it beats a triplet
    let seq = null;
    if (run && free === 1) {
      for (let t = 0; t < 27; t++) {
        if (t % 9 > 6) continue;
        const types = [t, t + 1, t + 2];
        if (types.some((x) => x === pair || used.has(x) || pending.has(x) || cost(x, 1) === null)) continue;
        const c = types.reduce((n, x) => n + cost(x, 1), 0);
        if (!seq || c < seq.cost) seq = { types, cost: c };
      }
      if (seq && rest.length && cost(rest[0], 3) <= seq.cost) seq = null;
    }
    if (!seq && rest.length < free) continue;
    if (!seq) sets.push(...rest.slice(0, free));
    if (sets.some((t) => cost(t, 3) === null)) continue;
    const total = pairCost + sets.reduce((n, t) => n + cost(t, 3), 0) + (seq ? seq.cost : 0);
    if (best && best.total <= total) continue;
    const keep = new Array(34).fill(0);
    const need = [];
    for (const t of seq ? seq.types : []) {
      keep[t] = 1;
      if (cost(t, 1)) need.push(t);
    }
    for (const t of sets) {
      keep[t] = 3;
      for (let i = cost(t, 3); i > 0; i--) need.push(t);
    }
    keep[pair] = 2;
    for (let i = pairCost; i > 0; i--) need.push(pair);
    best = { total, need, keep };
  }
  return best && { need: best.need, keep: best.keep };
}

// one of each terminal and honor, and a second of any of them
function kokushiPlan(have, melds, avail) {
  if (melds.length) return null;
  const keep = new Array(34).fill(0);
  const need = [];
  for (const t of ORPHANS) {
    keep[t] = 1;
    if (!have[t]) {
      if (!avail[t]) return null;
      need.push(t);
    }
  }
  let pair = ORPHANS.find((t) => have[t] >= 2);
  if (pair === undefined) {
    pair = ORPHANS.find((t) => avail[t] >= (have[t] ? 1 : 2));
    if (pair === undefined) return null;
    need.push(pair);
  }
  keep[pair] = 2;
  return { need, keep };
}

// 1112345678999 of one suit and one more tile of it
function chuurenPlan(have, melds, avail) {
  if (melds.length) return null;
  let best = null;
  for (let suit = 0; suit < 3; suit++) {
    const keep = new Array(34).fill(0);
    const need = [];
    let ok = true;
    let spare = null; // a tile of the suit beyond the shape
    for (let n = 0; n < 9; n++) {
      const t = suit * 9 + n;
      const base = n === 0 || n === 8 ? 3 : 1;
      keep[t] = base;
      const miss = Math.max(0, base - have[t]);
      if (miss > avail[t]) ok = false;
      for (let i = 0; i < miss; i++) need.push(t);
      if (have[t] > base && spare === null) spare = t;
    }
    if (!ok) continue;
    if (spare === null) {
      for (let n = 0; n < 9 && spare === null; n++) {
        const t = suit * 9 + n;
        if (keep[t] < 4 && avail[t] > Math.max(0, keep[t] - have[t])) spare = t;
      }
      if (spare === null) continue;
      need.push(spare);
    }
    keep[spare]++;
    if (!best || need.length < best.need.length) best = { need, keep };
  }
  return best;
}

// in order of preference when two are as near
const PATTERNS = [
  ['kokushi', kokushiPlan],
  ['daisangen', (h, m, a) => setsPlan(h, m, a, { forced: DRAGONS, anyMelds: 1, run: true })],
  ['suuankou', (h, m, a) => setsPlan(h, m, a, { closed: true })],
  ['tsuuiisou', (h, m, a) => setsPlan(h, m, a, { allowed: HONORS })],
  ['daisuushii', (h, m, a) => setsPlan(h, m, a, { forced: WINDS })],
  ['shousuushii', (h, m, a) => {
    let best = null;
    for (const pair of WINDS) {
      const p = setsPlan(h, m, a, { forced: WINDS.filter((w) => w !== pair), pairs: [pair], anyMelds: 1, run: true });
      if (p && (!best || p.need.length < best.need.length)) best = p;
    }
    return best;
  }],
  ['chinroutou', (h, m, a) => setsPlan(h, m, a, { allowed: TERMINALS })],
  ['ryuuiisou', (h, m, a) => setsPlan(h, m, a, { allowed: GREENS })],
  ['chuuren', chuurenPlan],
];

// The nearest yakuman for a hand (concealed tile ids), its calls and the
// live wall (tile ids); null when none can be reached.
export function nearestYakuman(hand, melds, wall) {
  const have = counts34(hand);
  const avail = counts34(wall);
  let best = null;
  for (const [key, plan] of PATTERNS) {
    const p = plan(have, melds, avail);
    if (p && (!best || p.need.length < best.need.length)) best = { key, ...p };
  }
  return best;
}

// The way to one given yakuman (the one picked at the deal). If the
// player's calls have made it impossible, the plan is the one for the
// concealed tiles alone, so the wall keeps bringing that yakuman's tiles
// all the same.
export function yakumanPlan(key, hand, melds, wall) {
  const entry = PATTERNS.find(([k]) => k === key);
  if (!entry) return null;
  const have = counts34(hand);
  const avail = counts34(wall);
  const p = entry[1](have, melds, avail) || (melds.length ? entry[1](have, [], avail) : null);
  return p && { key, ...p };
}

// The tile a bot on the plan throws away: one the finished hand has no
// room for (null: nothing to spare).
export function spareTile(hand, keep) {
  const seen = new Array(34).fill(0);
  let spare = null;
  for (const id of hand) {
    const t = tileType(id);
    if (++seen[t] > keep[t]) spare = id;
  }
  return spare;
}
