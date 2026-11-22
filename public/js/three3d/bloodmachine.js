// Blood duel: a blood drawing machine beside every duelist, as in the
// manga. A graduated glass tank on a metal stand, with a tube that runs to
// the player's arm. The tank fills with the blood the duelist has lost (out
// of the 2000 cc that kill) and empties when they win it back. While it
// fills, a thin stream runs down from the tube into the tank.
import * as THREE from '../../vendor/three/three.module.min.js';
import { BLOOD_LIMIT, COIN_FROM } from '../shared/blood.js';

const R = 1.15; // tank radius
const TANK_Y = 0.6; // bottom of the tank, over the table top
const TANK_H = 4.8; // tank height (2000 cc)
const FILL_SPEED = 0.35; // share of the tank per second while it fills or drains

// Where each machine stands, in the seat's own frame (the seat at +z,
// looking at the table centre), by relative seat: between the rail and the
// chair, a little off the middle so the player view sees the rivals' whole
// (left and right rivals towards the far side, the one in front to its
// right). Mine stands behind my left shoulder: the overview shows it, and
// the screen has its own copy (blood-ui.js).
const SPOT = [
  new THREE.Vector3(-14, 0, 17.6),
  new THREE.Vector3(3, 0, 17.8),
  new THREE.Vector3(6, 0, 17.8),
  new THREE.Vector3(-3, 0, 17.8),
];
// where the player view looks from (world): the scales face it
const EYE = new THREE.Vector3(0, 0, 31.5);

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// the scale printed on the glass: a mark every 250 cc, a number every 500
const scaleTex = canvasTexture(128, 512, (g, w, h) => {
  g.strokeStyle = 'rgba(245,238,220,.92)';
  g.fillStyle = 'rgba(245,238,220,.95)';
  g.font = 'bold 30px sans-serif';
  g.textBaseline = 'middle';
  for (let cc = 0; cc <= BLOOD_LIMIT; cc += 250) {
    const y = h - 6 - (cc / BLOOD_LIMIT) * (h - 12);
    const big = cc % 500 === 0;
    g.lineWidth = big ? 5 : 3;
    g.beginPath();
    g.moveTo(4, y);
    g.lineTo(big ? 44 : 26, y);
    g.stroke();
    if (big && cc) g.fillText(String(cc), 50, y);
  }
  // the coin zone, marked in red
  g.fillStyle = 'rgba(200,20,14,.35)';
  const y0 = h - 6 - (COIN_FROM / BLOOD_LIMIT) * (h - 12);
  g.fillRect(0, 6, 10, y0 - 6);
});
const plateTex = canvasTexture(128, 64, (g, w, h) => {
  g.fillStyle = '#d9cfb6';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5a4a32';
  g.lineWidth = 4;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#7a120c';
  g.font = 'bold 40px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('採血', w / 2, h / 2 + 2);
});

// (they stand out of the lamp's reach: a glow of their own keeps them in sight)
const metal = new THREE.MeshStandardMaterial({ color: 0x6a645b, metalness: 0.5, roughness: 0.4, emissive: 0x1c1915 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2824, metalness: 0.45, roughness: 0.6, emissive: 0x100e0c });
const blood = () => new THREE.MeshPhongMaterial({ color: 0x8a0805, emissive: 0x5a0303, specular: 0x884444, shininess: 80 });

