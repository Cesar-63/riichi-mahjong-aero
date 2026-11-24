// The play-by-play of a broadcast (#87): what happened between two views of
// the same table, in short lines ("Momo descarta 5筒", "Tatsuo: pon de 中",
// "Kaito declara riichi", "Shiro gana por ron a Momo: 12000"). Plain data,
// no DOM, so the tests can read it. Draws are left out: there is one every
// turn and the discard says it all.
import { tileType, isAka, numOf, suitOf, HONOR_KANJI, SUIT_KANJI, DRAW_NAMES } from './tiles.js';

const WIND_ES = ['Este', 'Sur', 'Oeste', 'Norte'];
const CALL = { chi: 'chi', pon: 'pon', minkan: 'kan', ankan: 'kan cerrado', kakan: 'kan añadido' };

// 5筒, 中, 5萬 rojo
export function tileLabel(id) {
  const t = tileType(id);
  if (t >= 27) return HONOR_KANJI[t - 27];
  return `${numOf(t)}${SUIT_KANJI[suitOf(t)]}${isAka(id) ? ' rojo' : ''}`;
}

const handKey = (v) => `${v.round}-${v.kyokuNum}-${v.honba}`;

// Lines for the step from prev (null at the start) to next: [{ text, kind }]
// with kind 'hand' (a new hand starts), 'discard', 'call', 'riichi',
// 'win' or 'draw'.
export function describeStep(prev, next) {
  const out = [];
  if (!next || !next.players) return out;
  const name = (abs) => next.players[abs].name;
  const fresh = !prev || handKey(prev) !== handKey(next) || next.intro;
  if (fresh && next.phase !== 'end') {
    const honba = next.honba ? `, ${next.honba} honba` : '';
    out.push({ kind: 'hand', text: `${WIND_ES[next.round] || '?'} ${next.kyokuNum + 1}${honba} · reparte ${name(next.dealer)}` });
  }
  const before = fresh ? null : prev;
  if (before) {
    // discards first (a called one stays in the pond, marked), then the
    // calls on them: new melds, and a pon that became a kan
    next.players.forEach((p, abs) => {
      for (const d of p.discards.slice(before.players[abs].discards.length)) {
        out.push({ kind: d.riichi ? 'riichi' : 'discard', text: `${name(abs)} ${d.riichi ? 'declara riichi y descarta' : 'descarta'} ${tileLabel(d.tile)}${d.tsumogiri ? ' (la que robó)' : ''}` });
      }
    });
    next.players.forEach((p, abs) => {
      p.melds.forEach((m, i) => {
        const old = before.players[abs].melds[i];
        if (old && old.type === m.type) return;
        const tile = m.type === 'kakan' ? m.added ?? m.called : m.called ?? m.tiles[0];
        const from = m.type !== 'ankan' && m.type !== 'kakan' && m.from !== undefined ? ` de ${name(m.from)}` : '';
        out.push({ kind: 'call', text: `${name(abs)}: ${CALL[m.type] || m.type} de ${tileLabel(tile)}${from}` });
      });
    });
  }
  // the end of the hand
  const res = next.phase === 'result' ? next.result : null;
  const hadResult = before && before.phase === 'result';
  if (res && !hadResult) {
    if (res.type === 'agari') {
      for (const w of res.wins) {
        const how = w.tsumo ? 'por tsumo' : `por ron a ${name(w.from)}`;
        out.push({ kind: 'win', text: `${name(w.seat)} gana ${how}: ${w.points}${w.label ? ` (${w.label})` : ''}` });
      }
    } else {
      const why = (DRAW_NAMES[res.reason] || [, 'Empate'])[1];
      const tenpai = (res.tenpai || []).map(name);
      out.push({ kind: 'draw', text: res.abortive ? `Empate abortivo: ${why}` : `Empate${tenpai.length ? ` · tenpai: ${tenpai.join(', ')}` : ' · nadie en tenpai'}` });
    }
  }
  return out;
}
