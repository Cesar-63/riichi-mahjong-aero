// Yaku, fu and point evaluation for a winning hand.
import {
  tileType, isAka, isHonor, isTerminal, isYaochuu, isDragon, isWind,
  suitOf, counts34, doraFromIndicator,
} from '../../public/js/shared/tiles.js';
import { decompose, isChiitoi, isKokushi } from './hand.js';

const GREEN = new Set([19, 20, 21, 23, 25, 32]);

// ctx = {
//   closed: ids in hand including the winning tile,
//   melds: [{ type: 'chi'|'pon'|'minkan'|'kakan'|'ankan', tiles: ids }],
//   winTile, tsumo, seatWind (27..30), roundWind (27..30),
//   riichi (0 none, 1 riichi, 2 double), ippatsu, haitei, houtei,
//   rinshan, chankan, tenhou, chiihou, dora: indicator ids, ura: indicator ids
// }
// Returns null when the hand has no yaku, else the highest scoring reading.
export function evaluate(ctx) {
  const closedC = counts34(ctx.closed);
  const allIds = [...ctx.closed, ...ctx.melds.flatMap((m) => m.tiles)];
  const allC = counts34(allIds);
  const menzen = ctx.melds.every((m) => m.type === 'ankan');
  const w = tileType(ctx.winTile);
  const readings = [];

  const flagYakuman = [];
  if (ctx.tenhou) flagYakuman.push('tenhou');
  if (ctx.chiihou) flagYakuman.push('chiihou');

  if (ctx.melds.length === 0 && isKokushi(closedC)) {
    readings.push({ yakuman: ['kokushi', ...flagYakuman] });
  }

  if (ctx.melds.length === 0 && isChiitoi(closedC)) {
    readings.push(chiitoiReading(ctx, allC, flagYakuman));
  }

  const meldGroups = ctx.melds.map((m) => {
    const t = Math.min(...m.tiles.map(tileType));
    if (m.type === 'chi') return { k: 's', t, open: true };
    if (m.type === 'pon') return { k: 'k', t, open: true };
    return { k: 'q', t, open: m.type !== 'ankan' };
  });

  for (const dec of decompose(closedC.slice())) {
    const seen = new Set();
    const placements = [];
    if (dec.pair === w) placements.push({ idx: -1, wait: 'tanki' });
    dec.sets.forEach((s, idx) => {
      const key = `${s.k}${s.t}`;
      if (seen.has(key)) return;
      if (s.k === 'k' && s.t === w) {
        seen.add(key);
        placements.push({ idx, wait: 'shanpon' });
      } else if (s.k === 's' && w >= s.t && w <= s.t + 2) {
        seen.add(key);
        let wait = 'ryanmen';
        if (w === s.t + 1) wait = 'kanchan';
        else if ((w === s.t && s.t % 9 === 6) || (w === s.t + 2 && s.t % 9 === 0)) wait = 'penchan';
        placements.push({ idx, wait });
      }
    });
    for (const pl of placements) {
      const groups = dec.sets.map((s, idx) => ({
        k: s.k,
        t: s.t,
        // A triplet finished by ron counts as open.
        open: idx === pl.idx && s.k === 'k' && !ctx.tsumo,
      }));
      groups.push(...meldGroups);
      readings.push(standardReading(ctx, groups, dec.pair, pl.wait, menzen, allC, closedC, flagYakuman));
    }
  }

  let best = null;
  for (const r of readings) {
    const res = finalize(ctx, r, allIds);
    if (!res) continue;
    if (!best || res.base > best.base || (res.base === best.base && res.han > best.han)) best = res;
  }
  return best;
}

function chiitoiReading(ctx, allC, flagYakuman) {
  const yakuman = [...flagYakuman];
  if (allC.every((n, t) => n === 0 || isHonor(t))) yakuman.push('tsuuiisou');
  if (yakuman.length) return { yakuman };
  const yaku = commonYaku(ctx, true);
  yaku.push(['chiitoitsu', 2]);
  if (allC.every((n, t) => n === 0 || !isYaochuu(t))) yaku.push(['tanyao', 1]);
  if (allC.every((n, t) => n === 0 || isYaochuu(t))) yaku.push(['honroutou', 2]);
  pushFlush(yaku, allC, true);
  return { yaku, fu: 25 };
}

