import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createState, step, promptFor, tableInReach, snapshot, restore, blocked, fadeAlpha, mapProblems, FADE, SPEED, PLAYER_RADIUS,
} from '../public/js/city/logic.js';
import { buildZone, bakeAt, tintAt, hexToRgb } from '../public/js/city/bake.js';

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
      { min: [2, 1, 2], max: [2.5, 1.5, 2.5], tex: 'lamp', color: '#ff0080', emissive: true },
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
  const lamp = groups.get('lamp');
  for (let i = 0; i < lamp.colors.length; i += 3) assert.deepEqual(lamp.colors.slice(i, i + 3), hexToRgb('#ff0080'));
});

test('the sun: what stands in its way casts a shadow, on the ground and on people', () => {
  const zone = {
    ambient: '#404050',
    sun: { dir: [0, 1, 1], color: '#ffffff', intensity: 0.6 },
    subdiv: 0.5,
    boxes: [
      { min: [-6, -0.2, -6], max: [6, 0, 6], tex: 'ground' },
      { min: [-1, 0, 2], max: [1, 2, 3], tex: 'wall' }, // the sun is behind it, seen from z < 2
    ],
  };
  const up = [0, 1, 0];
  const shade = bakeAt(zone, [0, 0, 1], up)[0];
  const sunny = bakeAt(zone, [0, 0, -3], up)[0];
  const beside = bakeAt(zone, [4, 0, 1], up)[0];
  assert.ok(sunny > shade + 0.3);
  assert.equal(beside, sunny);
  // the shadow is as long as the wall is tall (the sun at 45°)
  assert.ok(bakeAt(zone, [0, 0, -0.5], up)[0] > shade + 0.3);
  // a face that looks away from the sun gets none of it
  const wall = buildZone(zone).get('wall');
  for (let i = 0; i < wall.positions.length; i += 3) {
    const [x, y, z] = wall.positions.slice(i, i + 3);
    if (z === 2 && y > 1 && y < 2 && Math.abs(x) < 1) assert.ok(wall.colors[i] <= hexToRgb('#404050')[0] + 1e-9);
  }
  // someone standing in the shadow is darker than someone in the sun
  assert.ok(tintAt(zone, 0, 1, 1.5)[0] < tintAt(zone, 0, 1, -3)[0]);
});

test('the alley at noon: sun, sky, painted signs and not one neon', () => {
  const street = map.zones.street;
  assert.ok(street.sun && street.sky);
  assert.ok(street.sun.dir[1] > 0.8); // high in the sky
  assert.ok(street.signs.length >= 4 && street.signs.length <= 8); // one texture holds eight
  for (const zone of Object.values(map.zones)) {
    assert.equal(zone.neons, undefined);
    assert.ok((zone.signs || []).length <= 8);
  }
  // signs mix kanji and Spanish
  assert.ok(street.signs.some((s) => /[\u4e00-\u9fff]/.test(s.text) && /[A-ZÑ]/.test(s.sub || '')));
  // half the alley lies in the shadow of the south side
  assert.ok(tintAt(street, 0, 1.2, -2)[0] > tintAt(street, 0, 1.2, 2.5)[0]);
});

