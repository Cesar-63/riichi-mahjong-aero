// The players sitting at the table: low-poly PS1-style characters built by
// scripts/personajes/build.py (public/models/personajes/README.md). Every
// model is made of rigid pieces hung on a small skeleton that stands in a
// rest pose; all the acting is done here, by code: the sitting posture,
// breathing, where each one looks, a gesture of their own now and then, and
// the right arm that goes with every tile they draw or discard (two-bone
// IK following the tile itself, so hand and tile never part). The player's
// own character is not drawn, only the forearm and hand when they discard.
// Everything runs on the world's clock, so the lab can pause, slow down and
// record it like the rest of the table.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { TABLE } from './world.js';
import { TUNING } from './tuning.js';
import { characterId } from '../shared/characters.js';

const DIR = 'models/personajes/';
const SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
// world units per metre: a tile is 1 wide, the table top 20 over the floor
const SCALE = 29;
const FLOOR = -20;
const HIP_Y = -4.6; // height of the hips of someone sitting, under the table top
const SEAT_DIST = TABLE / 2 + 4.9; // the belly just clear of the table's rail
const CHAIR_DIST = SEAT_DIST + 5.6; // the chair backs, behind them

// How each one plays. lean: how far forward they sit (radians); reach, hold
// and back: seconds to get the hand to the tile, to keep it on a discard
// that has landed and to bring it back; lift: how high the hand swings on
// its way (metres); flick: the wrist snapping up after letting go; carry:
// how fast their tiles travel (1 = the table's speed); left: where the
// other hand waits ('table' or 'lap'); gesture: something they do now and
// then with that hand, [name, first time, every, how long] in seconds;
// glance: how often they look up at the others
const STYLE = {
  // the old regular: unhurried, sets each tile down and takes his time
  genzo: { lean: 0.1, reach: 0.2, hold: 0.12, back: 0.5, lift: 0.03, flick: 0, carry: 0.8, left: 'table', gesture: ['chin', 9, 21, 2.6], glance: 11, sway: 0.6 },
  // cool and lazy: sits back, one quick dry move
  shiro: { lean: -0.03, reach: 0.14, hold: 0.04, back: 0.34, lift: 0.02, flick: 0.25, carry: 1.1, left: 'lap', gesture: ['cheek', 5, 26, 9], glance: 17, sway: 0.3 },
  // the show-off: slaps the tile down and snaps the wrist away
  ryuji: { lean: 0.16, reach: 0.12, hold: 0.2, back: 0.3, lift: 0.07, flick: 1, carry: 1.2, left: 'table', gesture: ['tie', 12, 24, 2.2], glance: 6, sway: 0.8 },
  // neat and quick, both hands close to her tiles
  momo: { lean: 0.07, reach: 0.15, hold: 0.07, back: 0.28, lift: 0.04, flick: 0.1, carry: 1, left: 'table', gesture: ['hair', 7, 19, 1.8], glance: 8, sway: 1 },
  // restless: leaning in, fast hands
  kaito: { lean: 0.2, reach: 0.11, hold: 0.05, back: 0.24, lift: 0.05, flick: 0.5, carry: 1.25, left: 'table', gesture: ['neck', 6, 17, 2.4], glance: 5, sway: 1.3 },
  // the gentleman: upright, slow and exact
  tatsuo: { lean: 0.02, reach: 0.24, hold: 0.16, back: 0.6, lift: 0.025, flick: 0, carry: 0.72, left: 'table', gesture: ['lapel', 14, 28, 2.4], glance: 14, sway: 0.25 },
};
// Where a gesture takes the left hand: [joint it is measured from, offset
// from it (metres; x to the character's left, z forward), which way the
// fingers point, how much the head tilts to meet it]
const GESTURE = {
  chin: ['head', [0.03, 0.035, 0.12], [-0.35, 0.9, -0.1], 0.06],
  cheek: ['head', [0.085, 0.07, 0.07], [-0.2, 0.95, -0.1], 0.2],
  hair: ['head', [0.11, 0.13, 0.04], [-0.3, 0.9, -0.3], -0.08],
  neck: ['head', [0.07, 0.03, -0.085], [-0.6, 0.6, -0.5], -0.12],
  tie: ['spine', [0.0, 0.3, 0.15], [-0.7, 0.6, 0], 0],
  lapel: ['spine', [0.075, 0.27, 0.14], [-0.5, 0.8, 0], 0],
};