function commonYaku(ctx, menzen) {
  const y = [];
  if (ctx.riichi === 2) y.push(['doubleRiichi', 2]);
  else if (ctx.riichi === 1) y.push(['riichi', 1]);
  if (ctx.riichi && ctx.ippatsu) y.push(['ippatsu', 1]);
  if (menzen && ctx.tsumo) y.push(['tsumo', 1]);
  if (ctx.haitei) y.push(['haitei', 1]);
  if (ctx.houtei) y.push(['houtei', 1]);
  if (ctx.rinshan) y.push(['rinshan', 1]);
  if (ctx.chankan) y.push(['chankan', 1]);
  return y;
}

function pushFlush(yaku, allC, menzen) {
  const suits = new Set();
  let honors = false;
  allC.forEach((n, t) => {
    if (!n) return;
    if (isHonor(t)) honors = true;
    else suits.add(suitOf(t));
  });
  if (suits.size !== 1) return;
  if (honors) yaku.push(['honitsu', menzen ? 3 : 2]);
  else yaku.push(['chinitsu', menzen ? 6 : 5]);
}

const groupHasYaochuu = (g) =>
  g.k === 's' ? g.t % 9 === 0 || g.t % 9 === 6 : isYaochuu(g.t);

function standardReading(ctx, groups, pair, wait, menzen, allC, closedC, flagYakuman) {
  const trip = groups.filter((g) => g.k !== 's');
  const seqs = groups.filter((g) => g.k === 's');
  const kans = groups.filter((g) => g.k === 'q');
  const concealedTrips = trip.filter((g) => !g.open).length;

  const yakuman = [...flagYakuman];
  if (concealedTrips === 4) yakuman.push('suuankou');
  const dragonTrips = trip.filter((g) => isDragon(g.t)).length;
  const windTrips = trip.filter((g) => isWind(g.t)).length;
  if (dragonTrips === 3) yakuman.push('daisangen');
  if (windTrips === 4) yakuman.push('daisuushii');
  else if (windTrips === 3 && isWind(pair)) yakuman.push('shousuushii');
  if (allC.every((n, t) => n === 0 || isHonor(t))) yakuman.push('tsuuiisou');
  if (allC.every((n, t) => n === 0 || isTerminal(t))) yakuman.push('chinroutou');
  if (allC.every((n, t) => n === 0 || GREEN.has(t))) yakuman.push('ryuuiisou');
  if (ctx.melds.length === 0 && isChuuren(closedC)) yakuman.push('chuuren');
  if (kans.length === 4) yakuman.push('suukantsu');
  if (yakuman.length) return { yakuman };

  const valuePair = (t) =>
    (isDragon(t) ? 1 : 0) + (t === ctx.seatWind ? 1 : 0) + (t === ctx.roundWind ? 1 : 0);

  const yaku = commonYaku(ctx, menzen);
  const pinfu = menzen && seqs.length === 4 && valuePair(pair) === 0 && wait === 'ryanmen';
  if (pinfu) yaku.push(['pinfu', 1]);
  if (allC.every((n, t) => n === 0 || !isYaochuu(t))) yaku.push(['tanyao', 1]);

  if (menzen) {
    const bySeq = {};
    for (const s of seqs) bySeq[s.t] = (bySeq[s.t] || 0) + 1;
    const peikou = Object.values(bySeq).reduce((a, n) => a + Math.floor(n / 2), 0);
    if (peikou === 2) yaku.push(['ryanpeikou', 3]);
    else if (peikou === 1) yaku.push(['iipeikou', 1]);
  }

  for (const g of trip) {
    if (g.t === 31) yaku.push(['haku', 1]);
    if (g.t === 32) yaku.push(['hatsu', 1]);
    if (g.t === 33) yaku.push(['chun', 1]);
    if (g.t === ctx.seatWind) yaku.push(['seatWind', 1]);
    if (g.t === ctx.roundWind) yaku.push(['roundWind', 1]);
  }

  const allYaochuu = groups.every(groupHasYaochuu) && isYaochuu(pair);
  if (allYaochuu && seqs.length > 0) {
    const anyHonor = isHonor(pair) || groups.some((g) => g.k !== 's' && isHonor(g.t));
    if (anyHonor) yaku.push(['chanta', menzen ? 2 : 1]);
    else yaku.push(['junchan', menzen ? 3 : 2]);
  }

  const seqStarts = new Set(seqs.map((s) => s.t));
  for (let s = 0; s < 3; s++) {
    if ([0, 3, 6].every((o) => seqStarts.has(s * 9 + o))) yaku.push(['ittsu', menzen ? 2 : 1]);
  }
  for (let n = 0; n < 7; n++) {
    if ([0, 9, 18].every((o) => seqStarts.has(n + o))) yaku.push(['sanshoku', menzen ? 2 : 1]);
  }
  const tripTypes = new Set(trip.map((g) => g.t));
  for (let n = 0; n < 9; n++) {
    if ([0, 9, 18].every((o) => tripTypes.has(n + o))) yaku.push(['sanshokuDoukou', 2]);
  }
  if (trip.length === 4) yaku.push(['toitoi', 2]);
  if (concealedTrips === 3) yaku.push(['sanankou', 2]);
  if (kans.length === 3) yaku.push(['sankantsu', 2]);
  if (dragonTrips === 2 && isDragon(pair)) yaku.push(['shousangen', 2]);
  if (allC.every((n, t) => n === 0 || isYaochuu(t))) yaku.push(['honroutou', 2]);
  pushFlush(yaku, allC, menzen);

  // Fu
  let fu;
  if (pinfu) {
    fu = ctx.tsumo ? 20 : 30;
  } else {
    fu = 20;
    if (menzen && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    if (wait === 'tanki' || wait === 'kanchan' || wait === 'penchan') fu += 2;
    fu += valuePair(pair) * 2;
    for (const g of trip) {
      let f = 2;
      if (isYaochuu(g.t)) f *= 2;
      if (!g.open) f *= 2;
      if (g.k === 'q') f *= 4;
      fu += f;
    }
    fu = Math.ceil(fu / 10) * 10;
    if (fu === 20) fu = 30; // open hand with no fu
  }
  return { yaku, fu };
}

function isChuuren(c) {
  let suit = -1;
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    if (t >= 27) return false;
    const s = Math.floor(t / 9);
    if (suit >= 0 && s !== suit) return false;
    suit = s;
  }
  if (suit < 0) return false;
  const b = suit * 9;
  if (c[b] < 3 || c[b + 8] < 3) return false;
  for (let i = 1; i < 8; i++) if (c[b + i] < 1) return false;
  return true;
}

