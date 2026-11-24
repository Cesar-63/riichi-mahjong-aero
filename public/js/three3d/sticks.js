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

// ------------------------------------------------------ the player's tray
// The player may arrange their own tray (#30): which compartment holds each
// group of sticks (the order, remembered as a preference) and single sticks
// moved by hand (they last the hand). The widths travel with the groups.
export const TRAY_WALL = 0.12;
const WIDTH = Object.fromEntries(VALUES.map((v, i) => [v, COMPARTMENTS[i]]));
export const TRAY_W = COMPARTMENTS.reduce((a, b) => a + b);
// how far from the middle (front to back) a stick may lie in the tray
export const TRAY_Z = 0.1;

// The order if it is one (every value once), otherwise the usual one.
export function trayOrder(order) {
  return Array.isArray(order) && order.length === VALUES.length && VALUES.every((v) => order.includes(v)) ? order.slice() : VALUES.slice();
}

// The compartments left to right for an order: [{ value, left, right, centre }].
export function trayCompartments(order) {
  let left = -TRAY_W / 2;
  return trayOrder(order).map((value) => {
    const c = { value, left, right: left + WIDTH[value] };
    c.centre = (c.left + c.right) / 2;
    left = c.right;
    return c;
  });
}

// The index of the compartment under x (the nearest one when outside).
export function compartmentAt(order, x) {
  const comps = trayCompartments(order);
  const i = comps.findIndex((c) => x < c.right);
  return i < 0 ? comps.length - 1 : i;
}

// A group taken to compartment `to`: it trades places with the one there.
export function moveGroup(order, value, to) {
  const out = trayOrder(order);
  const from = out.indexOf(value);
  if (from < 0 || to < 0 || to >= out.length) return out;
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

// Where a stick put down by hand at x ends up: inside a compartment, clear of
// the walls between them (it never lies across one).
export function snapToTray(order, x, z = 0) {
  const c = trayCompartments(order)[compartmentAt(order, x)];
  const lo = c.left + TRAY_WALL + STICK.wide / 2;
  const hi = c.right - TRAY_WALL - STICK.wide / 2;
  return { x: Math.min(hi, Math.max(lo, x)), z: Math.min(TRAY_Z, Math.max(-TRAY_Z, z)) };
}

// Every stick of the score in the arranged tray: [{ value, x, y, z, yaw,
// roll, moved }] in tray coordinates (y from its floor). `moved` is the
// index in arrangement.moved of a stick put down by hand, -1 for the ones in
// the heaps. When the score changes, the heaps give and take first; a group
// with fewer sticks than were moved by hand keeps the first ones moved.
// A stick put down by hand lies flat on whatever is under it.
export function trayLayout(score, arrangement = {}, seed = 0) {
  const order = trayOrder(arrangement.order);
  const counts = stickCounts(score);
  const left = Object.fromEntries(VALUES.map((v, i) => [v, counts[i]]));
  const moved = [];
  (arrangement.moved || []).forEach((m, i) => {
    if (left[m.value] > 0) {
      left[m.value]--;
      moved.push({ ...m, i });
    }
  });
  const out = [];
  for (const c of trayCompartments(order)) {
    const k = VALUES.indexOf(c.value);
    for (const s of pileLayout(left[c.value], c.right - c.left - TRAY_WALL, seed * 4 + k)) {
      out.push({ value: c.value, ...s, x: s.x + c.centre, moved: -1 });
    }
  }
  const { wide, thick } = STICK;
  // the top and half width (seen from above) of a stick as it lies
  const top = (s) => s.y + (wide / 2) * Math.abs(Math.sin(s.roll)) + (thick / 2) * Math.cos(s.roll);
  const half = (s) => (wide / 2) * Math.cos(s.roll) + (thick / 2) * Math.abs(Math.sin(s.roll));
  for (const m of moved) {
    const { x, z } = snapToTray(order, m.x, m.z);
    const under = out.filter((s) => Math.abs(s.x - x) < half(s) + wide / 2 - 0.01);
    const floor = under.length ? Math.max(...under.map(top)) : 0;
    out.push({ value: m.value, x, z, y: floor + thick / 2 + 0.002, yaw: m.yaw || 0, roll: 0, moved: m.i });
  }
  return out;
}

// ------------------------------------------------------------ payments
// Who pays whom at the end of a hand (#98): [{ from, to, amount }] in
// absolute seats, from the result the engine leaves (engine/game.js agari,
// exhaustiveDraw). The riichi deposits are apart: pot = { to, count } (the
// first winner takes them all), or null.
export function paymentFlows(v) {
  const res = v && v.phase === 'result' ? v.result : null;
  const flows = [];
  if (!res) return { flows, pot: null };
  const add = (from, to, amount) => {
    if (from === to || amount <= 0) return;
    const f = flows.find((x) => x.from === from && x.to === to);
    if (f) f.amount += amount;
    else flows.push({ from, to, amount });
  };
  if (res.type === 'agari') {
    for (const w of res.wins) {
      const hand = w.handPoints ?? w.points;
      if (w.tsumo && w.pao !== null && w.pao !== undefined) add(w.pao, w.seat, w.points);
      else if (w.tsumo) {
        const honba = (w.honbaPoints || 0) / 3;
        for (let x = 0; x < 4; x++) {
          if (x === w.seat) continue;
          const split = w.tsumoSplit || { dealer: hand / 3, other: hand / 3 };
          add(x, w.seat, (x === v.dealer ? split.dealer : split.other) + honba);
        }
      } else if (w.pao !== null && w.pao !== undefined && w.pao !== w.from) {
        add(w.pao, w.seat, hand / 2);
        add(w.from, w.seat, w.points - hand / 2);
      } else add(w.from, w.seat, w.points);
    }
    const paid = flows.reduce((a, f) => a + f.amount, 0);
    const gained = res.deltas ? res.deltas.reduce((a, d) => a + Math.max(0, d), 0) : paid;
    const count = Math.round((gained - paid) / 1000);
    return { flows, pot: count > 0 ? { to: res.wins[0].seat, count } : null };
  }
  // a draw: every loser pays the winners in proportion to what they take,
  // in whole 100 sticks (1500 between two is 800 and 700), every winner
  // ending with exactly their share
  const d = res.deltas || [0, 0, 0, 0];
  const up = d.reduce((a, x) => a + Math.max(0, x), 0);
  if (up > 0) {
    const got = [0, 0, 0, 0];
    d.forEach((lost, from) => {
      if (lost >= 0) return;
      const pay = d.map((won) => (won > 0 ? Math.floor((-lost * won) / up / 100) * 100 : 0));
      let left = -lost - pay.reduce((a, x) => a + x, 0);
      while (left >= 100) {
        // the next 100 to whoever is furthest from their share
        const to = d.reduce((b, won, y) => (won > 0 && (b < 0 || won - got[y] - pay[y] > d[b] - got[b] - pay[b]) ? y : b), -1);
        pay[to] += 100;
        left -= 100;
      }
      pay.forEach((amount, to) => {
        got[to] += amount;
        add(from, to, amount);
      });
    });
  }
  return { flows, pot: null };
}

// The sticks a payment is made of, biggest first, at most `max` of them
// (a huge payment throws its big sticks): [value, ...].
export function paymentSticks(amount, max = 12) {
  const out = [];
  let r = Math.max(0, Math.round(amount / 100) * 100);
  for (const value of VALUES) {
    while (r >= value && out.length < max) {
      out.push(value);
      r -= value;
    }
  }
  return out;
}
