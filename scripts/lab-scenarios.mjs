// Builds the scenes of the animation lab (public/lab.html) with the real
// game engine: scripted hands and walls, played move by move, each table
// view saved with the moment it reaches the table. Every run of a scene is
// then the same. Usage: npm run lab:scenarios  (writes public/lab/scenarios.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { Game } from '../server/engine/game.js';
import { parseIds, tileType } from '../public/js/shared/tiles.js';

const NAMES = ['Tú', 'Bot 1', 'Bot 2', 'Bot 3'];

// fixed random numbers, so the deals and walls never change
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A game whose four hands and first wall tiles are given (as in the
// engine's tests); the dealer (me, seat 0) has drawn.
function scripted(hands, front, seed = 1) {
  const g = Game.create(NAMES, {}, seeded(seed));
  const used = new Set();
  const k = g.s.k;
  k.hands = hands.map((h) => parseIds(h, used));
  const first = parseIds(front, used);
  const rest = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  k.dead = rest.splice(rest.length - 14, 14);
  k.wall = [...first, ...rest];
  k.drawn = null;
  g.draw(0);
  return g;
}

// the view as the client gets it from the server
function view(g, seat = 0) {
  const v = JSON.parse(JSON.stringify(g.view(seat)));
  v.players.forEach((p, i) => Object.assign(p, { online: true, bot: i !== seat, abandoned: false, team: null }));
  v.clock = null;
  v.intro = null;
  return v;
}

const idOf = (g, seat, t) => g.s.k.hands[seat].find((x) => tileType(x) === t);
const T = (s) => tileType(parseIds(s)[0]);
const passAll = (g, except = -1) => {
  while (g.s.phase === 'response') {
    const seat = g.pendingSeats().find((x) => x !== except);
    if (seat === undefined) return;
    g.act(seat, { type: 'pass' });
  }
};
const tsumogiri = (g, seat) => g.act(seat, { type: 'discard', tile: g.s.k.drawn !== null ? g.s.k.drawn : g.s.k.hands[seat][0] });

// A scene: views at given moments; gap = ms between moves.
function recorder(seat = 0) {
  const steps = [];
  let at = 0;
  return {
    steps,
    add(g, gap = 700) {
      steps.push({ at, view: view(g, seat) });
      at += gap;
    },
    get end() {
      return at;
    },
  };
}

const scenes = [];

// ----------------------------------------------------------------- intro
{
  const g = Game.create(NAMES, {}, seeded(7));
  const v = view(g);
  v.intro = { left: 8000, total: 8000 };
  scenes.push({ id: 'intro', name: 'Inicio de mano', note: 'Revolver, armar y empujar los muros, dados y reparto (8 s).', steps: [{ at: 0, view: v }], length: 9000 });
}

// ------------------------------------------------------- discards, draws
{
  const g = Game.create(NAMES, {}, seeded(3));
  g.s.honba = 3; // three honba sticks at my right (I deal), out of my tray
  g.s.kyoutaku = 2; // two riichi deposits left from earlier hands, in the middle
  const rec = recorder();
  rec.add(g, 900);
  // me: a tile from inside the hand (tedashi), then the others tsumogiri
  g.act(0, { type: 'discard', tile: g.s.k.hands[0][3] });
  passAll(g);
  rec.add(g);
  for (const seat of [1, 2, 3]) {
    tsumogiri(g, seat);
    passAll(g);
    rec.add(g);
  }
  // me again: the drawn tile (tsumogiri)
  tsumogiri(g, 0);
  passAll(g);
  rec.add(g);
  for (const seat of [1, 2]) {
    tsumogiri(g, seat);
    passAll(g);
    rec.add(g);
  }
  scenes.push({ id: 'discards', name: 'Robos y descartes', note: 'Tu descarte de la mano (tedashi), los rivales robando y descartando, y tu tsumogiri. Honba 3: los tres palitos de 100 a tu derecha (eres oya). Dos depósitos de riichi de manos anteriores en el centro.', steps: rec.steps, length: rec.end + 800 });
}

// ------------------------------------------------------------ rival pon
{
  const g = scripted(['123m456p789s123z5z', '55z123m456p789s11z', '258m258p258s1357z', '369m369p369s2466z'], '7z');
  const rec = recorder();
  rec.add(g, 900);
  g.act(0, { type: 'discard', tile: idOf(g, 0, T('5z')) });
  rec.add(g, 600);
  const o = g.view(1).options;
  passAll(g, 1);
  g.act(1, { type: 'pon', tiles: o.pon[0] });
  passAll(g);
  rec.add(g, 1000);
  g.act(1, { type: 'discard', tile: idOf(g, 1, T('1z')) });
  passAll(g);
  rec.add(g);
  tsumogiri(g, 2);
  passAll(g);
  rec.add(g);
  scenes.push({ id: 'rival-pon', name: 'Pon de un rival', note: 'Descartas un dragón blanco y el rival de la derecha hace pon.', steps: rec.steps, length: rec.end + 800 });
}

// ----------------------------------------------------- my pon and my chi
{
  const g = scripted(['33p46s123m789m11z55z7z', '19m19p19s1234z56z6z', '258m258p258s1357z', '369m369p369s2477z'], '9p2z3p4z6z5s');
  const rec = recorder();
  rec.add(g, 900);
  tsumogiri(g, 0);
  passAll(g);
  rec.add(g);
  tsumogiri(g, 1);
  passAll(g);
  rec.add(g);
  tsumogiri(g, 2); // 3p: I pon it
  const pon = g.view(0).options;
  passAll(g, 0);
  g.act(0, { type: 'pon', tiles: pon.pon[0] });
  passAll(g);
  rec.add(g, 1000);
  g.act(0, { type: 'discard', tile: idOf(g, 0, T('7z')) });
  passAll(g);
  rec.add(g);
  for (const seat of [1, 2]) {
    tsumogiri(g, seat);
    passAll(g);
    rec.add(g);
  }
  tsumogiri(g, 3); // 5s: I chi it with 4s 6s
  const chi = g.view(0).options;
  passAll(g, 0);
  g.act(0, { type: 'chi', tiles: chi.chi[0].tiles });
  passAll(g);
  rec.add(g, 1000);
  g.act(0, { type: 'discard', tile: idOf(g, 0, T('1z')) });
  passAll(g);
  rec.add(g);
  scenes.push({ id: 'my-calls', name: 'Tu pon y tu chi', note: 'Haces pon a un descarte del rival de enfrente y después chi al de la izquierda.', steps: rec.steps, length: rec.end + 800 });
}

// ------------------------------------------- rival riichi, then ron on me
function riichiRon() {
  const g = scripted(['4m7z11z22z33z44z55z6z', '23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z'], '9p9m8p8s9s');
  return g;
}
{
  const g = riichiRon();
  const rec = recorder();
  rec.add(g, 900);
  g.act(0, { type: 'discard', tile: idOf(g, 0, 33) });
  passAll(g);
  rec.add(g);
  g.act(1, { type: 'riichi', tile: g.s.k.drawn });
  passAll(g);
  rec.add(g, 1600);
  for (const seat of [2, 3]) {
    tsumogiri(g, seat);
    passAll(g);
    rec.add(g);
  }
  g.act(0, { type: 'discard', tile: idOf(g, 0, 3) });
  rec.add(g, 500);
  g.act(1, { type: 'ron' });
  passAll(g);
  rec.add(g, 7000);
  scenes.push({ id: 'riichi-ron', name: 'Riichi y ron de un rival', note: 'El rival de la derecha declara riichi (palito) y te hace ron: la mano cae, la ficha del ron vuela y llegan dora y ura.', steps: rec.steps, length: rec.end });
}

// ------------------------------------------------------------- my tsumo
function myTsumo() {
  const g = scripted(['23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z', '369m369p369s2466z'], '7z3z5z1z4m');
  const steps = recorder();
  steps.add(g, 900);
  for (const seat of [0, 1, 2, 3]) {
    tsumogiri(g, seat);
    passAll(g);
    steps.add(g);
  }
  // my draw is 4m: tsumo
  g.act(0, { type: 'tsumo' });
  steps.add(g, 7000);
  return steps;
}
{
  const rec = myTsumo();
  scenes.push({ id: 'my-tsumo', name: 'Tu tsumo', note: 'Ganas robando: tu mano se apoya parada en la mesa y cae, y llegan los dora.', steps: rec.steps, length: rec.end });
}

// -------------------------------------------- my tsumo with an open hand
{
  const rec = myTsumo();
  // three kans of tile kinds nobody holds, the hand cut to match
  const seen = new Set();
  for (const s of rec.steps) {
    const v = s.view;
    for (const id of [...v.hand, ...(v.drawn !== null ? [v.drawn] : []), ...v.dora]) seen.add(id);
    for (const p of v.players) for (const d of p.discards) seen.add(d.tile);
  }
  const kinds = [];
  for (let t = 0; t < 34 && kinds.length < 3; t++) if ([0, 1, 2, 3].every((n) => !seen.has(4 * t + n))) kinds.push(t);
  const ids = (t) => [0, 1, 2, 3].map((n) => 4 * t + n);
  const melds = [
    { type: 'minkan', tiles: ids(kinds[0]), called: ids(kinds[0])[3], from: 3 },
    { type: 'ankan', tiles: ids(kinds[1]), from: 0 },
    { type: 'minkan', tiles: ids(kinds[2]), called: ids(kinds[2])[3], from: 2 },
  ];
  for (const s of rec.steps) {
    const v = s.view;
    const keep = v.hand.filter((id) => [T('2m'), T('3m'), T('1p')].includes(tileType(id)));
    v.hand = keep;
    v.players[0].melds = melds;
    v.players[0].handCount = keep.length;
    if (v.result) {
      const w = v.result.wins[0];
      w.hand = keep;
      w.melds = melds;
    }
  }
  scenes.push({ id: 'open-win', name: 'Tu tsumo con tres kan', note: 'Mano abierta: las llamadas se acomodan junto a la mano tumbada y la cámara encuadra todo.', steps: rec.steps, length: rec.end });
}

// --------------------------------------------------------- exhaustive draw
{
  const g = scripted(['23m456p789s11p678s', '19m19p19s1234z56z7z', '258m258p258s1357z', '369m369p369s2466z'], '7z', 11);
  // everybody discards what they draw until the last few moves
  let left = 400;
  while (g.s.phase !== 'result' && g.s.k.wall.length > 6 && left--) {
    if (g.s.phase === 'response') passAll(g);
    else tsumogiri(g, g.s.k.turn);
  }
  const rec = recorder();
  rec.add(g, 600);
  while (g.s.phase !== 'result' && left--) {
    if (g.s.phase === 'response') passAll(g);
    else {
      tsumogiri(g, g.s.k.turn);
      rec.add(g, 600);
    }
  }
  rec.add(g, 6000);
  scenes.push({ id: 'exhaustive', name: 'Empate', note: 'Se acaba la pared: las manos quedan paradas y caen, tenpai boca arriba y noten boca abajo.', steps: rec.steps, length: rec.end });
}

mkdirSync(new URL('../public/lab/', import.meta.url), { recursive: true });
const out = new URL('../public/lab/scenarios.json', import.meta.url);
writeFileSync(out, JSON.stringify({ scenes }));
console.log(scenes.map((s) => `${s.id}: ${s.steps.length} vistas, ${s.length} ms`).join('\n'));
