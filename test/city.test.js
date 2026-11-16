import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createState, step, promptFor, tableInReach, snapshot, restore, blocked, fadeAlpha, mapProblems, FADE, SPEED, PLAYER_RADIUS,
} from '../public/js/city/logic.js';
import { buildZone, zoneLights, tintAt, hexToRgb } from '../public/js/city/bake.js';

const map = JSON.parse(readFileSync(new URL('../public/city/map.json', import.meta.url)));
const DT = 1 / 30;
const still = { x: 0, z: 0 };

// walks straight at a point until an event of that type happens
function walkTo(state, x, z, type, max = 600) {
  for (let i = 0; i < max; i++) {
    const dx = x - state.x;
    const dz = z - state.z;
    const d = Math.hypot(dx, dz) || 1;
    const ev = step(state, map, { x: dx / d, z: dz / d }, DT).find((e) => e.type === type);
    if (ev) return ev;
  }
  return null;
}
const settle = (state) => {
  for (let i = 0; i < 60 && state.fade; i++) step(state, map, still, DT);
};
const door = (zone, id) => map.zones[zone].doors.find((d) => d.id === id);

test('the map is sound: every door and seat leads somewhere one can stand', () => {
  assert.deepEqual(mapProblems(map), []);
  for (const zone of ['room', 'street', 'jansou']) assert.ok(map.zones[zone], zone);
  assert.equal(map.zones.room.camera.type, 'fixed');
  assert.equal(map.zones.street.camera.type, 'follow');
  assert.equal(map.zones.jansou.npcs.length, 3);
});

test('a broken map is reported', () => {
  const bad = structuredClone(map);
  bad.zones.room.doors[0].to.zone = 'nowhere';
  bad.zones.jansou.tables[0].seat = { x: 1.4, z: -0.4 }; // inside the table
  const problems = mapProblems(bad);
  assert.equal(problems.length, 2);
});

test('the player starts in the bedroom with the chosen character', () => {
  const s = createState(map, 'momo');
  assert.equal(s.zone, 'room');
  assert.equal(s.character, 'momo');
  assert.equal(createState(map, 'nobody').character, map.characters[0]);
  assert.equal(promptFor(s, map), null);
});

test('walking moves at walking speed and turns the body', () => {
  const s = createState(map, 'shiro');
  const z0 = s.z;
  for (let i = 0; i < 6; i++) step(s, map, { x: 0, z: 1 }, DT);
  assert.ok(Math.abs(s.z - z0 - SPEED * 0.2) < 1e-6);
  assert.ok(s.moving);
  step(s, map, still, DT);
  assert.ok(!s.moving);
  // a diagonal is no faster
  const t = createState(map, 'shiro');
  for (let i = 0; i < 6; i++) step(t, map, { x: 1, z: -1 }, DT);
  assert.ok(Math.abs(Math.hypot(t.x - map.start.x, t.z - map.start.z) - SPEED * 0.2) < 1e-6);
});

test('walls and furniture stop the player, who slides along them', () => {
  const s = createState(map, 'shiro');
  const zone = map.zones.room;
  for (let i = 0; i < 300; i++) step(s, map, { x: -1, z: -1 }, DT);
  assert.ok(!blocked(zone, s.x, s.z));
  assert.ok(s.z >= zone.bounds.minZ + PLAYER_RADIUS - 1e-9);
  // the futon is in the way
  assert.ok(blocked(zone, -1.4, -1));
  assert.ok(blocked(zone, 5, 0));
  // the mahjong table and those sitting at it
  assert.ok(blocked(map.zones.jansou, 1.4, -0.4));
  assert.ok(blocked(map.zones.jansou, 2.2, -0.4));
});

