// Hand shape analysis on 34-element count arrays.
import { YAOCHUU } from '../../public/js/shared/tiles.js';

// All ways to split a complete closed part (3n+2 tiles) into sets and a pair.
// Returns [{ pair, sets: [{ k: 's'|'k', t }] }]; 's' = sequence starting at t.
export function decompose(c) {
  const total = c.reduce((a, b) => a + b, 0);
  const res = [];
  if (total % 3 !== 2) return res;
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    extractSets(c, 0, [], (sets) => res.push({ pair: p, sets }));
    c[p] += 2;
  }
  return res;
}

function extractSets(c, i, acc, out) {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) {
    out(acc.slice());
    return;
  }
  if (c[i] >= 3) {
    c[i] -= 3;
    acc.push({ k: 'k', t: i });
    extractSets(c, i, acc, out);
    acc.pop();
    c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    acc.push({ k: 's', t: i });
    extractSets(c, i, acc, out);
    acc.pop();
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

function canFormSets(c, i) {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canFormSets(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = canFormSets(c, i);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

export function isStandardAgari(c) {
  const total = c.reduce((a, b) => a + b, 0);
  if (total % 3 !== 2) return false;
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = canFormSets(c, 0);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

export function isChiitoi(c) {
  let pairs = 0;
  for (let t = 0; t < 34; t++) {
    if (c[t] === 2) pairs++;
    else if (c[t] !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushi(c) {
  let total = 0;
  let hasPair = false;
  for (const t of YAOCHUU) {
    if (c[t] === 0) return false;
    if (c[t] === 2) hasPair = true;
    if (c[t] > 2) return false;
    total += c[t];
  }
  return hasPair && total === 14 && c.reduce((a, b) => a + b, 0) === 14;
}

// c: closed part counts including the winning tile.
export function isAgari(c) {
  return isStandardAgari(c) || isChiitoi(c) || isKokushi(c);
}

// Tile types that complete a 3n+1 closed part. Shape-only (no yaku check).
export function waits(c) {
  const out = [];
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (isAgari(c)) out.push(t);
    c[t]--;
  }
  return out;
}

// Shanten number (-1 = complete) over standard, chiitoitsu and kokushi forms.
// `melds` is the number of called sets already outside the closed part.
export function shanten(c, melds = 0) {
  let best = standardShanten(c, melds);
  if (melds === 0) {
    let pairs = 0;
    let kinds = 0;
    for (let t = 0; t < 34; t++) {
      if (c[t] >= 1) kinds++;
      if (c[t] >= 2) pairs++;
    }
    best = Math.min(best, 6 - pairs + Math.max(0, 7 - kinds));
    let yk = 0;
    let yp = false;
    for (const t of YAOCHUU) {
      if (c[t]) yk++;
      if (c[t] >= 2) yp = true;
    }
    best = Math.min(best, 13 - yk - (yp ? 1 : 0));
  }
  return best;
}

function standardShanten(c, melds) {
  let best = 8;
  const scan = (i, sets, partial, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) {
      const p = Math.min(partial, 4 - sets);
      best = Math.min(best, 8 - 2 * sets - p - (pair ? 1 : 0));
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3; scan(i, sets + 1, partial, pair); c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; scan(i, sets + 1, partial, pair); c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) scan(i, sets, partial, true);
      scan(i, sets, partial + 1, pair);
      c[i] += 2;
    }
    if (i < 27 && i % 9 <= 7 && c[i + 1]) {
      c[i]--; c[i + 1]--; scan(i, sets, partial + 1, pair); c[i]++; c[i + 1]++;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 2]) {
      c[i]--; c[i + 2]--; scan(i, sets, partial + 1, pair); c[i]++; c[i + 2]++;
    }
    const n = c[i];
    c[i] = 0; scan(i + 1, sets, partial, pair); c[i] = n;
  };
  scan(0, melds, 0, false);
  return best;
}
