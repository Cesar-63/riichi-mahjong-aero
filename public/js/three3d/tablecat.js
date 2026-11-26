// The town's black cat on the mahjong table (games started in Ciudad): it
// jumps up from the floor onto the felt (a corner if it shows), sits facing the
// player, meows and says a line or two about kan in a speech bubble, then
// jumps down again. A click on it sends it flying off the table.
import * as THREE from '../../vendor/three/three.module.min.js';
import { createCatModel } from '../city/catmodel.js';
import { meow, unlockAudio } from '../city/meow.js';
import { sayFor } from '../city/cat.js';
import { TABLE } from './world.js';

const SCALE = 11; // the town is in metres; here a unit is about a tile's width (a small cat)
const FLOOR = -20;
const JUMP = 0.75; // seconds of a jump up or down
const GRAVITY = -45;

const lerp = (a, b, k) => a + (b - a) * k;

// world: the table's (world.js); bubble: the element of the speech bubble
export function createTableCat(world, { signal } = {}) {
  const { scene, camera, renderer } = world;
  const model = createCatModel();
  model.root.scale.setScalar(SCALE);
  model.root.visible = false;
  model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // the table's picture is tone-mapped: darker than in town, so it stays black
  model.tint([0.34, 0.31, 0.28]);
  scene.add(model.root);

  let visit = null; // { phase, t, lines, said, ... } while it is around
  let bubble = null;
  let sound = true;
  // Where it sits: a far corner of the felt, outside the walls and between
  // two players, or else inside the walls, in a corner between two discard
  // ponds (empty most of the hand), whichever the camera of the moment
  // shows whole: under the band of portraits and clear of the buttons on
  // the left. With the characters at the table the camera is low and a far
  // corner fits; from the usual higher view those hide under the portraits.
  // It jumps up from the floor straight out from there.
  const E = TABLE / 2 - 2;
  const SPOTS = [[-E, -E], [E, -E], [-7.5, -7.5], [7.5, -7.5], [7.5, 5], [-7.5, 5], [0, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const corner = new THREE.Vector3();
  const below = new THREE.Vector3();
  const probe = new THREE.Vector3();
  // the camera where it is going (it may still be gliding from another view)
  const aim = new THREE.PerspectiveCamera();
  const shows = (p) => {
    const foot = probe.copy(p).project(aim);
    if (foot.x < -0.5 || foot.x > 0.9 || foot.y < -0.45 || foot.z > 1) return false;
    const top = probe.copy(p).setY(0.6 * SCALE).project(aim);
    // under the band of portraits at the top of the game's screen
    return top.x > -0.5 && top.x < 0.9 && top.y < 0.5;
  };
  function chooseSpot() {
    const v = world.viewTarget();
    aim.fov = v.fov;
    aim.aspect = camera.aspect;
    aim.near = camera.near;
    aim.far = camera.far;
    aim.position.copy(v.pos);
    aim.lookAt(v.target);
    aim.updateProjectionMatrix();
    aim.updateMatrixWorld();
    corner.copy(SPOTS.find(shows) || SPOTS[0]);
    const out = new THREE.Vector3(corner.x, 0, corner.z).normalize();
    below.copy(corner).addScaledVector(out, 9).setY(FLOOR);
  }
  const head = new THREE.Vector3();
  let facing = 0;

  function say(text) {
    if (!bubble) return;
    bubble.querySelector('p').textContent = text;
    bubble.classList.add('show');
    model.speak();
    if (sound) meow({ pitch: visit && visit.phase === 'fly' ? 1.35 : 1 });
  }
  function hush() {
    if (bubble) bubble.classList.remove('show');
  }
  function placeBubble() {
    if (!bubble || !bubble.classList.contains('show')) return;
    head.set(0, 0.7, 0.1);
    model.root.localToWorld(head);
    head.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    const x = r.left + ((head.x + 1) / 2) * r.width;
    const y = r.top + ((1 - head.y) / 2) * r.height;
    const half = bubble.offsetWidth / 2;
    const cx = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
    bubble.style.left = `${cx}px`;
    bubble.style.top = `${Math.max(y, bubble.offsetHeight + 8)}px`;
    bubble.style.setProperty('--tail', `${Math.max(-half + 16, Math.min(half - 16, x - cx))}px`);
    bubble.style.visibility = head.z > 1 ? 'hidden' : '';
  }
  function leave() {
    visit = null;
    model.root.visible = false;
    hush();
  }

  // an arc from a to b, rising h over the higher of the two; k from 0 to 1
  const arc = (a, b, k, h) => {
    const y = lerp(a.y, b.y, k) + (Math.abs(b.y - a.y) / 2 + h) * 4 * k * (1 - k);
    return new THREE.Vector3(lerp(a.x, b.x, k), y, lerp(a.z, b.z, k));
  };

  world.onTick((dt, t) => {
    if (!visit) return;
    const v = visit;
    v.t += dt;
    // where the player sits: the cat looks that way
    const toCam = Math.atan2(camera.position.x - model.root.position.x, camera.position.z - model.root.position.z);
    if (v.phase === 'up' || v.phase === 'down') {
      const [a, b] = v.phase === 'up' ? [below, corner] : [corner, below];
      const k = Math.min(1, v.t / JUMP);
      const p = arc(a, b, k, 7);
      facing = Math.atan2(b.x - a.x, b.z - a.z);
      model.place(p.x, p.y, p.z, facing);
      model.pose(true, false, dt, t);
      if (k >= 1) {
        if (v.phase === 'down') return leave();
        v.phase = 'sit';
        v.t = 0;
        v.next = 0.6;
      }
    } else if (v.phase === 'sit') {
      facing += Math.atan2(Math.sin(toCam - facing), Math.cos(toCam - facing)) * Math.min(1, dt * 4);
      model.place(corner.x, corner.y, corner.z, facing);
      model.pose(false, v.t > 0.3, dt, t);
      if (v.t >= v.next) {
        if (v.said < v.lines.length) {
          const line = v.lines[v.said++];
          say(line);
          v.next = v.t + sayFor(line) + 0.6;
        } else {
          hush();
          v.phase = 'down';
          v.t = 0;
        }
      }
    } else if (v.phase === 'fly') {
      // clicked: off it goes, spinning, away from the player
      v.vel.y += GRAVITY * dt;
      v.pos.addScaledVector(v.vel, dt);
      v.spin += dt * 9;
      model.root.position.copy(v.pos);
      model.root.rotation.set(v.spin * 0.7, facing + v.spin, v.spin * 0.4);
      model.pose(true, false, dt, t);
      if (v.t > 0.9) hush();
      if (v.t > 2.2 || v.pos.y < FLOOR - 40) return leave();
    }
    placeBubble();
  });

  // a click on the cat: it flies off
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = (ev) => {
    if (!visit || visit.phase === 'fly' || !model.root.visible) return false;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(model.root, true).length > 0;
  };
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !hits(ev)) return;
    if (sound) unlockAudio();
    // out over the table's edge, tumbling, and a little away from the player
    const out = new THREE.Vector3(corner.x, 0, corner.z).normalize();
    const away = new THREE.Vector3().subVectors(model.root.position, camera.position).setY(0).normalize();
    visit.phase = 'fly';
    visit.t = 0;
    visit.pos = model.root.position.clone();
    visit.vel = out.multiplyScalar(24).addScaledVector(away, 8).add(new THREE.Vector3(0, 26, 0));
    visit.spin = 0;
    say(visit.flyLine || '¡Miaaaau!');
  }, { signal });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (visit && hits(ev)) renderer.domElement.style.cursor = 'pointer';
  }, { signal });

  return {
    // lines: what it says, in order; flyLine: what it yells when clicked
    visit({ lines, flyLine, bubble: el, sound: on = true }) {
      if (visit) return;
      bubble = el;
      sound = on;
      visit = { phase: 'up', t: 0, lines, said: 0, flyLine };
      chooseSpot();
      model.root.rotation.set(0, 0, 0);
      model.root.visible = true;
    },
    get visiting() { return !!visit; },
    leave,
    dispose() {
      leave();
      model.dispose();
    },
  };
}