test('room → street → jansou through the doors, with a fade', () => {
  const s = createState(map, 'kaito');
  const out = door('room', 'salir');
  assert.ok(walkTo(s, out.x, out.z, 'door'));
  assert.equal(s.zone, 'room'); // still fading out
  assert.ok(s.fade && s.fade.phase === 'out');
  // nobody walks during the fade
  const { x, z } = s;
  step(s, map, { x: 1, z: 0 }, DT);
  assert.deepEqual([s.x, s.z], [x, z]);
  let changed = null;
  for (let i = 0; i < 60 && !changed; i++) changed = step(s, map, still, DT).find((e) => e.type === 'zone');
  assert.deepEqual([changed.from, changed.to], ['room', 'street']);
  assert.equal(s.zone, 'street');
  assert.deepEqual([s.x, s.z], [out.to.x, out.to.z]);
  assert.ok(fadeAlpha(s) > 0.9);
  settle(s);
  assert.equal(s.fade, null);
  assert.equal(fadeAlpha(s), 0);
  // arriving does not send the player back through the door
  for (let i = 0; i < 30; i++) assert.deepEqual(step(s, map, still, DT), []);

  // down the middle of the street (the vending machine is in the way), then in
  const in2 = door('street', 'jansou');
  walkTo(s, in2.x, 0, 'door', 250);
  assert.equal(s.zone, 'street');
  assert.ok(walkTo(s, in2.x, in2.z, 'door'));
  settle(s);
  assert.equal(s.zone, 'jansou');
});

test('every door has a way back', () => {
  for (const [name, zone] of Object.entries(map.zones)) {
    for (const d of zone.doors) {
      assert.ok(map.zones[d.to.zone].doors.some((b) => b.to.zone === name), `${name}/${d.id}`);
    }
  }
});

test('the fade lasts its time on each side', () => {
  const s = createState(map, 'shiro');
  const out = door('room', 'salir');
  walkTo(s, out.x, out.z, 'door');
  let frames = 0;
  while (s.fade) { step(s, map, still, DT); frames++; }
  assert.ok(Math.abs(frames * DT - 2 * FADE) < 3 * DT);
});

test('the prompt shows only near the table, and E sits down', () => {
  const s = restore(map, { character: 'momo', zone: 'jansou', x: -3.55, z: 2.05, facing: 0 });
  assert.equal(s.zone, 'jansou');
  assert.equal(promptFor(s, map), null);
  // E far from the table does nothing
  assert.deepEqual(step(s, map, { ...still, interact: true }, DT), []);
  const table = map.zones.jansou.tables[0];
  for (let i = 0; i < 600 && !tableInReach(s, map); i++) {
    const d = Math.hypot(table.seat.x - s.x, table.seat.z - s.z);
    step(s, map, { x: (table.seat.x - s.x) / d, z: (table.seat.z - s.z) / d }, DT);
  }
  const p = promptFor(s, map);
  assert.equal(p.text, 'Presiona E para sentarte');
  assert.equal(p.table.id, 'mesa-1');
  const before = snapshot(s);
  const ev = step(s, map, { x: 1, z: 0, interact: true }, DT);
  assert.deepEqual(ev, [{ type: 'sit', table }]);
  // sitting down does not move the player
  assert.deepEqual(snapshot(s), before);
});

test('after the game the player is back where they stood', () => {
  const s = restore(map, { character: 'kaito', zone: 'jansou', x: 1.4, z: 0.9, facing: 3 });
  const snap = JSON.parse(JSON.stringify(snapshot(s)));
  const back = restore(map, snap);
  assert.deepEqual(snapshot(back), snap);
  assert.equal(back.fade, null);
  assert.ok(promptFor(back, map));
});

test('a snapshot that makes no sense goes back to the start', () => {
  const start = snapshot(createState(map, 'shiro'));
  for (const bad of [null, {}, { zone: 'moon', x: 0, z: 0, facing: 0 }, { zone: 'jansou', x: 1.4, z: -0.4, facing: 0 }, { zone: 'room', x: NaN, z: 0, facing: 0 }, { zone: 'room', x: 99, z: 0, facing: 0 }]) {
    assert.deepEqual(snapshot(restore(map, bad)), start);
  }
  assert.equal(restore(map, { character: 'momo' }).character, 'momo');
});

