// People sitting at the table (lab only for now): low-poly PS1-style men
// from Mesh2Motion (CC0, public/models/personajes/README.md), all on one
// humanoid rig, so every animation fits every character. The three rivals
// sit in their chairs facing the table, breathing (sitting idle) and now and
// then talking; the player's own man (seat 0) shows only when asked for (an
// episode's cameras look at him; the game's camera would be inside him).
// Reactions (celebrating, clapping, a tantrum…) come from standing
// animations played on the upper body only, over the sitting legs.
// Animations run on the world's clock, so the lab can pause, slow down and
// record them like the rest of the table.
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { TABLE } from './world.js';

const DIR = 'models/personajes/';
// relative seat (0 = me, 1 = right, 2 = across, 3 = left) → model and
// temperament: gesture, how much of the talking animation shows over the
// sitting one (1 = all of it, waving his hands; less = the same words, more
// contained); pace, the speed of his animations; first and every, when he
// first speaks and how long he keeps quiet after that (seconds; fixed, so
// every run of a scene is the same; I never talk by myself)
const CAST = {
  0: { model: 'psx-15', gesture: 0.8, pace: 1, first: Infinity, every: Infinity }, // me: young, leather jacket
  1: { model: 'psx-10', gesture: 1, pace: 1.05, first: 2.5, every: 9 }, // talkative, all hands
  2: { model: 'psx-32', gesture: 0.35, pace: 0.8, first: 7, every: 16 }, // the old regular: few words, barely moves
  3: { model: 'psx-05', gesture: 0.6, pace: 0.95, first: 4.5, every: 12 }, // the office worker: measured
};
// reactions, played on the upper body (see act below)
const REACTIONS = ['victory', 'yes', 'clapping', 'reject', 'angry', 'confused', 'head-nod', 'idle-foldarms'];
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
// the legs keep sitting whatever the upper body does
const LEGS = /^(root|pelvis|thigh|calf|foot|ball)/;
const half = (clip, legs) => new THREE.AnimationClip(`${clip.name}-${legs ? 'legs' : 'body'}`, clip.duration, clip.tracks.filter((t) => LEGS.test(t.name.split('.')[0]) === legs));
// a soft start and end (seconds)
const EASE_IN = 0.3;
const EASE_OUT = 0.4;

export function createCharacters(world) {
  const group = new THREE.Group();
  world.scene.add(group);
  const people = {};
  let auto = true;
  let meOn = false;
  const loader = new GLTFLoader();
  const load = (name) => loader.loadAsync(`${DIR}${name}.glb`);
  const seats = Object.keys(CAST).map(Number);

  const ready = Promise.all([
    load('sitting-idle'),
    load('sitting-talking'),
    ...REACTIONS.map(load),
    ...seats.map((s) => load(CAST[s].model)),
  ]).then(([idleFile, talkFile, ...rest]) => {
    const idle = idleFile.animations[0];
    const talk = half(talkFile.animations[0], false);
    const reactions = Object.fromEntries(REACTIONS.map((name, i) => [name, half(rest[i].animations[0], false)]));
    const models = rest.slice(REACTIONS.length);
    seats.forEach((seat, i) => {
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
      body.visible = seat !== 0 || meOn;
      group.add(body);

      // legs always sitting; the upper body shares its weight between
      // sitting, talking and a reaction, always adding up to 1, so what is
      // left over is the sitting pose, never the model's rest pose
      const { gesture, pace, first, every } = CAST[seat];
      const mixer = new THREE.AnimationMixer(body);
      const legs = mixer.clipAction(half(idle, true));
      const sit = mixer.clipAction(half(idle, false));
      const words = mixer.clipAction(talk);
      words.setLoop(THREE.LoopOnce, 1);
      words.clampWhenFinished = true;
      for (const x of [legs, sit, words]) x.timeScale = pace;
      for (const x of [legs, sit]) {
        x.play();
        x.time = seat * 0.6; // out of step with the others
      }
      const acts = Object.fromEntries(Object.entries(reactions).map(([name, clip]) => [name, mixer.clipAction(clip)]));
      people[seat] = { body, mixer, sit, words, acts, gesture, talkGain: gesture, wait: first, every, cur: null };
    });
  });

  // how far into a soft start and end, 0..1
  const ramp = (t, len) => Math.max(0, Math.min(1, t / EASE_IN, (len - t) / EASE_OUT));

  function step(p, dt) {
    if (auto) p.wait -= dt;
    if (p.wait <= 0) {
      p.wait = p.every;
      p.talkGain = p.gesture;
      p.words.reset().play();
    }
    const tw = p.words.isRunning() ? p.talkGain * ramp(p.words.time, p.words.getClip().duration) : 0;
    let tr = 0;
    const c = p.cur;
    if (c) {
      c.e += dt;
      const len = c.hold ? Infinity : c.action.getClip().duration / c.action.timeScale;
      const out = c.releasedAt === null ? 1 : 1 - (c.e - c.releasedAt) / EASE_OUT;
      tr = c.intensity * Math.min(ramp(c.e, len), out);
      if (out <= 0 || c.e >= len) {
        c.action.stop();
        p.cur = null;
        tr = 0;
      }
    }
    const k = tw + tr > 1 ? 1 / (tw + tr) : 1;
    p.words.setEffectiveWeight(tw * k);
    if (p.cur) p.cur.action.setEffectiveWeight(tr * k);
    p.sit.setEffectiveWeight(1 - (tw + tr) * k);
    p.mixer.update(dt);
  }

  world.onTick((dt) => {
    if (group.visible) for (const p of Object.values(people)) step(p, dt);
  });
  const chairHome = world.chairs.map((c) => c.position.clone());
  const placeChairs = () => {
    world.chairs.forEach((c, i) => {
      const h = chairHome[i];
      const k = group.visible ? CHAIR_DIST / Math.hypot(h.x, h.z) : 1;
      c.position.set(h.x * k, h.y, h.z * k);
    });
    // my own chair (hidden in the game, it would block the view) behind my man
    world.chairs[0].visible = group.visible && meOn;
  };
  return {
    ready,
    setVisible(on) {
      group.visible = on;
      placeChairs();
    },
    // my own man at seat 0 (for cameras that look at me)
    setMe(on) {
      meOn = !!on;
      if (people[0]) people[0].body.visible = meOn;
      placeChairs();
    },
    // the rivals' talk by themselves (an episode directs them instead)
    setAuto(on) {
      auto = !!on;
    },
    // Someone does something: 'talk' or one of REACTIONS, once, over his
    // sitting; intensity, how much of it shows (1 = all; less, contained);
    // pace, its speed; hold, it keeps going until act(seat, null) lets it go
    // (folded arms). A new reaction replaces the one going on.
    act(seat, name, { intensity = 1, pace = 1, hold = false } = {}) {
      const p = people[seat];
      if (!p) return;
      if (name === 'talk') {
        p.talkGain = intensity === 1 ? p.gesture : intensity;
        p.words.reset().play();
        return;
      }
      if (!name) {
        if (p.cur && p.cur.releasedAt === null) p.cur.releasedAt = p.cur.e;
        return;
      }
      const action = p.acts[name];
      if (!action) throw new Error(`no hay reacción "${name}"`);
      if (p.cur && p.cur.action !== action) p.cur.action.stop();
      action.reset();
      action.timeScale = pace;
      action.setLoop(hold ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.play();
      p.cur = { action, intensity, hold, e: 0, releasedAt: null };
    },
  };
}
