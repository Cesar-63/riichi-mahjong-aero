// The town's rules, with no drawing in them (the tests run this in node):
// walking with collisions, the doors that lead from one zone to another, the
// prompt of a mahjong table and remembering where the player stood. The map
// (public/city/map.json) is data: zones, doors, tables, NPCs.
//
// Ground coordinates are x and z in metres; `facing` is the angle of the
// way someone looks, 0 towards +z and growing towards +x.

export const PLAYER_RADIUS = 0.28;
export const SPEED = 3; // metres per second
export const TURN = 12; // how fast the body turns to where it walks
export const FADE = 0.3; // seconds of each half of the fade between zones
export const NPC_RADIUS = 0.3;

const colliders = new WeakMap();

// What stops the player in a zone: the footprint of every solid box, and a
// circle for each table, NPC and extra collider.
export function zoneColliders(zone) {
  let c = colliders.get(zone);
  if (c) return c;
  c = {
    rects: (zone.boxes || []).filter((b) => b.solid).map((b) => ({ minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2] })),
    circles: [
      ...(zone.tables || []).map((t) => ({ x: t.x, z: t.z, r: t.radius })),
      ...(zone.npcs || []).map((n) => ({ x: n.x, z: n.z, r: NPC_RADIUS })),
      ...(zone.colliders || []),
    ],
  };
  colliders.set(zone, c);
  return c;
}

// Whether someone of radius r cannot stand at (x, z)
export function blocked(zone, x, z, r = PLAYER_RADIUS) {
  const b = zone.bounds;
  if (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r) return true;
  const { rects, circles } = zoneColliders(zone);
  for (const q of rects) {
    if (x > q.minX - r && x < q.maxX + r && z > q.minZ - r && z < q.maxZ + r) return true;
  }
  for (const c of circles) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  }
  return false;
}

export function createState(map, character) {
  const s = map.start;
  return {
    character: map.characters.includes(character) ? character : map.characters[0],
    zone: s.zone, x: s.x, z: s.z, facing: s.facing || 0,
    moving: false,
    fade: null, // { phase: 'out' | 'in', t, to } while going through a door
  };
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// The table the player is close enough to sit at, if any
export function tableInReach(state, map) {
  if (state.fade) return null;
  for (const t of map.zones[state.zone].tables || []) {
    if (Math.hypot(state.x - t.seat.x, state.z - t.seat.z) <= t.reach) return t;
  }
  return null;
}

// What the screen offers to do right now: { key, text, table } or null
export function promptFor(state, map) {
  const table = tableInReach(state, map);
  return table ? { key: 'E', text: `Presiona E para ${table.prompt || 'sentarte'}`, table } : null;
}

// One step of the town. input: { x, z } the way to walk on the ground (any
// length up to 1) and `interact` (E was pressed). Returns what happened:
// { type: 'door', door }, { type: 'zone', from, to } and { type: 'sit', table }.
export function step(state, map, input, dt) {
  const events = [];
  if (state.fade) {
    // going through a door: nobody walks while the screen is dark
    const f = state.fade;
    state.moving = false;
    f.t += dt;
    if (f.phase === 'out' && f.t >= FADE) {
      const from = state.zone;
      Object.assign(state, { zone: f.to.zone, x: f.to.x, z: f.to.z, facing: f.to.facing || 0 });
      state.fade = { phase: 'in', t: 0, to: f.to };
      events.push({ type: 'zone', from, to: state.zone, door: f.to });
    } else if (f.phase === 'in' && f.t >= FADE) state.fade = null;
    return events;
  }
  const zone = map.zones[state.zone];
  if (input.interact) {
    const table = tableInReach(state, map);
    if (table) {
      state.moving = false;
      events.push({ type: 'sit', table });
      return events;
    }
  }
  let dx = input.x || 0;
  let dz = input.z || 0;
  const len = Math.hypot(dx, dz);
  state.moving = len > 0.05;
  if (state.moving) {
    if (len > 1) { dx /= len; dz /= len; }
    const want = Math.atan2(dx, dz);
    state.facing += angleDiff(want, state.facing) * Math.min(1, dt * TURN);
    // each axis on its own, so walking into a wall slides along it
    const nx = state.x + dx * SPEED * dt;
    if (!blocked(zone, nx, state.z)) state.x = nx;
    const nz = state.z + dz * SPEED * dt;
    if (!blocked(zone, state.x, nz)) state.z = nz;
  }
  for (const door of zone.doors || []) {
    if (Math.hypot(state.x - door.x, state.z - door.z) < door.radius) {
      state.fade = { phase: 'out', t: 0, to: door.to };
      state.moving = false;
      events.push({ type: 'door', door });
      break;
    }
  }
  return events;
}

// How dark the screen is (0 to 1) while going through a door
export function fadeAlpha(state) {
  const f = state.fade;
  if (!f) return 0;
  const u = Math.min(1, f.t / FADE);
  return f.phase === 'out' ? u : 1 - u;
}

// Where the player stands, to come back to after a game of mahjong
export function snapshot(state) {
  return { character: state.character, zone: state.zone, x: state.x, z: state.z, facing: state.facing };
}

// The state a snapshot describes; the start of the map if it makes no sense
// (another map, a wall where the player was)
export function restore(map, snap) {
  const state = createState(map, snap && snap.character);
  const zone = snap && map.zones[snap.zone];
  if (zone && [snap.x, snap.z, snap.facing].every(Number.isFinite) && !blocked(zone, snap.x, snap.z)) {
    Object.assign(state, { zone: snap.zone, x: snap.x, z: snap.z, facing: snap.facing });
  }
  return state;
}

// What is wrong with a map, as a list of sentences (empty: nothing). A new
// zone added to map.json is checked by the tests through this.
export function mapProblems(map) {
  const out = [];
  const zones = map.zones || {};
  const free = (name, p, what) => {
    const zone = zones[name];
    if (!zone) return out.push(`${what}: no existe la zona "${name}"`);
    if (blocked(zone, p.x, p.z)) out.push(`${what}: (${p.x}, ${p.z}) de "${name}" está bloqueado`);
    for (const d of zone.doors || []) {
      if (Math.hypot(p.x - d.x, p.z - d.z) < d.radius + 0.1) out.push(`${what}: cae dentro de la puerta "${d.id}" de "${name}"`);
    }
    return null;
  };
  if (!Array.isArray(map.characters) || !map.characters.length) out.push('faltan los personajes');
  if (!map.start) out.push('falta el punto de inicio');
  else free(map.start.zone, map.start, 'inicio');
  for (const [name, zone] of Object.entries(zones)) {
    if (!zone.bounds) out.push(`"${name}" no tiene límites`);
    if (!zone.camera) out.push(`"${name}" no tiene cámara`);
    for (const d of zone.doors || []) free(d.to.zone, d.to, `puerta "${d.id}" de "${name}"`);
    for (const t of zone.tables || []) free(name, t.seat, `asiento de la mesa "${t.id}"`);
  }
  return out;
}
