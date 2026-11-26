// The people of the town: the same low-poly characters that sit at the
// mahjong table (public/models/personajes/), drawn unlit (texture × one
// colour, the baked light where they stand) and posed by code: standing,
// walking, sitting on a stool with the hands on the table, or sitting on
// something low (a bed) and getting up from it.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const DIR = 'models/personajes/';
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const SEAT = 0.58; // height of the hips of someone sitting on a stool
const LIMBS = ['spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR', 'footL', 'footR'];
const ease = (u) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

export async function loadActor(id) {
  const gltf = await new GLTFLoader().loadAsync(`${DIR}${id}.glb`);
  const root = gltf.scene;
  const bones = {};
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
    else if (o.name) bones[o.name] = o;
  });
  const map = mesh.material.map;
  map.magFilter = THREE.LinearFilter;
  map.colorSpace = THREE.NoColorSpace;
  // unlit: no light of the engine ever touches them
  mesh.material = new THREE.MeshBasicMaterial({ map });
  mesh.frustumCulled = false; // the pose moves it away from its rest bounds
  const hipY = bones.hips.position.y;
  // the legs, for keeping the feet on the floor while sitting low
  const hipDrop = -bones.thighL.position.y;
  const thighLen = bones.shinL.position.length();
  const shinLen = bones.footL.position.length();
  const ankleY = hipY - hipDrop - thighLen - shinLen;
  // the models stand at rest: every bone starts unturned
  const turn = (name, angle, axis = X) => bones[name].quaternion.setFromAxisAngle(axis, angle);
  let phase = 0;
  let stride = 0; // 0 standing, 1 walking

  return {
    id,
    root,
    place(x, z, facing) {
      root.position.set(x, 0, z);
      root.rotation.y = facing;
    },
    // the light where they stand, as [r, g, b]
    tint(rgb) {
      mesh.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
    },
    // standing or walking; t in seconds, for the breathing
    walk(moving, dt, t) {
      stride += ((moving ? 1 : 0) - stride) * Math.min(1, dt * 10);
      phase += dt * 9.5 * stride;
      const s = Math.sin(phase) * stride;
      const c = Math.cos(phase) * stride;
      bones.hips.position.y = hipY - 0.025 * stride + Math.abs(c) * 0.03 * stride;
      bones.hips.position.z = 0;
      bones.footL.quaternion.identity();
      bones.footR.quaternion.identity();
      turn('spine', 0.06 * stride + Math.sin(t * 1.7) * 0.012);
      turn('head', -0.03 * stride);
      turn('thighL', -s * 0.62);
      turn('thighR', s * 0.62);
      turn('shinL', Math.max(0, c) * 0.9 * stride + 0.04);
      turn('shinR', Math.max(0, -c) * 0.9 * stride + 0.04);
      turn('armL', s * 0.5);
      turn('armR', -s * 0.5);
      turn('foreL', -0.12 - 0.3 * stride);
      turn('foreR', -0.12 - 0.3 * stride);
    },
    // sitting at a table, forearms on it
    sit(t = 0, k = 0) {
      bones.hips.position.y = SEAT;
      bones.hips.position.z = 0;
      turn('spine', 0.1 + Math.sin(t * 1.3 + k) * 0.015);
      turn('head', 0.22 + Math.sin(t * 0.4 + k * 2) * 0.05);
      for (const s of ['L', 'R']) {
        turn(`thigh${s}`, -1.5);
        turn(`shin${s}`, 1.5);
        turn(`arm${s}`, -0.25);
        turn(`fore${s}`, -1.55);
      }
      bones.head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.sin(t * 0.27 + k) * 0.04));
    },
    // Sitting on something low with the feet on the floor where the actor
    // stands (rise 0), getting up (in between) or on their feet (1). seat:
    // { height } of what they sit on and { back }, how far behind the feet
    // the hips rest. First they lean forward and bring the hips over the
    // feet, then they push up.
    perch(rise, seat, t = 0) {
      const back = seat.back * (1 - ease(rise / 0.6));
      const up = ease((rise - 0.25) / 0.75);
      const hy = seat.height + 0.12 + (hipY - seat.height - 0.12) * up;
      bones.hips.position.set(bones.hips.position.x, hy, -back);
      // each leg: hip joint to ankle, the knee bending forward
      const vz = back;
      const vy = hy - hipDrop - ankleY;
      const L = Math.min(thighLen + shinLen - 1e-4, Math.max(1e-3, Math.hypot(vz, vy)));
      const a = Math.atan2(vz, vy);
      const b = Math.acos(Math.min(1, (thighLen * thighLen + L * L - shinLen * shinLen) / (2 * thighLen * L)));
      const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (thighLen * thighLen + shinLen * shinLen - L * L) / (2 * thighLen * shinLen))));
      const thigh = a + b;
      for (const s of ['L', 'R']) {
        turn(`thigh${s}`, -thigh);
        turn(`shin${s}`, knee);
        turn(`foot${s}`, thigh - knee); // flat on the floor
      }
      // hunched while sitting, a lean forward to get up, upright at the end
      const breath = Math.sin(t * 1.5) * 0.012 * (1 - rise);
      turn('spine', 0.28 * (1 - rise) + 0.5 * Math.sin(Math.PI * Math.min(1, rise / 0.8)) + breath);
      turn('head', 0.3 * (1 - up) - 0.1 * Math.sin(Math.PI * rise));
      // hands on the knees, then down at the sides
      const arms = 1 - up;
      for (const s of ['L', 'R']) {
        turn(`arm${s}`, -0.75 * arms);
        turn(`fore${s}`, -0.12 - 0.55 * arms);
      }
    },
    reset() {
      bones.hips.position.z = 0;
      bones.hips.position.y = hipY;
      for (const n of LIMBS) bones[n].quaternion.identity();
    },
    dispose() {
      root.removeFromParent();
      mesh.geometry.dispose();
      map.dispose();
      mesh.material.dispose();
    },
  };
}