function buildMachine() {
  const group = new THREE.Group();
  // stand: a pole from the floor and a box with the pump
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 20, 10), metal);
  pole.position.y = -10;
  const pump = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.4, 2.9), darkMetal);
  pump.position.y = TANK_Y - 0.75;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: plateTex }));
  plate.position.set(0, TANK_Y - 0.75, 1.46);
  // the tank: glass, a metal ring at each end, the scale on its front
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, TANK_H, 28, 1, true),
    new THREE.MeshPhongMaterial({ color: 0xd8eef4, emissive: 0x2a3a40, transparent: true, opacity: 0.28, specular: 0xffffff, shininess: 110, side: THREE.DoubleSide, depthWrite: false }),
  );
  glass.position.y = TANK_Y + TANK_H / 2;
  glass.renderOrder = 4;
  const ringGeo = new THREE.TorusGeometry(R, 0.12, 8, 28).rotateX(Math.PI / 2);
  const bottom = new THREE.Mesh(ringGeo, metal);
  bottom.position.y = TANK_Y;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.35, 28), metal);
  top.position.y = TANK_Y + TANK_H + 0.17;
  const scale = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, TANK_H),
    new THREE.MeshBasicMaterial({ map: scaleTex, transparent: true, depthWrite: false }),
  );
  scale.position.set(0, TANK_Y + TANK_H / 2, R + 0.02);
  scale.renderOrder = 5;
  // the blood: a column that grows from the bottom, with its surface
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.06, R - 0.06, 1, 28), blood());
  liquid.geometry.translate(0, 0.5, 0);
  liquid.position.y = TANK_Y;
  liquid.renderOrder = 3;
  // the stream from the inlet in the lid down to the surface
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), blood());
  stream.geometry.translate(0, -0.5, 0);
  stream.position.set(0.45, TANK_Y + TANK_H, 0);
  stream.visible = false;
  group.add(pole, pump, plate, glass, bottom, top, scale, liquid, stream);
  return { group, liquid, stream };
}

// a tube from the lid of the tank to the arm, sagging between them
function buildTube(from, to) {
  const mid = from.clone().lerp(to, 0.5);
  mid.y = Math.min(from.y, to.y) - 0.8;
  const up = from.clone();
  up.y += 1.4;
  const curve = new THREE.CatmullRomCurve3([from, up, mid, to]);
  const mat = new THREE.MeshPhongMaterial({ color: 0x5a0a07, emissive: 0x1a0000, transparent: true, opacity: 0.85, shininess: 60 });
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.09, 6, false), mat);
}

// place(rel, x, y, z, pose): table3d's seat transform
export function createBloodMachines({ scene, onTick, place }) {
  const seats = [0, 1, 2, 3].map((rel) => {
    const m = buildMachine();
    const spot = SPOT[rel];
    const at = place(rel, spot.x, spot.y, spot.z, 'stand');
    m.group.position.copy(at.p);
    // the scale on the glass faces the player view
    const look = EYE.clone().sub(at.p);
    m.group.rotation.y = Math.atan2(look.x, look.z);
    const root = new THREE.Group();
    root.add(m.group);
    // the tube runs from the lid to the player's arm, at the table's edge
    const arm = place(rel, Math.sign(spot.x) * 2.5, 1.4, 16.4, 'stand').p;
    const lidPos = new THREE.Vector3(0, TANK_Y + TANK_H + 0.35, 0).add(m.group.position);
    const tube = buildTube(lidPos, arm);
    root.add(tube);
    root.visible = false;
    scene.add(root);
    return { root, ...m, tube, fill: 0, goal: 0, known: false };
  });

  onTick((dt, t) => {
    for (const s of seats) {
      if (!s.root.visible) continue;
      const d = s.goal - s.fill;
      const step = FILL_SPEED * dt;
      s.fill = Math.abs(d) <= step ? s.goal : s.fill + Math.sign(d) * step;
      const h = Math.max(0.001, s.fill * TANK_H);
      // a little slosh on the surface while it moves
      s.liquid.scale.y = h + (d !== 0 ? Math.sin(t * 18) * 0.03 : 0);
      s.stream.visible = d > 0;
      if (s.stream.visible) s.stream.scale.y = Math.max(0.01, TANK_H - h + 0.2);
    }
  });

  return {
    // v.blood: the cc each duelist lost; relOf: absolute seat -> relative
    update(v, relOf) {
      const b = v && v.blood;
      seats.forEach((s) => { s.root.visible = false; });
      if (!b) {
        seats.forEach((s) => { s.known = false; });
        return;
      }
      for (const abs of b.duelists) {
        const s = seats[relOf(abs)];
        s.root.visible = true;
        s.goal = Math.min(1, (b.lost[abs] || 0) / BLOOD_LIMIT);
        // a game seen for the first time: the tank is already where it is
        if (!s.known) s.fill = s.goal;
        s.known = true;
      }
    },
  };
}