test('the opening scene: shots in the map, cuts through black, ends on the play camera', async () => {
  const { introAt, introLength, introProblems, shotEnd, captionText } = await import('../public/js/city/intro.js');
  const intro = map.intro;
  assert.deepEqual(introProblems(map), []);
  const total = introLength(intro);
  assert.ok(total > 10 && total < 25, `${total} s`);
  // it starts from black and the first caption is not up yet
  const a = introAt(intro, map, 0);
  assert.equal(a.index, 0);
  assert.equal(a.dark, 1);
  assert.equal(a.caption, 0);
  assert.deepEqual(a.camera.position, intro.shots[0].from.position);
  // mid-shot: clear picture, caption up
  const mid = introAt(intro, map, intro.shots[0].duration / 2);
  assert.equal(mid.dark, 0);
  assert.equal(mid.caption, 1);
  // a cut: black on both sides of it
  const cut = intro.shots[0].duration;
  assert.ok(introAt(intro, map, cut - 0.01).dark > 0.9);
  assert.equal(introAt(intro, map, cut + 0.01).index, 1);
  assert.ok(introAt(intro, map, cut + 0.01).dark > 0.9);
  // the last shot lands on the start zone's own camera, without fading out
  const last = intro.shots.at(-1);
  const end = introAt(intro, map, total - 1e-4);
  assert.equal(end.shot.zone, map.start.zone);
  assert.equal(end.dark, 0);
  const play = shotEnd(last, map);
  assert.deepEqual(play.position, map.zones.room.camera.position);
  end.camera.position.forEach((v, i) => assert.ok(Math.abs(v - play.position[i]) < 1e-3));
  assert.equal(introAt(intro, map, total), null);
  // the caption of the last shot is the character
  assert.equal(captionText(last.text, { name: 'Momo', about: 'x' }), 'Momo');
});

test('a broken opening scene is reported', async () => {
  const bad = structuredClone(map);
  bad.intro.shots[0].zone = 'nowhere';
  bad.intro.shots[1].duration = 0;
  bad.intro.shots.push({ zone: 'street', duration: 2, from: bad.intro.shots[1].from, to: 'play' });
  const problems = mapProblems(bad);
  assert.equal(problems.length, 4, problems.join('\n'));
});

test('in the last shot the player gets up from the bed and walks to the start', async () => {
  const { introPlayer, introProblems } = await import('../public/js/city/intro.js');
  const shot = map.intro.shots.at(-1);
  const { at, rise, walk } = shot.player;
  const sitting = introPlayer(shot, 0, map);
  assert.deepEqual([sitting.x, sitting.z, sitting.rise, sitting.moving], [at.x, at.z, 0, false]);
  assert.ok(introPlayer(shot, (rise[0] + rise[1]) / 2, map).rise > 0.2);
  const up = introPlayer(shot, rise[1], map);
  assert.equal(up.rise, null);
  const going = introPlayer(shot, (walk[0] + walk[1]) / 2, map);
  assert.ok(going.moving);
  assert.ok(going.x > at.x && going.x < map.start.x);
  const there = introPlayer(shot, shot.duration - 0.01, map);
  assert.ok(Math.abs(there.x - map.start.x) < 1e-9 && Math.abs(there.z - map.start.z) < 1e-9);
  assert.ok(Math.abs(Math.sin(there.facing - map.start.facing)) < 1e-6);
  assert.ok(!there.moving);
  // a player on the bed, or walking in a zone that is not the start, is reported
  const bad = structuredClone(map);
  bad.intro.shots.at(-1).player.at = { x: -1.4, z: -0.7, facing: 0 };
  bad.intro.shots[0].player = shot.player;
  assert.equal(introProblems(bad).length, 2);
});

test('the cat follows the player through doors without walking through walls', async () => {
  const { createCat, followCat, CAT_RADIUS, CAT_NEAR, CAT_FAR } = await import('../public/js/city/cat.js');
  const s = createState(map, 'shiro');
  const cat = createCat(map, s);
  assert.equal(cat.zone, 'room');
  assert.ok(!blocked(map.zones.room, cat.x, cat.z, CAT_RADIUS));
  // the player walks out to the street and down it; the cat keeps up
  const ev = walkTo(s, door('room', 'salir').x, door('room', 'salir').z, 'zone');
  assert.ok(ev);
  for (let i = 0; i < 60; i++) {
    step(s, map, still, DT);
    followCat(cat, s, map, DT);
  }
  assert.equal(cat.zone, 'street');
  for (let i = 0; i < 150; i++) {
    step(s, map, { x: 1, z: 0 }, DT);
    followCat(cat, s, map, DT);
    assert.ok(!blocked(map.zones.street, cat.x, cat.z, CAT_RADIUS), `(${cat.x}, ${cat.z})`);
    assert.ok(Math.hypot(cat.x - s.x, cat.z - s.z) < CAT_FAR + 1.2);
  }
  // the player stops: so does the cat, close by, looking at them
  for (let i = 0; i < 90; i++) {
    step(s, map, still, DT);
    followCat(cat, s, map, DT);
  }
  assert.ok(!cat.moving);
  assert.ok(Math.hypot(cat.x - s.x, cat.z - s.z) < CAT_FAR + 0.01);
  assert.ok(Math.hypot(cat.x - s.x, cat.z - s.z) > CAT_NEAR - 0.3);
});

