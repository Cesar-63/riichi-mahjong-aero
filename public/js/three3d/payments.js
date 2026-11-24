// Paying with sticks (#98): at the end of a hand every payer throws their
// sticks at whoever collects; the sticks fly, spin, bounce on the felt, on
// the tiles and on each other (cannon-es, loaded only when needed) and lie
// however they fall. Once still, each one flies to its collector's edge of
// the table and disappears into their drawer, and so do the riichi sticks
// and deposits the winner takes. Without the physics library nothing is
// thrown and the hand ends as before.
import { TUNING } from './tuning.js';
import { paymentSticks } from './sticks.js';

let CANNON = null;
let loading = null;
// the physics library, fetched once (null if it cannot be loaded)
export function loadPhysics() {
  if (!loading) {
    loading = import('../../vendor/cannon-es/cannon-es.min.js')
      .then((m) => (CANNON = m))
      .catch(() => null);
  }
  return loading;
}

// small seeded random, so the same hand always throws the same way
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// half: the felt's half side; seatFrame(rel): quaternion of a seat's frame
// (the player at +z); stickGeo / stickMats / stickSize ({ len, thick, wide }):
// the table's own sticks
export function createPayments({ THREE, scene, half, seatFrame, stickGeo, stickMats, stickSize }) {
  let show = null;
  const local = (rel, x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(seatFrame(rel));

  function clear() {
    if (!show) return;
    for (const s of show.sticks) scene.remove(s.mesh);
    // the sticks that were already on the table stay taken until the next hand
    show = null;
  }

  // Starts throwing. flows: [{ from, to, amount }] (relative seats), pot:
  // [{ mesh, to }] (sticks already on the table that go to a winner),
  // colliders: meshes the sticks bounce on (the tiles on the table), key:
  // the hand (the same hand throws the same way). Returns false when there
  // is nothing to show or no physics, and calls onDone once every stick
  // is in its drawer.
  function start({ flows, pot = [], colliders = [], key = '' }, onDone) {
    clear();
    if (!CANNON || (!flows.length && !pot.length)) return false;
    const P = TUNING.pay;
    const rand = random(hash(key));
    const rnd = (a, b) => a + rand() * (b - a);
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -P.gravity, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    const mat = new CANNON.Material('stick');
    world.defaultContactMaterial.friction = 0.35;
    world.defaultContactMaterial.restitution = P.bounce;
    // the felt, and the rails all round it
    const fixed = (shape, x, y, z) => {
      const b = new CANNON.Body({ mass: 0, shape });
      b.position.set(x, y, z);
      world.addBody(b);
    };
    fixed(new CANNON.Box(new CANNON.Vec3(half + 2, 0.5, half + 2)), 0, -0.5, 0);
    for (const [x, z, w, d] of [[half + 0.6, 0, 0.6, half + 1.2], [-half - 0.6, 0, 0.6, half + 1.2], [0, half + 0.6, half + 1.2, 0.6], [0, -half - 0.6, half + 1.2, 0.6]]) {
      fixed(new CANNON.Box(new CANNON.Vec3(w, 1.5, d)), x, 1.3, z);
    }
    // every tile as the box it fills (lying tiles are squared with the table)
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    for (const m of colliders) {
      if (!m.visible) continue;
      box.setFromObject(m);
      if (box.isEmpty() || box.max.y < 0.02) continue;
      box.getSize(size);
      box.getCenter(centre);
      fixed(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)), centre.x, centre.y, centre.z);
    }

    const sticks = [];
    const shape = new CANNON.Box(new CANNON.Vec3(stickSize.len / 2, Math.max(0.06, stickSize.thick / 2), stickSize.wide / 2));
    const g = new THREE.Vector3(0, -P.gravity, 0);
    flows.forEach((f) => {
      paymentSticks(f.amount, P.most).forEach((value, i) => {
        // from above the payer's edge, at a spot on the collector's side of the table
        const from = local(f.from, rnd(-2.5, 2.5), rnd(3, 4.2), half - rnd(2.5, 3.5));
        const to = local(f.to, rnd(-4.5, 4.5), 0.3, rnd(3.5, 7.5));
        const t = (P.flightMs / 1000) * rnd(0.85, 1.15);
        const vel = to.clone().sub(from).divideScalar(t).addScaledVector(g, -t / 2);
        const body = new CANNON.Body({ mass: 0.05, shape, material: mat, linearDamping: 0.05, angularDamping: 0.15, sleepSpeedLimit: 0.6, sleepTimeLimit: 0.2 });
        body.position.set(from.x, from.y, from.z);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.6, 0.6), rnd(0, Math.PI), rnd(-0.6, 0.6)));
        body.quaternion.set(q.x, q.y, q.z, q.w);
        body.velocity.set(vel.x, vel.y, vel.z);
        body.angularVelocity.set(rnd(-14, 14), rnd(-9, 9), rnd(-14, 14));
        const mesh = new THREE.Mesh(stickGeo, stickMats[value]);
        mesh.castShadow = true;
        mesh.visible = false;
        mesh.position.copy(from);
        mesh.quaternion.copy(q);
        scene.add(mesh);
        // each payer throws one stick after another
        sticks.push({ mesh, body, to: f.to, at: i * P.gap, thrown: false, own: true });
      });
    });
    // the sticks already on the table: no physics, just taken
    for (const p of pot) {
      p.mesh.userData.taken = true; // the table stops showing it
      sticks.push({ mesh: p.mesh, to: p.to, own: false, thrown: true, at: 0 });
    }
    show = { world, sticks, t: 0, phase: 'throw', settleAt: null, onDone };
    return true;
  }

  // Flight to the collector's drawer: up a little, then pulled faster and
  // faster under their edge of the table, shrinking as it goes in.
  function startAbsorb() {
    const P = TUNING.pay;
    show.phase = 'absorb';
    const per = new Map();
    show.sticks.forEach((s) => {
      const n = per.get(s.to) || 0;
      per.set(s.to, n + 1);
      if (s.body) show.world.removeBody(s.body);
      s.from = s.mesh.position.clone();
      s.q0 = s.mesh.quaternion.clone();
      s.goal = local(s.to, (n % 5 - 2) * 0.5, -0.3, half + 0.6);
      s.at = show.t + n * P.absorbGap;
    });
  }

  function tick(dt) {
    if (!show) return;
    const P = TUNING.pay;
    show.t += dt * 1000;
    if (show.phase === 'throw') {
      for (const s of show.sticks) {
        if (!s.thrown && show.t >= s.at) {
          s.thrown = true;
          s.mesh.visible = true;
          show.world.addBody(s.body);
        }
      }
      show.world.step(1 / 120, Math.min(dt, 0.05), 8);
      for (const s of show.sticks) {
        if (!s.body || !s.thrown) continue;
        // one that jumped the rails is put back down on the felt
        if (s.body.position.y < -2) s.body.position.set(0, 2, 0);
        s.mesh.position.set(s.body.position.x, s.body.position.y, s.body.position.z);
        s.mesh.quaternion.set(s.body.quaternion.x, s.body.quaternion.y, s.body.quaternion.z, s.body.quaternion.w);
      }
      const all = show.sticks.every((s) => !s.body || (s.thrown && s.body.sleepState === CANNON.Body.SLEEPING));
      const last = Math.max(0, ...show.sticks.map((s) => s.at));
      if (all && show.settleAt === null) show.settleAt = show.t + P.restMs;
      if ((show.settleAt !== null && show.t >= show.settleAt) || show.t >= last + P.settleMs) startAbsorb();
      return;
    }
    let left = 0;
    for (const s of show.sticks) {
      const u = Math.min(1, Math.max(0, (show.t - s.at) / P.absorbMs));
      if (u >= 1) {
        s.mesh.visible = false;
        continue;
      }
      left++;
      if (u <= 0) continue;
      // a small hop up, then away, faster and faster
      const k = u * u;
      s.mesh.position.lerpVectors(s.from, s.goal, k);
      s.mesh.position.y += Math.sin(Math.min(1, u * 2) * Math.PI) * 0.8;
      s.mesh.quaternion.slerpQuaternions(s.q0, seatFrame(s.to), Math.min(1, u * 1.5));
      s.mesh.scale.setScalar(1 - 0.45 * k);
    }
    if (!left) {
      const done = show.onDone;
      for (const s of show.sticks) {
        s.mesh.scale.setScalar(1);
        if (s.own) scene.remove(s.mesh);
      }
      show = null;
      if (done) done();
    }
  }

  return { start, tick, clear, active: () => !!show, ready: () => !!CANNON };
}