const PARENT = { spine: 'hips', head: 'spine', armL: 'spine', foreL: 'armL', handL: 'foreL', armR: 'spine', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
// the joint (or tip) each bone points at
const CHILD = { hips: 'spine', spine: 'head', head: 'headTop', armL: 'foreL', foreL: 'handL', handL: 'handLTip', armR: 'foreR', foreR: 'handR', handR: 'handRTip', thighL: 'shinL', shinL: 'footL', footL: 'footLTip', thighR: 'shinR', shinR: 'footR', footR: 'footRTip' };
const ORDER = ['hips', 'spine', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A rotation that takes y to d and z as near f as it can
const mB = new THREE.Matrix4();
function basis(d, f, out = new THREE.Quaternion()) {
  const y = d.clone().normalize();
  const x = y.clone().cross(f);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const z = x.clone().cross(y);
  return out.setFromRotationMatrix(mB.makeBasis(x, y, z));
}

// One character. own: the player's own, of which only the right forearm
// and hand are ever shown.
function makeRig(gltf, id, rel, own) {
  const root = gltf.scene;
  const style = STYLE[id];
  const side = SEAT_ANGLE[rel];
  root.scale.setScalar(SCALE);
  root.position.set(Math.sin(side) * SEAT_DIST, FLOOR, Math.cos(side) * SEAT_DIST);
  root.rotation.y = side + Math.PI; // facing the table
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  // a point given as the seat sees the table (x to its right, y up, z
  // towards itself, in world units; table3d's place()) → character space
  const seatPoint = (x, y, z) => V(x, y, z).applyAxisAngle(UP, side).applyMatrix4(toLocal);

  const bones = {};
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
    else if (o.name) bones[o.name] = o;
  });
  // matte like everything in the parlour, the texture's pixels kept sharp
  const map = mesh.material.map;
  map.magFilter = THREE.NearestFilter;
  map.colorSpace = THREE.SRGBColorSpace;
  // the lamp hangs over the middle of the table and barely reaches the
  // seats: a little light of their own keeps the faces readable in the dark
  mesh.material = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, envMapIntensity: 0.2, emissive: 0xffe2c0, emissiveMap: map, emissiveIntensity: TUNING.light.people });
  mesh.castShadow = !own;
  mesh.frustumCulled = false; // the pose moves it away from its rest bounds
  if (own) {
    // only the pieces of the right forearm and hand
    const keep = new Set(['foreR', 'handR'].map((n) => mesh.skeleton.bones.indexOf(bones[n])));
    const skin = mesh.geometry.getAttribute('skinIndex');
    const index = mesh.geometry.index.array;
    const kept = [];
    for (let i = 0; i < index.length; i += 3) if (keep.has(skin.getX(index[i]))) kept.push(index[i], index[i + 1], index[i + 2]);
    mesh.geometry.setIndex(kept);
    root.visible = false;
  }

  // the rest pose: where every joint is and which way every bone points
  const rest = {};
  const place = (name) => {
    if (rest[name]) return rest[name];
    const parent = bones[name].parent;
    return (rest[name] = bones[name].position.clone().add(parent === root ? V(0, 0, 0) : place(parent.name)));
  };
  Object.keys(bones).forEach(place);
  const unbind = {};
  for (const name of ORDER) {
    const d0 = rest[CHILD[name]].clone().sub(rest[name]);
    unbind[name] = basis(d0, name.startsWith('foot') ? UP : FWD).invert();
  }
  const len = (a, b) => rest[a].distanceTo(rest[b]);
  const q = Object.fromEntries(ORDER.map((n) => [n, new THREE.Quaternion()])); // each bone's turn, in character space
  const at = Object.fromEntries(ORDER.map((n) => [n, V(0, 0, 0)])); // and where its joint is
  const tmpQ = new THREE.Quaternion();
  // points a bone along d, its front (the thumb's side of an arm) towards f
  function aim(name, d, f) {
    basis(d, f, q[name]).multiply(unbind[name]);
    const parent = PARENT[name];
    if (parent) {
      at[name].copy(rest[name]).sub(rest[parent]).applyQuaternion(q[parent]).add(at[parent]);
      bones[name].quaternion.copy(tmpQ.copy(q[parent]).invert()).multiply(q[name]);
    } else bones[name].quaternion.copy(q[name]);
  }
  const jointAt = (name, parent) => rest[name].clone().sub(rest[parent]).applyQuaternion(q[parent]).add(at[parent]);

  // ------------------------------------------------------------ arms
  const upper = len('armR', 'foreR');
  const fore = len('foreR', 'handR');
  const hand = len('handR', 'handRTip');
  // Shoulder s, wrist w: the elbow bends towards pole. The hand points
  // along fingers with its thumb towards thumb.
  function arm(s, wrist, pole, fingers, thumb) {
    const S = jointAt(`arm${s}`, 'spine');
    const to = wrist.clone().sub(S);
    const c = clamp(to.length(), Math.abs(upper - fore) + 0.01, upper + fore - 0.004);
    to.normalize();
    const along = (upper * upper + c * c - fore * fore) / (2 * c);
    const out = Math.sqrt(Math.max(0, upper * upper - along * along));
    const bend = pole.clone().addScaledVector(to, -pole.dot(to)).normalize();
    const elbow = S.clone().addScaledVector(to, along).addScaledVector(bend, out);
    const W = S.clone().addScaledVector(to, c);
    const foreDir = W.clone().sub(elbow);
    // (the arm's front faces the way the elbow folds, steady even when straight)
    aim(`arm${s}`, elbow.clone().sub(S), bend.clone().negate());
    aim(`fore${s}`, foreDir, thumb);
    aim(`hand${s}`, fingers, thumb);
    return S.distanceTo(wrist) - (upper + fore); // how far out of reach (negative: within)
  }
  // the wrist that puts the fingertips on a point, coming from above
  const wristFor = (point, fingers) => point.clone().addScaledVector(fingers, -hand * 0.8).add(V(0, 0.012, 0));

  // --------------------------------------------------------- the pose
  const hip = V(0, (HIP_Y - FLOOR) / SCALE, 0);
  // the right hand: resting on the rail by the end of the hand row, or
  // (own) out of sight under the bottom of the screen
  const restR = own ? seatPoint(11, -2, 21) : seatPoint(6.3, 1.25, 15.7);
  const restL = style.left === 'lap' ? V(0.1, hip.y + 0.09, 0.2) : seatPoint(-6.3, 1.25, 15.7);
  const flatFingers = V(0.18, -0.05, 1).normalize(); // lying on the rail, a little turned in
  const gripFingers = V(0.1, -0.85, 0.5).normalize(); // over a tile: from above, reaching forward
  const ownFingers = V(0.35, -0.55, 0.75).normalize();
  const look = V(0, -0.5, 1).normalize(); // where the face points, smoothed
  const downAtHand = seatPoint(-1, 0.6, 9);
  const headAt = () => at.head;
  // a small repeatable source of chance, so a scene looks the same every run
  let seed = (rel + 1) * 7919 + id.length * 104729;
  const chance = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const play = { on: null, w: 0, grip: restR.clone(), t: 0 };
  const attention = { obj: null, point: V(0, 0, 1), left: 0 };
  let glanceIn = style.glance * (0.5 + chance());
  const gesture = { name: style.gesture[0], wait: style.gesture[1] + rel * 1.7, every: style.gesture[2], length: style.gesture[3], t: -1 };
  let time = rel * 1.3;
  let leanNow = style.lean;
  let twistNow = 0;

  function step(dt) {
    time += dt;
    mesh.material.emissiveIntensity = TUNING.light.people;
    // ---- the tile in hand: reach it, go with it, let go, come back
    let w = 0;
    let lift = 0;
    let flick = 0;
    const p = play.on;
    if (p) {
      p.t += dt;
      const end = p.lead + p.dur + p.hold;
      if (p.t <= end) {
        // sets off so as to be on the tile right when it starts to move
        const u = (p.t - (p.lead - p.reach)) / p.reach;
        w = p.w0 + (1 - p.w0) * ease(u);
        lift = Math.sin(Math.PI * clamp(u, 0, 1)) * (1 - p.w0);
      } else {
        const u = (p.t - end) / p.back;
        w = 1 - ease(u);
        lift = Math.sin(Math.PI * clamp(u, 0, 1));
        flick = Math.sin(Math.PI * clamp(u * 1.6, 0, 1)) * style.flick;
        if (u >= 1) play.on = null;
      }
      if (p.t <= end + 0.05) {
        const target = p.obj.position.clone().applyMatrix4(toLocal);
        // snaps to the tile while it travels (it moves fast), eases otherwise
        play.grip.lerp(target, p.t > p.lead ? 1 : 1 - Math.exp(-dt * 40));
      }
    }
    play.w = w;
    if (own) {
      root.visible = w > 0.01;
      if (!root.visible) return;
      // no body: the forearm comes in from under the screen's edge
      const fingers = ownFingers;
      const wrist = restR.clone().lerp(wristFor(play.grip, fingers), w);
      wrist.y += lift * style.lift;
      // the forearm, from the elbow: in from the right of the screen, as the
      // player sees their own arm
      const dir = V(0.62, 0.12 + flick * 0.25, 0.78).normalize();
      bones.armR.quaternion.identity();
      bones.spine.quaternion.identity();
      bones.hips.quaternion.identity();
      q.armR.identity();
      at.armR.copy(wrist).addScaledVector(dir, -fore).sub(rest.foreR).add(rest.armR);
      bones.armR.position.copy(at.armR).sub(rest.armR).add(bones.armR.userData.home);
      aim('foreR', dir, V(1, 0.3, 0));
      aim('handR', fingers.clone().add(V(0, flick * 0.5, 0)), V(1, 0.2, 0));
      return;
    }

    // ---- the body
    const breath = Math.sin(time * 1.9) * 0.008;
    const sway = Math.sin(time * 0.37 + rel) * 0.012 * style.sway;
    const far = w > 0 ? clamp((jointAt('armR', 'spine').distanceTo(wristFor(play.grip, gripFingers)) - (upper + fore) * 0.9) / 0.3, 0, 1) : 0;
    leanNow += (style.lean + far * w * 0.5 - leanNow) * (1 - Math.exp(-dt * 12));
    twistNow += (far * w * 0.3 - twistNow) * (1 - Math.exp(-dt * 12));
    at.hips.copy(hip);
    bones.hips.position.copy(hip);
    aim('hips', UP, FWD);
    const lean = leanNow + breath;
    aim('spine', V(sway, Math.cos(lean), Math.sin(lean)), V(Math.sin(twistNow), 0, Math.cos(twistNow)));

    // ---- the left hand: waiting, or at its gesture
    let g = 0;
    gesture.wait -= dt;
    if (gesture.wait <= 0 && gesture.t < 0) {
      gesture.t = 0;
      gesture.wait = gesture.every * (0.8 + 0.4 * chance());
    }
    if (gesture.t >= 0) {
      gesture.t += dt;
      g = Math.min(ease(gesture.t / 0.6), ease((gesture.length - gesture.t) / 0.6));
      if (gesture.t >= gesture.length) gesture.t = -1;
    }
    const [from, offset, gFingers, tilt] = GESTURE[gesture.name];

    // ---- the head: at the tile in hand, at what just happened on the
    // table, a glance at someone, or down at the hand
    let target = downAtHand;
    if (w > 0.25) target = play.grip;
    else if (attention.left > 0) {
      attention.left -= dt;
      if (attention.obj) attention.point.copy(attention.obj.position).applyMatrix4(toLocal);
      target = attention.point;
    }
    glanceIn -= dt;
    if (glanceIn < 0) {
      glanceIn = style.glance * (0.6 + 0.8 * chance());
      const who = [1, 2, 3][Math.floor(chance() * 3)];
      // the face of the player `who` seats round
      const a = SEAT_ANGLE[who];
      attention.obj = null;
      attention.point.set(-Math.sin(a) * SEAT_DIST / SCALE, hip.y + 0.6, (1 - Math.cos(a)) * SEAT_DIST / SCALE);
      attention.left = 1.1 + chance();
    }
    const head = jointAt('head', 'spine');
    const want = target.clone().sub(head).normalize();
    want.y = clamp(want.y, -0.42, 0.3);
    want.x = clamp(want.x, -0.8, 0.8);
    want.z = Math.max(want.z, 0.35);
    look.lerp(want.normalize(), 1 - Math.exp(-dt * 7)).normalize();
    const headUp = V(g * tilt + Math.sin(time * 0.23 + rel * 2) * 0.02 * style.sway, 1, 0);
    aim('head', headUp.addScaledVector(look, -headUp.dot(look)), look);

    // ---- arms
    const gripWrist = wristFor(play.grip, gripFingers);
    const wristR = restR.clone().lerp(gripWrist, w);
    wristR.y += lift * style.lift + breath * 0.3;
    const fingersR = flatFingers.clone().lerp(gripFingers, w).add(V(0, flick * 0.9, 0)).normalize();
    arm('R', wristR, V(-0.7, -0.6, -0.3), fingersR, V(1, 0, 0).lerp(V(0.8, 0.3, -0.4), w));
    const gesturePoint = (from === 'head' ? headAt() : at.spine).clone().add(V(...offset).applyQuaternion(q[from]));
    const wristL = restL.clone().lerp(gesturePoint, g);
    wristL.y += Math.sin(Math.PI * g) * 0.04 + breath * 0.3 + (g > 0.9 ? Math.sin(time * 9) * 0.004 : 0);
    const lapFingers = style.left === 'lap' ? V(-0.3, -0.2, 0.9) : V(-0.18, -0.05, 1);
    arm('L', wristL, V(0.7, -0.6, -0.3), lapFingers.normalize().lerp(V(...gFingers).normalize(), g).normalize(), V(-1, 0, 0).lerp(V(-0.4, 0, -0.9), g));
  }

  // ---- legs: set once, they stay under the table
  for (const b of ORDER) bones[b].userData.home = bones[b].position.clone();
  if (!own) {
    at.hips.copy(hip);
    aim('hips', UP, FWD);
    for (const s of ['L', 'R']) {
      const out = s === 'L' ? 1 : -1;
      aim(`thigh${s}`, V(out * 0.12, -0.04, 1), UP);
      const knee = jointAt(`shin${s}`, `thigh${s}`);
      const shin = len(`shin${s}`, `foot${s}`);
      // shins as upright as the floor allows, feet tucked back otherwise
      const drop = knee.y - rest[`foot${s}`].y - 0.01;
      const tuck = Math.acos(clamp(drop / shin, 0, 1));
      aim(`shin${s}`, V(0, -Math.cos(tuck), -Math.sin(tuck)), FWD);
      aim(`foot${s}`, V(out * 0.1, -0.3, 1), UP);
    }
  }

  return {
    root,
    id,
    style,
    step,
    // a tile this character moves: the hand goes to it during waitMs (it
    // has not set off yet), travels with it for durMs and comes back
    play(obj, waitMs, durMs, kind) {
      const lead = Math.max(0, waitMs) / 1000;
      play.on = {
        obj, kind, t: 0, lead, dur: durMs / 1000, w0: play.w,
        reach: clamp(lead, 0.06, style.reach),
        // a drawn tile is let go at once; a discard is pressed down a moment
        hold: kind === 'discard' ? Math.max(style.hold, own ? 0.12 : 0) : 0.03,
        back: style.back,
      };
      if (play.w < 0.05) play.grip.copy(obj.position).applyMatrix4(toLocal);
    },
    // something to follow with the eyes for a moment (a tile on its way)
    attend(obj, secs) {
      attention.obj = obj;
      attention.left = secs;
    },
    dispose() {
      root.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.map.dispose();
      mesh.material.dispose();
    },
  };
}