function finalize(ctx, reading, allIds) {
  if (reading.yakuman) {
    const n = reading.yakuman.length;
    return {
      yaku: reading.yakuman.map((k) => [k, 13]),
      yakumanKeys: reading.yakuman,
      yakuman: n,
      han: 13 * n,
      fu: 0,
      base: 8000 * n,
    };
  }
  if (reading.yaku.length === 0) return null;
  const yaku = reading.yaku.slice();
  let han = yaku.reduce((a, [, h]) => a + h, 0);
  const countDora = (inds) => {
    let n = 0;
    for (const ind of inds) {
      const d = doraFromIndicator(tileType(ind));
      for (const id of allIds) if (tileType(id) === d) n++;
    }
    return n;
  };
  const dora = countDora(ctx.dora || []);
  const aka = allIds.filter(isAka).length;
  const ura = ctx.riichi ? countDora(ctx.ura || []) : 0;
  if (dora) yaku.push(['dora', dora]);
  if (aka) yaku.push(['aka', aka]);
  if (ctx.riichi) yaku.push(['ura', ura]);
  han += dora + aka + ura;
  return { yaku, yakumanKeys: [], yakuman: 0, han, fu: reading.fu, base: basePoints(han, reading.fu) };
}

export function basePoints(han, fu) {
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  return Math.min(2000, fu * 2 ** (han + 2));
}

export const ceil100 = (x) => Math.ceil(x / 100) * 100;

export function ronValue(base, dealer) {
  return ceil100(base * (dealer ? 6 : 4));
}

// Returns what each payer owes (before honba) on a self draw.
export function tsumoValues(base, dealer) {
  if (dealer) return { dealer: 0, other: ceil100(base * 2) };
  return { dealer: ceil100(base * 2), other: ceil100(base) };
}

export function limitName(res) {
  if (res.yakuman) return res.yakuman > 1 ? `${res.yakuman}x Yakuman` : 'Yakuman';
  const { han, base } = res;
  if (han >= 13) return 'Kazoe Yakuman';
  if (han >= 11) return 'Sanbaiman';
  if (han >= 8) return 'Baiman';
  if (han >= 6) return 'Haneman';
  if (base >= 2000) return 'Mangan';
  return '';
}
