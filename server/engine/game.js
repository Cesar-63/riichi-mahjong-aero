// Authoritative riichi mahjong state machine (Tenhou-style rules).
// The whole game lives in a plain JSON-serializable object (`game.s`), so it
// can be stored between stateless serverless invocations.
import {
  tileType, isYaochuu, isWind, isDragon, counts34, sortTiles, YAOCHUU,
} from '../../public/js/shared/tiles.js';
import { waits, isAgari, isKokushi, decompose } from './hand.js';
import { evaluate, ronValue, tsumoValues, limitName } from './score.js';

export const DEFAULT_CONFIG = {
  startScore: 25000,
  targetScore: 30000, // also the "return" score for final points
  uma: [20, 10, -10, -20],
  rounds: 1, // 1 = tonpuusen (East only), 2 = hanchan (East-South)
};

function cryptoRandom() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

const SEATS = [0, 1, 2, 3];

export class Game {
  constructor(state, rng = cryptoRandom) {
    this.s = state;
    this.rng = rng;
  }

  static create(names, config = {}, rng = cryptoRandom) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const s = {
      config: cfg,
      players: names.map((name) => ({ name, score: cfg.startScore })),
      round: 0,
      kyokuNum: 0,
      honba: 0,
      kyoutaku: 0,
      phase: 'init',
      k: null,
      result: null,
      final: null,
      seq: 0,
      events: [],
    };
    const g = new Game(s, rng);
    g.startKyoku();
    return g;
  }

  get k() {
    return this.s.k;
  }

  dealer() {
    return this.s.kyokuNum;
  }

  seatWind(seat) {
    return 27 + ((seat - this.s.kyokuNum + 4) % 4);
  }

  event(e) {
    this.s.seq++;
    this.s.events.push({ ...e, id: this.s.seq });
    if (this.s.events.length > 12) this.s.events.shift();
  }

  // ---------------------------------------------------------------- kyoku

  startKyoku() {
    const tiles = Array.from({ length: 136 }, (_, i) => i);
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    const dead = tiles.splice(tiles.length - 14, 14);
    const four = (v) => SEATS.map(() => (typeof v === 'function' ? v() : v));
    const k = {
      wall: tiles,
      // dead[0..3] rinshan tiles, dead[4..8] dora indicators, dead[9..13] ura
      dead,
      kanCount: 0,
      doraCount: 1,
      pendingDora: 0,
      hands: four(() => []),
      melds: four(() => []),
      discards: four(() => []),
      drawn: null,
      riichi: four(null),
      riichiPending: null,
      furitenTemp: four(false),
      furitenRiichi: four(false),
      discardCount: four(0),
      callsMade: false,
      kansBy: four(0),
      firstDiscards: [],
      turn: this.dealer(),
      afterCall: false,
      rinshan: false,
      kuikae: [],
      pending: null,
      pao: four(() => ({ daisangen: null, daisuushii: null })),
    };
    this.s.k = k;
    this.s.result = null;
    for (let i = 0; i < 4; i++) {
      const seat = (this.dealer() + i) % 4;
      k.hands[seat] = k.wall.splice(0, 13);
    }
    this.event({ type: 'start' });
    this.draw(this.dealer());
  }

  draw(seat, rinshan = false) {
    const k = this.k;
    let tile;
    if (rinshan) {
      tile = k.dead[k.kanCount - 1];
      k.wall.pop(); // keep the dead wall at 14 tiles
    } else {
      if (k.wall.length === 0) return this.exhaustiveDraw();
      tile = k.wall.shift();
    }
    k.hands[seat].push(tile);
    k.drawn = tile;
    k.turn = seat;
    k.afterCall = false;
    k.rinshan = rinshan;
    k.kuikae = [];
    this.s.phase = 'turn';
  }

  // -------------------------------------------------------------- helpers

  isClosed(seat) {
    return this.k.melds[seat].every((m) => m.type === 'ankan');
  }

  meldCount(seat, t) {
    let n = 0;
    for (const m of this.k.melds[seat]) for (const id of m.tiles) if (tileType(id) === t) n++;
    return n;
  }

  // Waits excluding tiles the player already holds all four copies of.
  realWaits(seat, hand = this.k.hands[seat]) {
    const c = counts34(hand);
    return waits(c).filter((t) => c[t] + this.meldCount(seat, t) < 4);
  }

  isFuriten(seat) {
    const k = this.k;
    if (k.furitenTemp[seat] || k.furitenRiichi[seat]) return true;
    const own = new Set(k.discards[seat].map((d) => tileType(d.tile)));
    return waits(counts34(k.hands[seat])).some((t) => own.has(t));
  }

  breakIppatsu() {
    for (const r of this.k.riichi) if (r) r.ippatsu = false;
  }

  flushPendingDora() {
    const k = this.k;
    if (k.pendingDora > 0) {
      k.doraCount += k.pendingDora;
      k.pendingDora = 0;
    }
  }

  buildCtx(seat, winTile, tsumo, chankan = false) {
    const k = this.k;
    const r = k.riichi[seat];
    const hand = k.hands[seat];
    const firstGo = !k.callsMade && k.discardCount[seat] === 0;
    return {
      closed: tsumo ? hand.slice() : [...hand, winTile],
      melds: k.melds[seat].map((m) => ({ type: m.type, tiles: m.tiles })),
      winTile,
      tsumo,
      seatWind: this.seatWind(seat),
      roundWind: 27 + this.s.round,
      riichi: r ? (r.double ? 2 : 1) : 0,
      ippatsu: !!(r && r.ippatsu),
      haitei: tsumo && !k.rinshan && k.wall.length === 0,
      houtei: !tsumo && !chankan && k.wall.length === 0,
      rinshan: tsumo && k.rinshan,
      chankan,
      tenhou: tsumo && seat === this.dealer() && firstGo,
      chiihou: tsumo && seat !== this.dealer() && firstGo,
      dora: k.dead.slice(4, 4 + k.doraCount),
      ura: k.dead.slice(9, 9 + k.doraCount),
    };
  }

  // ------------------------------------------------------------- options

  turnOptions(seat) {
    const k = this.k;
    if (this.s.phase !== 'turn' || k.turn !== seat) return null;
    const hand = k.hands[seat];
    const opts = { discard: [], riichi: [], tsumo: false, ankan: [], kakan: [], kyuushu: false };
    if (k.afterCall) {
      opts.discard = hand.filter((id) => !k.kuikae.includes(tileType(id)));
      return opts;
    }
    const r = k.riichi[seat];
    const c = counts34(hand);
    if (isAgari(c) && evaluate(this.buildCtx(seat, k.drawn, true))) opts.tsumo = true;
    opts.discard = r ? [k.drawn] : hand.slice();

    if (!r && this.isClosed(seat) && this.s.players[seat].score >= 1000 && k.wall.length >= 4) {
      const byType = new Map();
      for (const id of hand) {
        const t = tileType(id);
        if (!byType.has(t)) {
          const rest = hand.filter((x) => x !== id);
          byType.set(t, this.realWaits(seat, rest).length > 0);
        }
        if (byType.get(t)) opts.riichi.push(id);
      }
    }

    if (k.wall.length > 0 && k.kanCount < 4) {
      for (let t = 0; t < 34; t++) {
        if (c[t] !== 4) continue;
        if (!r || (tileType(k.drawn) === t && this.riichiKanOk(seat, t))) opts.ankan.push(t);
      }
      if (!r) {
        for (const m of k.melds[seat]) {
          const t = tileType(m.tiles[0]);
          if (m.type === 'pon' && c[t] > 0) opts.kakan.push(t);
        }
      }
    }

    if (k.discardCount[seat] === 0 && !k.callsMade) {
      const kinds = YAOCHUU.filter((t) => c[t] > 0).length;
      if (kinds >= 9) opts.kyuushu = true;
    }
    return opts;
  }

  // A closed kan during riichi must not change the waits or the hand reading.
  riichiKanOk(seat, t) {
    const k = this.k;
    const hand13 = k.hands[seat].filter((id) => id !== k.drawn);
    const c13 = counts34(hand13);
    const before = waits(c13);
    const after = counts34(hand13.filter((id) => tileType(id) !== t));
    const afterWaits = waits(after);
    if (before.length === 0 || before.join() !== afterWaits.join()) return false;
    for (const w of before) {
      c13[w]++;
      const decs = decompose(c13.slice());
      c13[w]--;
      if (!decs.length || decs.some((d) => !d.sets.some((s) => s.k === 'k' && s.t === t))) return false;
    }
    return true;
  }

  canRon(seat, id, kind) {
    const k = this.k;
    const c = counts34(k.hands[seat]);
    c[tileType(id)]++;
    if (kind === 'ankan') {
      if (k.melds[seat].length || !isKokushi(c)) return false;
    } else if (!isAgari(c)) return false;
    if (this.isFuriten(seat)) return false;
    return !!evaluate(this.buildCtx(seat, id, false, kind !== 'discard'));
  }

  responseOptions(from, id, kind) {
    const k = this.k;
    const t = tileType(id);
    const out = {};
    for (const s of SEATS) {
      if (s === from) continue;
      const o = {};
      if (this.canRon(s, id, kind)) o.ron = true;
      if (kind === 'discard' && !k.riichi[s] && k.wall.length > 0) {
        const hand = k.hands[s];
        const same = hand.filter((x) => tileType(x) === t);
        if (same.length >= 2) {
          const pons = idPairs([same], [same]).filter(
            (pair) => hand.some((x) => !pair.includes(x) && tileType(x) !== t),
          );
          if (pons.length) o.pon = pons;
        }
        if (same.length === 3 && k.kanCount < 4) o.minkan = true;
        if (s === (from + 1) % 4 && t < 27) {
          const chis = this.chiOptions(hand, t);
          if (chis.length) o.chi = chis;
        }
      }
      if (Object.keys(o).length) out[s] = o;
    }
    return out;
  }

  chiOptions(hand, t) {
    const n = t % 9;
    const out = [];
    const patterns = [];
    if (n >= 2) patterns.push([t - 2, t - 1, n >= 3 ? t - 3 : null]);
    if (n >= 1 && n <= 7) patterns.push([t - 1, t + 1, null]);
    if (n <= 6) patterns.push([t + 1, t + 2, n <= 5 ? t + 3 : null]);
    for (const [a, b, extra] of patterns) {
      const ia = hand.filter((x) => tileType(x) === a);
      const ib = hand.filter((x) => tileType(x) === b);
      if (!ia.length || !ib.length) continue;
      const forbid = extra === null ? [t] : [t, extra];
      for (const pair of idPairs([ia], [ib], true)) {
        const rest = hand.filter((x) => !pair.includes(x));
        if (rest.some((x) => !forbid.includes(tileType(x)))) out.push({ tiles: pair, forbid });
      }
    }
    return out;
  }

  pendingSeats() {
    const s = this.s;
    if (s.phase === 'turn') return [s.k.turn];
    if (s.phase === 'response') {
      const p = s.k.pending;
      return Object.keys(p.opts).map(Number).filter((x) => !p.resp[x]);
    }
    if (s.phase === 'result') return SEATS.filter((x) => !s.result.ready[x]);
    return [];
  }

  // True when the seat's only legal move is forced (riichi tsumogiri).
  isForced(seat) {
    if (this.s.phase !== 'turn' || this.k.turn !== seat || !this.k.riichi[seat]) return false;
    const o = this.turnOptions(seat);
    return !o.tsumo && o.ankan.length === 0;
  }

  // -------------------------------------------------------------- actions

  act(seat, a) {
    const s = this.s;
    const k = s.k;
    if (s.phase === 'turn') {
      if (k.turn !== seat) throw new Error('not your turn');
      const o = this.turnOptions(seat);
      switch (a.type) {
        case 'discard':
          if (!o.discard.includes(a.tile)) throw new Error('illegal discard');
          return this.discard(seat, a.tile, false);
        case 'riichi':
          if (!o.riichi.includes(a.tile)) throw new Error('illegal riichi');
          return this.discard(seat, a.tile, true);
        case 'tsumo':
          if (!o.tsumo) throw new Error('cannot tsumo');
          return this.agari([seat], null, k.drawn, 'tsumo');
        case 'ankan':
          if (!o.ankan.includes(a.t)) throw new Error('illegal ankan');
          return this.ankan(seat, a.t);
        case 'kakan':
          if (!o.kakan.includes(a.t)) throw new Error('illegal kakan');
          return this.kakan(seat, a.t);
        case 'kyuushu':
          if (!o.kyuushu) throw new Error('cannot kyuushu');
          return this.abortiveDraw('kyuushu', { seat, hand: sortTiles(k.hands[seat]) });
        default:
          throw new Error('bad action');
      }
    }
    if (s.phase === 'response') {
      const p = k.pending;
      const o = p.opts[seat];
      if (!o || p.resp[seat]) throw new Error('no decision pending');
      if (a.type === 'ron' && !o.ron) throw new Error('cannot ron');
      if (a.type === 'minkan' && !o.minkan) throw new Error('cannot kan');
      if (a.type === 'pon' && !(o.pon || []).some((x) => sameIds(x, a.tiles))) throw new Error('cannot pon');
      if (a.type === 'chi' && !(o.chi || []).some((x) => sameIds(x.tiles, a.tiles))) throw new Error('cannot chi');
      if (!['ron', 'pon', 'chi', 'minkan', 'pass'].includes(a.type)) throw new Error('bad action');
      p.resp[seat] = a;
      if (this.pendingSeats().length === 0) this.resolveWindow();
      return;
    }
    if (s.phase === 'result') {
      if (a.type !== 'ok') throw new Error('bad action');
      s.result.ready[seat] = true;
      if (s.result.ready.every(Boolean)) this.proceed();
      return;
    }
    throw new Error('game over');
  }

  defaultAction(seat) {
    const s = this.s;
    if (s.phase === 'turn') {
      const o = this.turnOptions(seat);
      const tile = o.discard.includes(this.k.drawn) ? this.k.drawn : o.discard[o.discard.length - 1];
      return this.act(seat, { type: 'discard', tile });
    }
    if (s.phase === 'response') return this.act(seat, { type: 'pass' });
    if (s.phase === 'result') return this.act(seat, { type: 'ok' });
  }

  discard(seat, id, riichi) {
    const k = this.k;
    const hand = k.hands[seat];
    hand.splice(hand.indexOf(id), 1);
    const r = k.riichi[seat];
    if (r) r.ippatsu = false;
    k.discards[seat].push({ tile: id, tsumogiri: id === k.drawn, riichi, called: false });
    k.furitenTemp[seat] = false;
    if (riichi) k.riichiPending = { seat, double: k.discardCount[seat] === 0 && !k.callsMade };
    if (!k.callsMade && k.discardCount.reduce((a, b) => a + b, 0) < 4) k.firstDiscards.push(tileType(id));
    k.discardCount[seat]++;
    k.drawn = null;
    k.afterCall = false;
    k.rinshan = false;
    k.kuikae = [];
    this.flushPendingDora();
    this.event({ type: riichi ? 'riichi' : 'discard', seat, tile: id });
    this.openWindow('discard', seat, id);
  }

  ankan(seat, t) {
    const k = this.k;
    const ids = k.hands[seat].filter((x) => tileType(x) === t);
    k.hands[seat] = k.hands[seat].filter((x) => tileType(x) !== t);
    k.melds[seat].push({ type: 'ankan', tiles: ids, from: seat });
    k.kanCount++;
    k.kansBy[seat]++;
    this.flushPendingDora();
    k.doraCount++;
    this.breakIppatsu();
    k.callsMade = true;
    k.drawn = null;
    this.event({ type: 'kan', seat });
    this.openWindow('ankan', seat, ids[0]);
  }

  kakan(seat, t) {
    const k = this.k;
    const id = k.hands[seat].find((x) => tileType(x) === t);
    k.hands[seat].splice(k.hands[seat].indexOf(id), 1);
    const m = k.melds[seat].find((x) => x.type === 'pon' && tileType(x.tiles[0]) === t);
    m.type = 'kakan';
    m.added = id;
    m.tiles.push(id);
    k.kanCount++;
    k.kansBy[seat]++;
    this.flushPendingDora();
    k.pendingDora++;
    this.breakIppatsu();
    k.callsMade = true;
    k.drawn = null;
    this.event({ type: 'kan', seat });
    this.openWindow('kakan', seat, id);
  }

  openWindow(kind, from, tile) {
    const k = this.k;
    const opts = this.responseOptions(from, tile, kind);
    k.pending = { kind, from, tile, opts, resp: {} };
    this.s.phase = 'response';
    if (this.pendingSeats().length === 0) this.resolveWindow();
  }

  resolveWindow() {
    const k = this.k;
    const { kind, from, tile, resp } = k.pending;
    const t = tileType(tile);
    const order = [1, 2, 3].map((d) => (from + d) % 4);
    const rons = order.filter((x) => resp[x] && resp[x].type === 'ron');

    // Passing on a winning tile causes furiten (an ankan only counts for
    // players who could actually rob it).
    for (const x of order) {
      if (rons.includes(x)) continue;
      const missed = kind === 'ankan' ? !!(k.pending.opts[x] && k.pending.opts[x].ron) : waits(counts34(k.hands[x])).includes(t);
      if (missed) {
        if (k.riichi[x]) k.furitenRiichi[x] = true;
        else k.furitenTemp[x] = true;
      }
    }

    if (rons.length === 3) return this.abortiveDraw('sanchahou');
    if (rons.length) return this.agari(rons, from, tile, kind);
    k.pending = null;

    if (kind === 'kakan' || kind === 'ankan') return this.draw(from, true);

    if (k.riichiPending) {
      const { seat, double } = k.riichiPending;
      k.riichiPending = null;
      this.s.players[seat].score -= 1000;
      this.s.kyoutaku++;
      k.riichi[seat] = { double, ippatsu: true };
      if (k.riichi.every(Boolean)) return this.abortiveDraw('suucha');
    }
    if (k.kanCount === 4 && k.kansBy.filter((n) => n > 0).length > 1) {
      return this.abortiveDraw('suukaikan');
    }

    const caller = order.find((x) => resp[x] && (resp[x].type === 'pon' || resp[x].type === 'minkan'))
      ?? order.find((x) => resp[x] && resp[x].type === 'chi');
    if (caller !== undefined) return this.call(caller, from, tile, resp[caller]);

    if (!k.callsMade && k.firstDiscards.length === 4
        && isWind(k.firstDiscards[0]) && k.firstDiscards.every((x) => x === k.firstDiscards[0])) {
      return this.abortiveDraw('suufon');
    }
    if (k.wall.length === 0) return this.exhaustiveDraw();
    return this.draw((from + 1) % 4);
  }

  call(seat, from, tile, a) {
    const k = this.k;
    const t = tileType(tile);
    k.discards[from][k.discards[from].length - 1].called = true;
    this.breakIppatsu();
    k.callsMade = true;
    const hand = k.hands[seat];
    const take = (ids) => ids.forEach((id) => hand.splice(hand.indexOf(id), 1));
    let meld;
    if (a.type === 'chi') {
      const opt = this.chiOptions(hand, t).find((x) => sameIds(x.tiles, a.tiles));
      take(a.tiles);
      meld = { type: 'chi', tiles: [tile, ...sortTiles(a.tiles)], called: tile, from };
      k.kuikae = opt.forbid;
    } else if (a.type === 'pon') {
      take(a.tiles);
      meld = { type: 'pon', tiles: [...a.tiles, tile], called: tile, from };
      k.kuikae = [t];
    } else {
      const ids = hand.filter((x) => tileType(x) === t);
      take(ids);
      meld = { type: 'minkan', tiles: [...ids, tile], called: tile, from };
      k.kanCount++;
      k.kansBy[seat]++;
      this.flushPendingDora();
      k.pendingDora++;
    }
    k.melds[seat].push(meld);

    if (meld.type !== 'chi') {
      const trips = k.melds[seat].filter((m) => m.type !== 'chi').map((m) => tileType(m.tiles[0]));
      if (isDragon(t) && trips.filter(isDragon).length === 3) k.pao[seat].daisangen = from;
      if (isWind(t) && trips.filter(isWind).length === 4) k.pao[seat].daisuushii = from;
    }
    this.event({ type: a.type === 'minkan' ? 'kan' : a.type, seat });

    if (meld.type === 'minkan') return this.draw(seat, true);
    k.turn = seat;
    k.drawn = null;
    k.afterCall = true;
    k.rinshan = false;
    this.s.phase = 'turn';
  }

  // -------------------------------------------------------------- endings

  agari(winners, from, tile, kind) {
    const s = this.s;
    const k = s.k;
    const tsumo = from === null;
    const deltas = [0, 0, 0, 0];
    const wins = [];
    const dealer = this.dealer();
    winners.forEach((w, i) => {
      const ctx = this.buildCtx(w, tile, tsumo, kind === 'kakan' || kind === 'ankan');
      const res = evaluate(ctx);
      const isDealer = w === dealer;
      const pay = [0, 0, 0, 0];
      let paoSeat = null;
      if (res.yakumanKeys.includes('daisangen') && k.pao[w].daisangen !== null) paoSeat = k.pao[w].daisangen;
      if (res.yakumanKeys.includes('daisuushii') && k.pao[w].daisuushii !== null) paoSeat = k.pao[w].daisuushii;
      if (tsumo) {
        if (paoSeat !== null) {
          pay[paoSeat] = ronValue(res.base, isDealer) + s.honba * 300;
        } else {
          const tv = tsumoValues(res.base, isDealer);
          for (const x of SEATS) {
            if (x !== w) pay[x] = (x === dealer ? tv.dealer : tv.other) + s.honba * 100;
          }
        }
      } else {
        const total = ronValue(res.base, isDealer);
        if (paoSeat !== null && paoSeat !== from) {
          pay[paoSeat] += total / 2;
          pay[from] += total / 2 + s.honba * 300;
        } else {
          pay[from] += total + s.honba * 300;
        }
      }
      const gain = pay.reduce((a, b) => a + b, 0);
      SEATS.forEach((x) => { deltas[x] -= pay[x]; });
      deltas[w] += gain;
      if (i === 0) deltas[w] += s.kyoutaku * 1000;
      wins.push({
        seat: w,
        from,
        tsumo,
        hand: sortTiles(ctx.closed.filter((x) => x !== tile)),
        winTile: tile,
        melds: k.melds[w],
        yaku: res.yaku,
        han: res.han,
        fu: res.fu,
        yakuman: res.yakuman,
        points: gain,
        label: limitName(res),
        pao: paoSeat,
        ura: ctx.riichi ? ctx.ura : [],
      });
    });
    s.kyoutaku = 0;
    this.event({ type: tsumo ? 'tsumo' : 'ron', seat: winners[0], seats: winners });
    this.endKyoku({ type: 'agari', wins, deltas }, winners.includes(dealer));
  }

  exhaustiveDraw() {
    const k = this.k;
    const dealer = this.dealer();
    const tenpai = SEATS.filter((x) => this.realWaits(x).length > 0);
    const nagashi = SEATS.filter(
      (x) => k.discards[x].length > 0 && k.discards[x].every((d) => isYaochuu(tileType(d.tile)) && !d.called),
    );
    const deltas = [0, 0, 0, 0];
    if (nagashi.length) {
      for (const n of nagashi) {
        for (const x of SEATS) {
          if (x === n) continue;
          const p = n === dealer || x === dealer ? 4000 : 2000;
          deltas[x] -= p;
          deltas[n] += p;
        }
      }
    } else if (tenpai.length > 0 && tenpai.length < 4) {
      for (const x of SEATS) {
        deltas[x] = tenpai.includes(x) ? 3000 / tenpai.length : -3000 / (4 - tenpai.length);
      }
    }
    const hands = {};
    for (const x of tenpai) hands[x] = sortTiles(k.hands[x]);
    this.event({ type: 'draw' });
    this.endKyoku(
      { type: 'draw', reason: nagashi.length ? 'nagashi' : 'exhaustive', tenpai, nagashi, hands, deltas },
      tenpai.includes(dealer),
    );
  }

  abortiveDraw(reason, extra = {}) {
    this.event({ type: 'draw' });
    this.endKyoku({ type: 'draw', reason, abortive: true, deltas: [0, 0, 0, 0], tenpai: [], ...extra }, true);
  }

  ranking() {
    return SEATS.slice().sort((a, b) => this.s.players[b].score - this.s.players[a].score || a - b);
  }

  endKyoku(result, renchan) {
    const s = this.s;
    s.players.forEach((p, i) => { p.score += result.deltas[i]; });
    s.k.pending = null;
    const draw = result.type === 'draw';
    let { round, kyokuNum, honba } = s;
    if (renchan) honba++;
    else {
      honba = draw ? honba + 1 : 0;
      kyokuNum++;
      if (kyokuNum === 4) {
        kyokuNum = 0;
        round++;
      }
    }

    const cfg = s.config;
    const top = Math.max(...s.players.map((p) => p.score));
    const dealerIsTop = this.ranking()[0] === this.dealer();
    const lastRegular = s.round === cfg.rounds - 1 && s.kyokuNum === 3;
    const extension = s.round >= cfg.rounds;
    let end = false;
    if (s.players.some((p) => p.score < 0)) end = true;
    else if (extension) {
      if (top >= cfg.targetScore) end = true;
      if (s.kyokuNum === 3 && !renchan) end = true;
    } else if (lastRegular) {
      if (!renchan) end = top >= cfg.targetScore;
      else end = dealerIsTop && top >= cfg.targetScore; // agari-yame / tenpai-yame
    }

    s.result = {
      ...result,
      dora: s.k.dead.slice(4, 4 + s.k.doraCount),
      scores: s.players.map((p) => p.score),
      renchan,
      gameEnds: end,
      ready: [false, false, false, false],
    };
    s.next = { round, kyokuNum, honba };
    s.phase = 'result';
  }

  proceed() {
    const s = this.s;
    if (s.result.gameEnds) return this.finish();
    Object.assign(s, s.next);
    s.next = null;
    this.startKyoku();
  }

  finish() {
    const s = this.s;
    const order = this.ranking();
    s.players[order[0]].score += s.kyoutaku * 1000;
    s.kyoutaku = 0;
    const cfg = s.config;
    const oka = ((cfg.targetScore - cfg.startScore) * 4) / 1000;
    s.final = order.map((seat, rank) => {
      const score = s.players[seat].score;
      const pts = (score - cfg.targetScore) / 1000 + cfg.uma[rank] + (rank === 0 ? oka : 0);
      return { seat, name: s.players[seat].name, score, rank: rank + 1, points: Math.round(pts * 10) / 10 };
    });
    s.phase = 'end';
    this.event({ type: 'end' });
  }

  // ----------------------------------------------------------------- view

  view(seat) {
    const s = this.s;
    const k = s.k;
    let options = null;
    if (s.phase === 'turn' && k.turn === seat) options = { kind: 'turn', ...this.turnOptions(seat) };
    if (s.phase === 'response' && k.pending.opts[seat] && !k.pending.resp[seat]) {
      options = { kind: 'response', tile: k.pending.tile, from: k.pending.from, ...k.pending.opts[seat] };
    }
    const mine = k.hands[seat];
    const drawn = k.turn === seat && k.drawn !== null ? k.drawn : null;
    return {
      seat,
      phase: s.phase,
      round: s.round,
      kyokuNum: s.kyokuNum,
      honba: s.honba,
      kyoutaku: s.kyoutaku,
      dealer: this.dealer(),
      wallLeft: k.wall.length,
      dora: k.dead.slice(4, 4 + k.doraCount),
      turn: k.turn,
      players: s.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        wind: this.seatWind(i) - 27,
        riichi: !!k.riichi[i],
        handCount: k.hands[i].length - (k.turn === i && k.drawn !== null ? 1 : 0),
        hasDrawn: k.turn === i && k.drawn !== null,
        melds: k.melds[i],
        discards: k.discards[i],
      })),
      hand: sortTiles(mine.filter((x) => x !== drawn)),
      drawn,
      furiten: this.isFuriten(seat),
      options,
      result: s.result,
      final: s.final,
      events: s.events,
      config: s.config,
    };
  }
}

function sameIds(a, b) {
  return a.length === b.length && sortTiles(a).join() === sortTiles(b).join();
}

// Distinct id pairs drawn from candidate lists, distinguishing red fives.
// [[same]] x [[same]] -> pairs from one list; with `cross`, one from each list.
function idPairs([a], [b], cross = false) {
  const pick = (list) => {
    const reds = list.filter((x) => x === 16 || x === 52 || x === 88);
    const plain = list.filter((x) => !reds.includes(x));
    return { reds, plain };
  };
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const key = p.map((x) => (x === 16 || x === 52 || x === 88 ? 'r' : 'n') + (x >> 2)).sort().join();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  };
  if (cross) {
    const A = pick(a);
    const B = pick(b);
    for (const x of [...A.plain.slice(0, 1), ...A.reds]) for (const y of [...B.plain.slice(0, 1), ...B.reds]) add([x, y]);
    return out;
  }
  const { reds, plain } = pick(a);
  if (plain.length >= 2) add([plain[0], plain[1]]);
  if (reds.length && plain.length >= 1) add([reds[0], plain[0]]);
  return out;
}
