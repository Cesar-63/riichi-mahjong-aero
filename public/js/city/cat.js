// The black cat that keeps the player company in town, with no drawing in
// it (the tests run this in node): it follows the player through every
// zone without walking through walls, and every so often meows and says
// something about kan. Its words and its timing are data (map.json "cat").

import { blocked } from './logic.js';

export const CAT_RADIUS = 0.16;
export const CAT_NEAR = 0.8; // it stops this close to the player
export const CAT_FAR = 1.2; // and sets off again when farther than this
export const CAT_RUN = 3.6; // metres per second, at most (a bit faster than the player)
export const CAT_LOST = 5; // farther than this (or stuck), it catches up at once
const TURN = 10;

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createCat(map, state) {
  const s = map.cat.start;
  return { zone: state.zone, x: s.x, z: s.z, facing: s.facing || 0, moving: false, stuck: 0, idle: 0 };
}

// A free spot near the player for the cat: behind them first, then to the
// sides, then in front
export function spotNear(zone, state) {
  for (const turn of [Math.PI, Math.PI * 0.75, -Math.PI * 0.75, Math.PI / 2, -Math.PI / 2, 0]) {
    for (const d of [CAT_NEAR, 0.55, 0.4]) {
      const a = state.facing + turn;
      const x = state.x + Math.sin(a) * d;
      const z = state.z + Math.cos(a) * d;
      if (!blocked(zone, x, z, CAT_RADIUS)) return { x, z };
    }
  }
  return { x: state.x, z: state.z };
}

function catchUp(cat, zone, state) {
  const p = spotNear(zone, state);
  Object.assign(cat, { zone: state.zone, x: p.x, z: p.z, facing: state.facing, moving: false, stuck: 0 });
}

// One step of the cat after the player's step. Returns true if it jumped to
// the player (a new zone, or it was left behind).
export function followCat(cat, state, map, dt) {
  const zone = map.zones[state.zone];
  if (cat.zone !== state.zone) {
    // through a door: it shows up by the player once the screen clears
    if (state.fade) return false;
    catchUp(cat, zone, state);
    return true;
  }
  const dx = state.x - cat.x;
  const dz = state.z - cat.z;
  const d = Math.hypot(dx, dz);
  if (d > CAT_LOST || cat.stuck > 1.5) {
    catchUp(cat, zone, state);
    return true;
  }
  if (cat.moving ? d < CAT_NEAR : d > CAT_FAR) cat.moving = !cat.moving;
  if (cat.moving) {
    cat.idle = 0;
    const speed = Math.min(CAT_RUN, 1.4 + (d - CAT_NEAR) * 2.5);
    const ux = dx / d;
    const uz = dz / d;
    const x0 = cat.x;
    const z0 = cat.z;
    const nx = cat.x + ux * speed * dt;
    if (!blocked(zone, nx, cat.z, CAT_RADIUS)) cat.x = nx;
    const nz = cat.z + uz * speed * dt;
    if (!blocked(zone, cat.x, nz, CAT_RADIUS)) cat.z = nz;
    const moved = Math.hypot(cat.x - x0, cat.z - z0);
    cat.stuck = moved < speed * dt * 0.2 ? cat.stuck + dt : 0;
    cat.facing += angleDiff(Math.atan2(ux, uz), cat.facing) * Math.min(1, dt * TURN);
  } else {
    cat.idle += dt;
    cat.stuck = 0;
    // sitting, it keeps an eye on the player
    if (d > 0.05) cat.facing += angleDiff(Math.atan2(dx, dz), cat.facing) * Math.min(1, dt * 2);
  }
  return false;
}

// ---------------------------------------------------------------- talk
// When the cat speaks: "first" seconds after arriving, then every "every"
// seconds. It goes through all its lines in a shuffled order before
// repeating any, and never says the same one twice in a row.
export function createChatter(cfg) {
  return { t: 0, next: cfg.first ?? cfg.every, bag: [], last: -1 };
}

export function tickChatter(ch, cfg, dt, rand = Math.random) {
  ch.t += dt;
  if (ch.t < ch.next) return null;
  ch.next += cfg.every;
  if (!ch.bag.length) {
    ch.bag = cfg.lines.map((_, i) => i);
    for (let i = ch.bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ch.bag[i], ch.bag[j]] = [ch.bag[j], ch.bag[i]];
    }
    if (ch.bag.length > 1 && ch.bag[ch.bag.length - 1] === ch.last) ch.bag.unshift(ch.bag.pop());
  }
  ch.last = ch.bag.pop();
  return cfg.lines[ch.last];
}

// How long a line stays on screen, in seconds: enough to read it
export const sayFor = (text) => Math.min(12, Math.max(4, 2.5 + text.length * 0.06));

// What is wrong with the cat of a map, as sentences (none: nothing)
export function catProblems(map) {
  const c = map.cat;
  if (!c) return [];
  const out = [];
  const zone = map.zones?.[map.start?.zone];
  if (!c.start || !zone) out.push('el gato no tiene dónde empezar');
  else if (blocked(zone, c.start.x, c.start.z, CAT_RADIUS)) out.push(`el gato empieza en un lugar bloqueado (${c.start.x}, ${c.start.z})`);
  if (!(c.every > 0)) out.push('el gato no tiene cada cuánto hablar');
  if (!Array.isArray(c.lines) || c.lines.length < 2 || c.lines.some((l) => typeof l !== 'string' || !l.trim())) out.push('al gato le faltan frases');
  if (c.table && (!Array.isArray(c.table) || c.table.some((l) => typeof l !== 'string' || !l.trim()))) out.push('las frases del gato en la mesa no son texto');
  return out;
}

// ------------------------------------------------------------ at the table
// In a game started in town the cat may climb on the table: at most once
// per game, with a chance (0.5) at the start of each hand until it does.
// memo ({ key, done }) is kept by the caller across reloads; key names the
// hand, so a hand is only rolled once.
export const TABLE_CHANCE = 0.5;
export function tableVisit(memo, key, rand = Math.random, chance = TABLE_CHANCE) {
  if (memo.done || memo.key === key) return false;
  memo.key = key;
  if (rand() >= chance) return false;
  memo.done = true;
  return true;
}

// What it says up there: a line of its table lines, and half the time one
// of its stories after it
export function tableLines(cfg, rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const out = [pick(cfg.table?.length ? cfg.table : cfg.lines)];
  if (rand() < 0.5) out.push(pick(cfg.lines));
  return out;
}