export function createCharacters(world) {
  const group = new THREE.Group();
  world.scene.add(group);
  const loader = new GLTFLoader();
  const rigs = [null, null, null, null]; // by relative seat (0 = the player)
  let cast = [null, null, null, null];
  let ready = Promise.resolve();
  let generation = 0;

  world.onTick((dt) => {
    if (!group.visible) return;
    for (const r of rigs) if (r) r.step(dt);
  });

  const chairHome = world.chairs.map((c) => c.position.clone());
  const moveChairs = (on) => world.chairs.forEach((c, i) => {
    const h = chairHome[i];
    const k = on ? CHAIR_DIST / Math.hypot(h.x, h.z) : 1;
    c.position.set(h.x * k, h.y, h.z * k);
  });

  return {
    get ready() {
      return ready;
    },
    // who sits where: character ids by relative seat (0 = the player,
    // whose character only lends its forearm). Loads what changed.
    setCast(ids) {
      const next = ids.map((id) => (id ? characterId(id) : null));
      if (next.every((id, i) => id === cast[i])) return ready;
      const mine = ++generation;
      const changed = next.map((id, i) => id !== cast[i]);
      cast = next;
      ready = Promise.all(next.map(async (id, rel) => {
        if (!changed[rel]) return;
        const gltf = id ? await loader.loadAsync(`${DIR}${id}.glb`) : null;
        if (mine !== generation) return;
        if (rigs[rel]) rigs[rel].dispose();
        rigs[rel] = gltf ? makeRig(gltf, id, rel, rel === 0) : null;
        if (rigs[rel]) group.add(rigs[rel].root);
      })).then(() => {
        if (mine === generation) moveChairs(group.visible);
      });
      return ready;
    },
    setVisible(on) {
      group.visible = on;
      moveChairs(on && rigs.some(Boolean));
    },
    // The player at relative seat rel moves a tile (obj): its hand goes
    // with it. The others look at a discard when it lands.
    play(rel, kind, obj, waitMs, durMs) {
      if (!group.visible) return;
      if (rigs[rel]) rigs[rel].play(obj, waitMs, durMs, kind);
      if (kind !== 'discard') return;
      rigs.forEach((r, i) => {
        if (r && i !== rel && i !== 0) r.attend(obj, (waitMs + durMs) / 1000 + 0.9);
      });
    },
    // how fast this seat's tiles travel, against the table's speed
    pace: (rel) => (group.visible && rigs[rel] ? rigs[rel].style.carry : 1),
    seated: (rel) => group.visible && !!rigs[rel],
  };
}