test('the cat speaks every minute, all its lines before repeating one', async () => {
  const { createChatter, tickChatter, sayFor } = await import('../public/js/city/cat.js');
  const cfg = map.cat;
  assert.equal(cfg.every, 60);
  const ch = createChatter(cfg);
  const said = [];
  for (let t = 0; t < cfg.first + cfg.every * (cfg.lines.length - 1) + 1; t += 0.5) {
    const line = tickChatter(ch, cfg, 0.5);
    if (line) said.push([t, line]);
  }
  assert.equal(said.length, cfg.lines.length);
  assert.ok(Math.abs(said[0][0] - cfg.first) <= 0.5);
  assert.ok(Math.abs(said[1][0] - said[0][0] - cfg.every) <= 0.5);
  assert.equal(new Set(said.map(([, l]) => l)).size, cfg.lines.length);
  // the next round starts with another line than the last one
  const next = tickChatter(ch, cfg, cfg.every);
  assert.notEqual(next, said.at(-1)[1]);
  assert.ok(cfg.lines.some((l) => /kan/i.test(l) && /miau/i.test(l)));
  assert.ok(sayFor('Miau.') >= 4 && sayFor(cfg.lines[1]) > sayFor('Miau.'));
});

test('on the table the cat shows up at most once a game, half the hands', async () => {
  const { tableVisit, tableLines, catProblems } = await import('../public/js/city/cat.js');
  const memo = {};
  assert.equal(tableVisit(memo, '0-0-0', () => 0.7), false); // not this hand
  assert.equal(tableVisit(memo, '0-0-0', () => 0.1), false); // the same hand is not rolled again
  assert.equal(tableVisit(memo, '0-1-0', () => 0.1), true);
  assert.equal(tableVisit(memo, '0-2-0', () => 0), false); // once a game
  // over many games, about half come on the first hand
  let first = 0;
  for (let i = 0; i < 2000; i++) if (tableVisit({}, 'a')) first++;
  assert.ok(first > 900 && first < 1100, `${first}`);
  const lines = tableLines(map.cat, () => 0);
  assert.equal(lines.length, 2);
  assert.ok(map.cat.table.includes(lines[0]) && map.cat.lines.includes(lines[1]));
  assert.equal(tableLines(map.cat, () => 0.9).length, 1);
  assert.deepEqual(catProblems(map), []);
  const bad = structuredClone(map);
  bad.cat.start = { x: -1.4, z: -0.7 }; // on the bed
  bad.cat.every = 0;
  assert.equal(catProblems(bad).length, 2);
});

test('a click on the cat brings its next line, and the next one on its own waits a minute', async () => {
  const { createChatter, tickChatter, askChatter } = await import('../public/js/city/cat.js');
  const cfg = map.cat;
  const ch = createChatter(cfg);
  tickChatter(ch, cfg, 5);
  const said = [askChatter(ch, cfg)];
  assert.ok(cfg.lines.includes(said[0]));
  assert.equal(tickChatter(ch, cfg, cfg.every - 1), null); // not 10 s later, as it would have
  const timed = tickChatter(ch, cfg, 1);
  assert.ok(timed);
  said.push(timed);
  // clicks and the minute share one shuffled round: no repeats until all are said
  while (said.length < cfg.lines.length) said.push(askChatter(ch, cfg));
  assert.equal(new Set(said).size, cfg.lines.length);
});
