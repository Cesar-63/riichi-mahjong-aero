// Rivals sitting at the table (lab only for now): low-poly PS1-style men
// from Mesh2Motion (CC0, public/models/personajes/README.md), all on one
// humanoid rig, so every animation fits every character. They sit in the
// three rivals' chairs, facing the table, breathing (sitting idle) and now
// and then talking. Animations run on the world's clock, so the lab can
// pause, slow down and record them like the rest of the table.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { TABLE } from './world.js';

const DIR = 'models/personajes/';
// relative seat (1 = right, 2 = across, 3 = left) → model and temperament:
// gesture, how much of the talking animation shows over the sitting one
// (1 = all of it, waving his hands; less = the same words, more contained);
// pace, the speed of both animations; first and every, when he first speaks
// and how long he keeps quiet after that (seconds; fixed, so every run of a
// scene is the same)
const CAST = {
  1: { model: 'psx-10', gesture: 1, pace: 1.05, first: 2.5, every: 9 }, // talkative, all hands
  2: { model: 'psx-32', gesture: 0.35, pace: 0.8, first: 7, every: 16 }, // the old regular: few words, barely moves
  3: { model: 'psx-05', gesture: 0.6, pace: 0.95, first: 4.5, every: 12 }, // the office worker: measured
};
const SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
// 1 world unit is about 3.5 cm (the table top is 20 units over the floor, 70 cm)
const SCALE = 1 / 0.035;
const FLOOR = -20;
// the sitting animation puts the hips about 33 cm (9.4 units) behind the
// model's origin and the forearms on the table in front of it: at this
// distance from the centre the hands rest on the table's edge
const SEAT_DIST = TABLE / 2 + 5;
// the parlour's chair backs stand close to the table (nobody sits in them);
// with people seated they go behind their backs
const CHAIR_DIST = SEAT_DIST + 14;

export function createCharacters(world) {
  const group = new THREE.Group();
  world.scene.add(group);
  const mixers = [];
  const loader = new GLTFLoader();
  const load = (name) => loader.loadAsync(`${DIR}${name}.glb`);

  const ready = Promise.all([load('sitting-idle'), load('sitting-talking'), ...Object.values(CAST).map((c) => load(c.model))]).then(([idleFile, talkFile, ...models]) => {
    const idle = idleFile.animations[0];
    const talk = talkFile.animations[0];
    Object.keys(CAST).forEach((seat, i) => {
      const body = models[i].scene;
      body.traverse((o) => {
        if (!o.isMesh) return;
        // matte like everything in the parlour, and the texture's pixels kept sharp (PS1)
        const map = o.material.map;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.colorSpace = THREE.SRGBColorSpace;
        }
        o.material = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, envMapIntensity: 0.15 });
        o.castShadow = true;
        o.frustumCulled = false; // the skinned pose moves the mesh away from its rest bounds
      });
      const a = SEAT_ANGLE[seat];
      body.scale.setScalar(SCALE);
      body.position.set(Math.sin(a) * SEAT_DIST, FLOOR, Math.cos(a) * SEAT_DIST);
      body.rotation.y = a + Math.PI; // face the table
      group.add(body);

      // breathing all the time, each one out of step with the others; now and
      // then a few words. While he talks both animations play, mixed by his
      // gesture: the weights always add up to 1, so what is left over is the
      // sitting pose, never the model's rest pose
      const { gesture, pace, first, every } = CAST[seat];
      const mixer = new THREE.AnimationMixer(body);
      const rest = mixer.clipAction(idle);
      const words = mixer.clipAction(talk);
      words.setLoop(THREE.LoopOnce, 1);
      words.clampWhenFinished = true;
      rest.timeScale = words.timeScale = pace;
      rest.play();
      rest.time = seat * 0.6;
      let wait = first;
      const length = talk.duration;
      mixers.push((dt) => {
        wait -= dt;
        if (wait <= 0) {
          wait = every;
          words.reset().play();
        }
        // in and out of the words softly (0.4 s at each end)
        const t = words.isRunning() ? words.time : length;
        const mix = gesture * Math.min(1, t / 0.4, (length - t) / 0.4);
        words.setEffectiveWeight(Math.max(0, mix));
        rest.setEffectiveWeight(1 - Math.max(0, mix));
        mixer.update(dt);
      });
    });
  });

  world.onTick((dt) => {
    if (group.visible) for (const f of mixers) f(dt);
  });
  const chairHome = world.chairs.map((c) => c.position.clone());
  return {
    ready,
    setVisible(on) {
      group.visible = on;
      world.chairs.forEach((c, i) => {
        const h = chairHome[i];
        const k = on ? CHAIR_DIST / Math.hypot(h.x, h.z) : 1;
        c.position.set(h.x * k, h.y, h.z * k);
      });
    },
  };
}
