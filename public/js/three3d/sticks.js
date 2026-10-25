// Point sticks in the drawer: how many of each, and how they lie.
// Plain numbers, no three.js, so the tests can check them.

export const STICK = { len: 2.55, wide: 0.32, thick: 0.06 };
export const VALUES = [10000, 5000, 1000, 100];
// compartment widths, left to right in VALUES order: the 100s, the most
// numerous, get the widest one
export const COMPARTMENTS = [2.3, 1.4, 1.9, 3.0];
// the narrowest strip of a stick that stays in sight under the ones on it
export const MIN_SHOWN = 0.11;

// Sticks like a real tray, which starts as 1 x 10000, 2 x 5000, 4 x 1000
// and 10 x 100 (25000) and pays and takes in change: the hundreds are the
// score's hundreds (ten more when they run low), the thousands the rest up to
// a 5000, two 5000s kept as long as there is a 10000 to break, and the rest
// in 10000s. Returns the counts in VALUES order; they always add up to the
// score (rounded to 100, nothing below zero).
export function stickCounts(score) {
  let r = Math.max(0, Math.round(score / 100) * 100);
  let n100 = (r % 1000) / 100;
  if (n100 < 5 && r >= 1000) n100 += 10;
  r -= n100 * 100;
  const n1k = (r % 5000) / 1000;
  r -= n1k * 1000;
  let n5k = (r % 10000) / 5000;
  if (n5k === 0 && r >= 10000) n5k = 2;
  r -= n5k * 5000;
  return [r / 10000, n5k, n1k, n100];
}

// The honba counters on the table are 100 sticks the dealer took out of
// their own tray: their score does not change, so their tray holds that
// much less (each stick is either on the table or in the tray, never both).
export function trayScore(score, honbaOnTable) {
  return Math.max(0, score - honbaOnTable * 100);
}

// Riichi deposits waiting for the next win that were made in earlier hands:
// the pot (kyoutaku) less this hand's riichi sticks, which lie in front of
// their players. They are already taken off the scores.
export function carriedDeposits(v) {
  if (v.phase === 'end') return 0;
  return Math.max(0, (v.kyoutaku || 0) - v.players.filter((p) => p.riichi).length);
}

// small seeded random, so the same score always lies the same way
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n sticks dropped into a compartment `width` wide, in one to three small
// heaps. In a heap the first stick lies flat and each next one lies over the
// one before it, leaning on it like books on a shelf, so every stick keeps a
// strip in sight and the heap takes little room. The spacing, the heaps,
// which way each heap leans and a little turn of each stick are random.
// Returns [{ x, y, z, yaw, roll, shown }] (centre of the stick, y from the
// floor of the compartment; roll > 0 raises its left edge; shown = width of
// the strip in sight, seen from above).
export function pileLayout(n, width, seed) {
  if (n <= 0) return [];
  const rand = random(seed);
  const { wide, thick } = STICK;
  const room = width - wide - 0.08; // span of the centres
  // the step between two sticks of a heap: as loose as the room allows
  const loose = n > 1 ? room / (n - 1) : 0;
  // (up to three quarters of a stick in sight: the centre dot of a 1000 shows)
  const step = Math.max(MIN_SHOWN, Math.min(wide * 0.75, loose));
  // the free room splits the run into heaps with gaps between them; a new
  // heap starts a whole stick width (plus the gap) after the last one
  const spare = Math.max(0, room - step * (n - 1));
  const extra = wide - step; // what a heap's first stick takes beyond a step
  const most = Math.min(3, Math.floor(n / 3), 1 + Math.floor(spare / (extra + 0.08)));
  const heaps = most > 1 ? 1 + Math.floor(rand() * most) : 1;
  const starts = new Set([0]);
  while (starts.size < heaps) starts.add(1 + Math.floor(rand() * (n - 1)));
  const gap = heaps > 1 ? Math.min(wide, spare / (heaps - 1) - extra) : 0;
  // the steps only ever shrink a little, so the run never outgrows the room
  const jitter = Math.min(step - MIN_SHOWN, 0.03);
  // left to right, every heap leaning right (each stick on the one at its left)
  const out = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const first = starts.has(i);
    if (i > 0) x += first ? wide + gap * (0.6 + rand() * 0.4) : step - rand() * jitter;
    out.push({ x, first });
  }
  for (let i = 0; i < n; i++) {
    const s = out[i];
    const next = out[i + 1];
    s.shown = next && !next.first ? next.x - s.x : wide;
    // leaning on the stick before: tilted so it clears that stick's top
    const d = s.first ? 0 : s.x - out[i - 1].x;
    const roll = s.first ? 0 : Math.asin(Math.min(0.75, thick / Math.max(d, 0.01)));
    s.roll = roll;
    s.y = s.first ? thick / 2 : (wide / 2) * Math.sin(roll) + (thick / 2) * Math.cos(roll) + 0.005;
    s.z = (rand() * 2 - 1) * 0.05;
    s.yaw = (rand() * 2 - 1) * 0.04;
  }
  // some heaps lean the other way: mirror them in place
  let a = 0;
  while (a < n) {
    let b = a + 1;
    while (b < n && !out[b].first) b++;
    if (rand() < 0.5) {
      const lo = out[a].x;
      const hi = out[b - 1].x;
      const xs = out.slice(a, b).map((s) => lo + hi - s.x).reverse();
      const shown = out.slice(a, b).map((s) => s.shown).reverse();
      const heap = out.slice(a, b).reverse();
      heap.forEach((s, k) => {
        out[a + k] = { ...s, x: xs[k], roll: -s.roll, shown: shown[k], first: k === heap.length - 1 };
      });
    }
    a = b;
  }
  // centre the whole run in the compartment
  const shift = -x / 2;
  return out.map(({ first, ...s }) => ({ ...s, x: s.x + shift }));
}
