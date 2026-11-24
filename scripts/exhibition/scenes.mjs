// Turns the exhibition match into scenes for the animation lab: one per
// hand, from the shuffle to the result, with the exhibition's cast at the
// table. The match is played again from its seed and must come out exactly
// as the saved record (partida-600.json); if the engine or majiang-ai have
// changed and it does not, the script stops.
//
// Usage: node scripts/exhibition/scenes.mjs [--asiento 3]
//   --asiento   whose seat the table is seen from (default: the base
//               style's, Momo in the chosen match)
// Writes public/lab/exhibicion.json (not in git: it is big and can always
// be made again), which /lab.html loads next to its own scenes. The scenes
// carry the four hands and open in the broadcast view (#87).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CHARACTERS } from '../../public/js/shared/characters.js';
import { CAST, play, seating } from './match.js';

const SEED = 600;
const saved = JSON.parse(readFileSync(new URL('./partida-600.json', import.meta.url)));

const args = process.argv.slice(2);
const at = args.indexOf('--asiento');
const styles = seating(SEED);
const seat = at < 0 ? styles.indexOf('base') : Number(args[at + 1]);
const cast = styles.map((s) => CAST[s]);
const names = cast.map((id) => CHARACTERS.find((c) => c.id === id).name);

// the view as the client gets it from the server (as in lab-scenarios.mjs)
function view(g) {
  const v = JSON.parse(JSON.stringify(g.view(seat)));
  v.players.forEach((p, i) => Object.assign(p, { online: true, bot: i !== seat, abandoned: false, team: null }));
  v.clock = null;
  v.intro = null;
  // the four hands, for the broadcast view (#87)
  v.broadcast = { hands: [0, 1, 2, 3].map((i) => g.handOf(i)) };
  return v;
}

// How long the table rests after each kind of move (ms)
const INTRO = 8500;
const GAP = { discard: 700, riichi: 1600, pon: 1000, chi: 1000, minkan: 1100, ankan: 1100, kakan: 1100, pass: 500 };
// (the hand, the dora and the payment with sticks, #98)
const RESULT = 11000;

const hands = [];
let rec = null;
function close() {
  if (rec) hands.push(rec);
  rec = null;
}

const game = play(SEED, {
  names,
  onKyoku(g) {
    close();
    const v = view(g);
    v.intro = { left: 8000, total: 8000 };
    rec = { steps: [{ at: 0, view: v }], t: INTRO };
  },
  onAct(g, who, a) {
    // a pass that leaves the call window open changes nothing on the table
    if (a.type === 'pass' && g.s.phase === 'response') return;
    rec.steps.push({ at: rec.t, view: view(g) });
    rec.t += g.s.phase === 'result' ? RESULT : GAP[a.type] ?? 800;
  },
});
close();

// the same match as the saved record, hand by hand
const same = game.kyokus.length === saved.kyokus.length
  && game.kyokus.every((k, i) => JSON.stringify(k) === JSON.stringify(saved.kyokus[i]));
if (!same) {
  console.error('La partida no sale igual al registro guardado: cambió el motor o majiang-ai. No se escriben escenas.');
  process.exit(1);
}

const WIND = { E: 'Este', S: 'Sur', W: 'Oeste', N: 'Norte' };
function title(k) {
  const [, w, n, honba] = k.name.match(/^(\w)(\d)-(\d+)$/);
  return `${WIND[w]} ${n}${honba !== '0' ? `, ${honba} honba` : ''}`;
}
function note(k) {
  if (k.type !== 'agari') return 'Empate.';
  return k.wins.map((w) => {
    const how = w.tsumo ? 'tsumo' : `ron de ${names[w.from]}`;
    const yaku = w.yaku.filter(([, h]) => h > 0).map(([y]) => y).join(', ');
    return `${names[w.seat]} gana por ${how}${w.label ? ` (${w.label})` : ''}: ${yaku}. ${w.points} puntos.`;
  }).join(' ');
}

// the cast from the seat the table is seen from: me, then right, across, left
const order = [0, 1, 2, 3].map((i) => cast[(seat + i) % 4]);
const scenes = hands.map((h, i) => {
  const k = game.kyokus[i];
  return {
    id: `p600-${String(i + 1).padStart(2, '0')}`,
    name: `Exhibición · ${title(k)}`,
    note: `Partida de exhibición (semilla ${SEED}), mano ${i + 1} de ${hands.length}, vista desde ${names[seat]}. ${note(k)}`,
    cast: order,
    // seen as a broadcast: the four players and their hands open (#87)
    broadcast: true,
    steps: h.steps,
    length: h.t,
  };
});

mkdirSync(new URL('../../public/lab/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../public/lab/exhibicion.json', import.meta.url), JSON.stringify({ scenes }));
for (const s of scenes) console.log(`${s.id}  ${s.name}: ${s.steps.length} vistas, ${(s.length / 1000).toFixed(1)} s`);
const total = scenes.reduce((n, s) => n + s.length, 0);
console.log(`\n${scenes.length} escenas, ${(total / 60000).toFixed(1)} minutos`);