test('the bake: one mesh per texture, a colour per vertex, nothing above full brightness', () => {
  let vertices = 0;
  for (const [name, zone] of Object.entries(map.zones)) {
    const groups = buildZone(zone);
    assert.ok(groups.size >= 3 && groups.size <= 12, `${name}: ${groups.size} meshes`);
    for (const g of groups.values()) {
      const n = g.positions.length / 3;
      vertices += n;
      assert.equal(g.colors.length, n * 3);
      assert.equal(g.uvs.length, n * 2);
      assert.ok(g.indices.every((i) => i < n));
      assert.ok(g.colors.every((c) => c >= 0 && c <= 1));
    }
  }
  // light enough for an old computer
  assert.ok(vertices < 40000, `${vertices} vertices`);
});

test('the bake: brighter under a lamp, darker in corners and near the floor', () => {
  const zone = {
    ambient: '#202020',
    subdiv: 0.25,
    boxes: [{ min: [-2, 0, -2], max: [2, 3, 2], inside: true }],
    lights: [{ at: [0, 2, 0], color: '#ffffff', intensity: 1, radius: 4 }],
  };
  const g = buildZone(zone).get('white');
  const lum = (x, y, z) => {
    for (let i = 0; i < g.positions.length; i += 3) {
      if (Math.abs(g.positions[i] - x) < 1e-6 && Math.abs(g.positions[i + 1] - y) < 1e-6 && Math.abs(g.positions[i + 2] - z) < 1e-6) return g.colors[i] + g.colors[i + 1] + g.colors[i + 2];
    }
    throw new Error('no vertex there');
  };
  // on the floor: under the lamp against the corner
  assert.ok(lum(0, 0, 0) > lum(1.5, 0, 1.5));
  assert.ok(lum(1.5, 0, 1.5) > lum(2, 0, 2));
  // without any light, a corner is still darker than the middle (fake AO)
  const dark = buildZone({ ...zone, lights: [] }).get('white');
  const at = (arr, x, z) => {
    for (let i = 0; i < arr.positions.length; i += 3) {
      if (arr.positions[i + 1] === 0 && Math.abs(arr.positions[i] - x) < 1e-6 && Math.abs(arr.positions[i + 2] - z) < 1e-6) return arr.colors[i];
    }
    return null;
  };
  assert.ok(at(dark, 0, 0) > at(dark, 2, 2));
  assert.ok(Math.abs(at(dark, 0, 0) - hexToRgb('#202020')[0]) < 1e-9);
});

test('the bake: furniture darkens the floor around it, emissive faces keep their colour', () => {
  const zone = {
    ambient: '#404040',
    subdiv: 0.5,
    boxes: [
      { min: [-3, -0.2, -3], max: [3, 0, 3], tex: 'floor' },
      { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5], tex: 'crate' },
      { min: [2, 1, 2], max: [2.5, 1.5, 2.5], tex: 'neon', color: '#ff0080', emissive: true },
    ],
  };
  const groups = buildZone(zone);
  const floor = groups.get('floor');
  const red = (x, z) => {
    for (let i = 0; i < floor.positions.length; i += 3) {
      if (floor.positions[i + 1] === 0 && floor.positions[i] === x && floor.positions[i + 2] === z) return floor.colors[i];
    }
    return null;
  };
  assert.ok(red(0.5, 0) < red(2, 0));
  const neon = groups.get('neon');
  for (let i = 0; i < neon.colors.length; i += 3) assert.deepEqual(neon.colors.slice(i, i + 3), hexToRgb('#ff0080'));
});

test('neon signs light their surroundings, and the characters walking by', () => {
  const street = map.zones.street;
  const lights = zoneLights(street);
  assert.equal(lights.length, street.lights.length + street.neons.filter((n) => n.light).length);
  const sign = street.neons[0];
  const near = tintAt(street, sign.at[0], 1, sign.at[2] + 1);
  const far = tintAt(street, -13, 1, 0);
  assert.ok(near[0] > far[0]);
  assert.ok(near.every((c) => c <= 1));
});
