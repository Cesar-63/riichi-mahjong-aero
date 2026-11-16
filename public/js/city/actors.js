// The people of the town: the same low-poly characters that sit at the
// mahjong table (public/models/personajes/), drawn unlit (texture × one
// colour, the baked light where they stand) and posed by code: standing,
// walking, or sitting on a stool with the hands on the table.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const DIR = 'models/personajes/';
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const SEAT = 0.58; // height of the hips of someone sitting on a stool
const LIMBS = ['spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR'];

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
    reset() {
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
