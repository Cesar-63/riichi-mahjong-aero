// The black cat, drawn: an almost cubic body, a cubic head with pointy
// ears, four stubby legs and a tail of four blocks, all made by code. Each
// face carries its own shade in its vertex colours (tops lighter, undersides
// darker), so the cat reads as a solid thing even with no lights, as in the
// town; on the mahjong table (lit: true) the lamp shades it as well. Its
// eyes are flat yellow-green and never darken.
import * as THREE from '../../vendor/three/three.module.min.js';

const FUR = [0.085, 0.08, 0.095];
const INNER = [0.32, 0.16, 0.2]; // inside the ears, the nose
const EYE = new THREE.Color(0.86, 0.9, 0.28);

// a box (or any geometry) with one colour, shaded by which way each face looks
function painted(geo, rgb) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const colors = [];
  for (let i = 0; i < n.count; i++) {
    const k = 0.62 + 0.5 * Math.max(0, n.getY(i)) - 0.25 * Math.max(0, -n.getY(i)) + 0.12 * n.getZ(i);
    colors.push(rgb[0] * k + 0.035, rgb[1] * k + 0.035, rgb[2] * k + 0.045); // a little blue sheen
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export function createCatModel({ lit = false } = {}) {
  const mat = lit
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshBasicMaterial({ vertexColors: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: EYE });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const geos = [];
  const box = (w, h, d, rgb = FUR) => {
    const g = painted(new THREE.BoxGeometry(w, h, d), rgb);
    geos.push(g);
    return g;
  };
  const part = (geo, m = mat) => new THREE.Mesh(geo, m);

  const root = new THREE.Group();
  const body = new THREE.Group(); // pivots at the back of the hips, to sit
  body.position.set(0, 0.13, -0.16);
  root.add(body);
  const torso = part(box(0.25, 0.23, 0.34));
  torso.position.set(0, 0.115, 0.16);
  body.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 0.25, 0.3);
  body.add(head);
  const skull = part(box(0.24, 0.21, 0.2));
  skull.position.set(0, 0.04, 0.04);
  head.add(skull);
  for (const s of [-1, 1]) {
    const ear = part(painted(new THREE.ConeGeometry(0.06, 0.1, 4, 1), FUR));
    geos.push(ear.geometry);
    ear.rotation.y = Math.PI / 4;
    ear.position.set(s * 0.075, 0.19, 0.03);
    head.add(ear);
    const inner = part(box(0.04, 0.05, 0.005, INNER));
    inner.position.set(s * 0.075, 0.18, 0.062);
    head.add(inner);
    const eye = part(box(0.06, 0.045, 0.006), eyeMat);
    eye.position.set(s * 0.058, 0.06, 0.143);
    head.add(eye);
    const pupil = part(box(0.014, 0.04, 0.006), pupilMat);
    pupil.position.set(s * 0.058, 0.06, 0.147);
    head.add(pupil);
    // whiskers: thin pale sticks
    for (const dy of [-0.012, 0.012]) {
      const w = part(box(0.11, 0.004, 0.004, [0.55, 0.55, 0.55]));
      w.position.set(s * 0.13, -0.01 + dy, 0.14);
      w.rotation.z = s * dy * 8;
      head.add(w);
    }
  }
  const nose = part(box(0.03, 0.02, 0.01, INNER));
  nose.position.set(0, 0.01, 0.145);
  head.add(nose);

  const legs = [];
  for (const [x, z, front] of [[-0.08, 0.27, true], [0.08, 0.27, true], [-0.08, 0.05, false], [0.08, 0.05, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.02, z);
    body.add(pivot);
    const leg = part(box(0.065, 0.15, 0.065));
    leg.position.y = -0.075;
    pivot.add(leg);
    legs.push({ pivot, front });
  }

  // the tail: blocks chained from the rump, each turning a little more
  const tail = [];
  let parent = body;
  let at = new THREE.Vector3(0, 0.19, 0.0);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.copy(at);
    parent.add(seg);
    const block = part(box(0.045, 0.045, 0.1));
    block.position.z = -0.045;
    seg.add(block);
    tail.push(seg);
    parent = seg;
    at = new THREE.Vector3(0, 0, -0.09);
  }

  let phase = 0;
  let stride = 0;
  let sitK = 0;
  let talk = 0; // seconds left of the little hop of speaking

  return {
    root,
    place(x, y, z, facing) {
      root.position.set(x, y, z);
      root.rotation.y = facing;
    },
    tint(rgb) {
      mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
    },
    speak() {
      talk = 0.45;
    },
    // walking (moving) or sitting once it has been still a while; t in seconds
    pose(moving, sitting, dt, t) {
      stride += ((moving ? 1 : 0) - stride) * Math.min(1, dt * 10);
      sitK += ((sitting && !moving ? 1 : 0) - sitK) * Math.min(1, dt * 4);
      phase += dt * 14 * stride;
      const s = Math.sin(phase) * stride;
      legs.forEach((l, i) => {
        const swing = (i === 0 || i === 3 ? s : -s) * 0.7;
        // sitting: the front legs lean back to stay upright, the hind ones fold
        l.pivot.rotation.x = swing + (l.front ? 0.5 : -1.3) * sitK;
      });
      body.rotation.x = -0.5 * sitK;
      body.position.y = 0.13 + Math.abs(Math.cos(phase)) * 0.02 * stride - 0.05 * sitK;
      talk = Math.max(0, talk - dt);
      const hop = talk > 0 ? Math.sin((talk / 0.45) * Math.PI) : 0;
      head.rotation.x = 0.5 * sitK - 0.35 * hop + Math.sin(t * 0.7) * 0.04;
      head.rotation.z = Math.sin(t * 0.45) * 0.08 * (1 - stride);
      body.scale.set(1, 1 + hop * 0.08, 1);
      // the tail: up and swaying, lower and quicker while walking
      tail.forEach((seg, i) => {
        seg.rotation.x = i === 0 ? 0.9 - 1.1 * sitK - 0.4 * stride : 0.22 + 0.04 * i - 0.2 * sitK;
        seg.rotation.y = Math.sin(t * (1.6 + 2.5 * stride) - i * 0.7) * (0.25 + 0.1 * i);
      });
    },
    dispose() {
      root.removeFromParent();
      for (const g of geos) g.dispose();
      mat.dispose();
      eyeMat.dispose();
      pupilMat.dispose();
    },
  };
}
