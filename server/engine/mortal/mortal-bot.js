// Hard bots: Mortal (https://github.com/Equim-chan/Mortal, AGPL-3.0) with the
// community weights Mortal-S42 (Apache-2.0). Everything Mortal-specific lives
// in this folder; see mortal/README.md.
//
// Each decision replays the kyoku's mjai log from the bot's seat through
// libriichi (encoder.wasm), runs the network (mortal-s42.onnx) and maps the
// best legal of its 46 actions to an engine action. Riichi and kan take a
// second look, as in Mortal: first "riichi", then which tile to discard;
// first "kan", then which one.
import * as ort from 'onnxruntime-web';
import { readFileSync } from 'node:fs';
import { tileType, isAka } from '../../../public/js/shared/tiles.js';
import { mjaiView } from '../mjai.js';
import { winsIntoLast } from '../majiang-bot.js';
import { encode, OBS_ROWS } from './encoder.js';

const env = (typeof process !== 'undefined' && process.env) || {};
ort.env.wasm.numThreads = Number(env.MORTAL_THREADS || 1);

let session = null;

function getSession() {
  if (!session) {
    session = ort.InferenceSession.create(readFileSync(new URL('./mortal-s42.onnx', import.meta.url)))
      .catch((e) => {
        session = null;
        throw e;
      });
  }
  return session;
}

// Loads the network ahead of the first decision (about half a second).
export const warmUp = () => getSession();

// Mortal's 46 actions: 0-33 discard that tile type, 34-36 the red fives,
// 37 riichi, 38-40 chi (called tile lowest / middle / highest), 41 pon,
// 42 kan, 43 win, 44 kyuushu kyuuhai, 45 pass.
const RED = { 34: 4, 35: 13, 36: 22 };
const kindOf = (a) => (a < 34 ? { t: a, red: false } : { t: RED[a], red: true });

async function qValues({ obs, mask }) {
  const s = await getSession();
  const { q } = await s.run({
    obs: new ort.Tensor('float32', obs, [1, OBS_ROWS, 34]),
    mask: new ort.Tensor('bool', mask, [1, 46]),
  });
  return q.data;
}

function best(q, mask, skip = -1) {
  let a = -1;
  for (let i = 0; i < 46; i++) if (mask[i] && i !== skip && (a < 0 || q[i] > q[a])) a = i;
  return a;
}

// Prefers spending a red five, as Mortal does when it calls.
const withRed = (options, ids) => options.find((x) => ids(x).some(isAka)) ?? options[0];

// Row 27 of the observation is the game's progress, kyoku / 7 (East 1 = 0,
// South 4 = 1).
const PROGRESS_ROW = 27;

// Mortal plays our East-only games as it is: telling it that East is the
// South of a hanchan made it play too safe (see mortal/README.md).
// `lastHand`: in East 4 of a tonpuusen, show it the progress of South 4.
export async function mortalAction(game, seat, { lastHand = false } = {}) {
  const s = game.s;
  const k = s.k;
  const o = game.view(seat).options;
  if (!o) return null;
  const events = mjaiView(k.mjai, seat);
  const markLast = lastHand && s.config.rounds === 1 && s.round === 0 && s.kyokuNum === 3;
  const look = (evs) => {
    const r = encode(evs, seat);
    if (r && markLast) {
      for (const obs of [r.obs, r.kan && r.kan.obs]) if (obs) obs.fill(1, PROGRESS_ROW * 34, PROGRESS_ROW * 34 + 34);
    }
    return r;
  };
  const enc = look(events);
  if (!enc) return null;
  const q = await qValues(enc);
  let a = best(q, enc.mask);
  const turn = s.phase === 'turn';
  if (a === 43 && winsIntoLast(game, seat, turn ? null : k.pending.from)) a = best(q, enc.mask, 43);
  if (a < 0) return null;

  if (turn) {
    const discard = (act) => {
      const { t, red } = kindOf(act);
      const ids = o.discard.filter((id) => tileType(id) === t && isAka(id) === red);
      return ids.find((id) => id === k.drawn) ?? ids[0];
    };
    if (a <= 36) {
      const id = discard(a);
      return id === undefined ? null : { type: 'discard', tile: id };
    }
    if (a === 37) {
      const after = look([...events, { type: 'reach', actor: seat }]);
      if (!after) return null;
      const id = discard(best(await qValues(after), after.mask));
      return o.riichi.includes(id) ? { type: 'riichi', tile: id } : null;
    }
    if (a === 42 && enc.kan) {
      const { t } = kindOf(best(await qValues(enc.kan), enc.kan.mask));
      if (o.ankan.includes(t)) return { type: 'ankan', t };
      if (o.kakan.includes(t)) return { type: 'kakan', t };
      return null;
    }
    if (a === 43) return o.tsumo ? { type: 'tsumo' } : null;
    if (a === 44) return o.kyuushu ? { type: 'kyuushu' } : null;
    return null;
  }

  if (a === 45) return { type: 'pass' };
  if (a === 43) return o.ron ? { type: 'ron' } : null;
  if (a === 42) return o.minkan ? { type: 'minkan' } : null;
  if (a === 41) return o.pon ? { type: 'pon', tiles: withRed(o.pon, (x) => x) } : null;
  if (a >= 38 && a <= 40) {
    const t = tileType(o.tile);
    const want = [[t + 1, t + 2], [t - 1, t + 1], [t - 2, t - 1]][a - 38].join();
    const fits = (o.chi || []).filter((c) => c.tiles.map(tileType).sort((x, y) => x - y).join() === want);
    return fits.length ? { type: 'chi', tiles: withRed(fits, (c) => c.tiles).tiles } : null;
  }
  return null;
}
