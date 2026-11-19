// Blood duel hallucinations: past 1000 cc lost (shared/blood.js), now and
// then the design of a tile the player sees comes alive and goes back to
// its place. The design is lifted onto its own see-through plate over the
// face (the tile shows an empty face meanwhile), and the plate moves:
// - the bird of the 1 of sou leaves the tile, flies a lap and comes back;
// - the circles of the pin turn round; the 1 of pin turns and blinks, an eye;
// - the bamboos of the sou sway like grass;
// - the numbers of the man shake;
// - the red dragon drips blood, and the drop dries;
// - a shadow goes across the white dragon, as if someone looked from inside;
// - the other honours float off the face and settle back;
// - a glass tile (Washizu) mists over, as with a breath, and clears.
// One at a time from 1000 cc, more often (two at once) from 1500. Never
// on the drawn tile or the last discard, which may be waiting for a call.
import * as THREE from '../../vendor/three/three.module.min.js';
import { tileType } from '../shared/tiles.js';
import { W, H, D } from './tiles3d.js';

// which hallucination a tile gets
export function kindOf(id, glass) {
  const t = tileType(id);
  if (glass && Math.random() < 0.3) return 'fog';
  if (t === 18) return 'bird';
  if (t === 9) return 'eye';
  if (t > 9 && t < 18) return 'spin';
  if (t > 18 && t < 27) return 'sway';
  if (t < 9) return 'shake';
  if (t === 33) return 'drip';
  if (t === 31) return 'ghost';
  return 'lift';
}

// how long each one lasts, in seconds
const LENGTH = { bird: 3.2, eye: 2.6, spin: 2, sway: 2.4, shake: 1.4, drip: 3, ghost: 2.6, lift: 2.2, fog: 3 };

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const bell = (u) => Math.sin(Math.PI * Math.max(0, Math.min(1, u)));

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// sources(): the tiles that can hallucinate now, [{ id, mesh }]
export function createHallucinations({ kit, onTick, sources }) {
  const drop = canvasTexture(64, 96, (g) => {
    g.fillStyle = '#9c0b06';
    g.beginPath();
    g.moveTo(32, 4);
    g.bezierCurveTo(40, 30, 58, 50, 58, 66);
    g.arc(32, 66, 26, 0, Math.PI);
    g.bezierCurveTo(6, 50, 24, 30, 32, 4);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.beginPath();
    g.ellipse(22, 64, 6, 10, -0.4, 0, Math.PI * 2);
    g.fill();
  });
  const shadow = canvasTexture(120, 160, (g, w, h) => {
    // a dark face, blurred: two eyes and a mouth in the dark
    const r = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(20,8,6,.55)');
    r.addColorStop(1, 'rgba(20,8,6,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.filter = 'blur(3px)';
    g.beginPath();
    g.ellipse(42, 66, 9, 5, 0, 0, Math.PI * 2);
    g.ellipse(78, 66, 9, 5, 0, 0, Math.PI * 2);
    g.ellipse(60, 108, 14, 4, 0, 0, Math.PI * 2);
    g.fill();
  });
  const mist = canvasTexture(120, 160, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    r.addColorStop(0, 'rgba(245,250,252,.92)');
    r.addColorStop(1, 'rgba(245,250,252,.35)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const plateGeo = new THREE.PlaneGeometry(W, H);
  const dropGeo = new THREE.PlaneGeometry(W * 0.22, W * 0.33);
  const plateMat = (map, opts = {}) => new THREE.MeshPhongMaterial({
    map, transparent: true, depthWrite: false, specular: 0x151515, shininess: 14, side: THREE.DoubleSide, ...opts,
  });

  let stage = 0;
  let wait = 2;
  const live = []; // { id, mesh, kind, t, len, plate, extra, front, map }

  function start(src, forced = null) {
    const { id, mesh } = src;
    const front = mesh.userData.mats && mesh.userData.mats[1];
    if (!front || !front.map) return null;
    const glass = !!mesh.userData.glass;
    const kind = forced || kindOf(id, glass);
    const fx = { id, mesh, kind, t: 0, len: LENGTH[kind], front, map: front.map, extra: null };
    const overlay = kind === 'ghost' || kind === 'fog';
    if (overlay) {
      fx.plate = new THREE.Mesh(plateGeo, plateMat(kind === 'ghost' ? shadow : mist, { opacity: 0, shininess: 0 }));
    } else {
      // the design leaves the face: the tile shows an empty one meanwhile
      fx.plate = new THREE.Mesh(plateGeo, plateMat(kit.designTexture(id)));
      front.map = kit.blankFace(glass);
    }
    fx.plate.position.z = D / 2 + 0.004;
    fx.plate.renderOrder = 6;
    mesh.add(fx.plate);
    if (kind === 'drip') {
      fx.extra = new THREE.Mesh(dropGeo, plateMat(drop, { opacity: 0 }));
      fx.extra.renderOrder = 7;
      fx.extra.position.set(0.05, -H * 0.18, D / 2 + 0.008);
      mesh.add(fx.extra);
    }
    live.push(fx);
    return fx;
  }

  function stop(fx) {
    fx.mesh.remove(fx.plate);
    fx.plate.material.dispose();
    if (fx.extra) {
      fx.mesh.remove(fx.extra);
      fx.extra.material.dispose();
    }
    // the design is back on the face
    if (fx.front.map !== fx.map && !fx.front.userData.disposed) fx.front.map = fx.map;
    live.splice(live.indexOf(fx), 1);
  }

  function pose(fx) {
    const u = Math.min(1, fx.t / fx.len);
    const p = fx.plate;
    const z0 = D / 2 + 0.004;
    p.position.set(0, 0, z0);
    p.rotation.set(0, 0, 0);
    p.scale.set(1, 1, 1);
    switch (fx.kind) {
      case 'bird': {
        // up off the face, a lap round the tile with its wings beating, and back
        const out = Math.min(1, u / 0.15, (1 - u) / 0.15);
        const k = Math.max(0, Math.min(1, (u - 0.15) / 0.7));
        const a = k * Math.PI * 2;
        p.position.set(Math.sin(a) * 1.1 * out, (Math.sin(a * 2) * 0.35 + 0.25 * out) * out, z0 + 0.7 * ease(out));
        p.rotation.z = Math.cos(a) * 0.35 * out;
        p.scale.set(1 - 0.35 * Math.abs(Math.sin(u * Math.PI * 22)) * out, 1, 1);
        break;
      }
      case 'eye':
        p.rotation.z = ease(Math.min(1, u / 0.6)) * Math.PI * 2;
        // and then it blinks, twice
        p.scale.y = u > 0.65 ? 1 - 0.92 * Math.max(0, Math.sin(((u - 0.65) / 0.35) * Math.PI * 2)) : 1;
        break;
      case 'spin':
        p.rotation.z = ease(u) * Math.PI * 2 * (fx.id % 2 ? 1 : -1);
        break;
      case 'sway':
        p.rotation.z = Math.sin(u * Math.PI * 4) * 0.22 * bell(u);
        p.scale.x = 1 + Math.sin(u * Math.PI * 8) * 0.06 * bell(u);
        p.position.x = Math.sin(u * Math.PI * 4) * 0.08 * bell(u);
        break;
      case 'shake': {
        const a = 0.045 * bell(u);
        p.position.x = (Math.random() - 0.5) * 2 * a;
        p.position.y = (Math.random() - 0.5) * 2 * a;
        p.rotation.z = (Math.random() - 0.5) * 2 * a;
        break;
      }
      case 'drip': {
        // the design reddens, a drop runs down past the edge and dries
        p.material.color.setRGB(1, 1 - 0.45 * bell(u), 1 - 0.45 * bell(u));
        const k = Math.max(0, (u - 0.15) / 0.7);
        fx.extra.position.y = -H * 0.18 - k * H * 0.75;
        fx.extra.scale.y = 1 + k * 0.6;
        fx.extra.material.opacity = Math.min(1, u / 0.15) * (1 - Math.max(0, (u - 0.8) / 0.2));
        break;
      }
      case 'ghost':
        p.position.x = (u - 0.5) * W * 1.1;
        p.material.opacity = bell(u) * 0.9;
        break;
      case 'lift':
        p.position.z = z0 + 0.45 * bell(u);
        p.rotation.z = Math.sin(u * Math.PI * 3) * 0.18 * bell(u);
        break;
      case 'fog':
        p.material.opacity = bell(u) ** 0.6;
        break;
      default:
    }
  }

  onTick((dt) => {
    for (const fx of live.slice()) {
      fx.t += dt;
      // the tile left the table (a new hand): drop it
      if (!fx.mesh.parent || fx.t >= fx.len) stop(fx);
      else pose(fx);
    }
    if (stage < 2) return;
    wait -= dt;
    const most = stage >= 3 ? 2 : 1;
    if (wait > 0 || live.length >= most) return;
    wait = stage >= 3 ? 1.8 + Math.random() * 2.2 : 4 + Math.random() * 4;
    const busy = new Set(live.map((fx) => fx.mesh));
    const pool = sources().filter((x) => x.id !== null && !busy.has(x.mesh) && x.mesh.visible);
    if (pool.length) start(pool[Math.floor(Math.random() * pool.length)]);
  });

  return {
    // 0-3, as bloodStage: hallucinations from 2
    setStage(n) {
      stage = n;
      if (stage < 2) for (const fx of live.slice()) stop(fx);
    },
    // lab: one now, on a tile of this type if there is one in sight
    now(type = null, kind = null) {
      const pool = sources().filter((x) => x.id !== null && (type === null || tileType(x.id) === type));
      return pool.length ? !!start(pool[Math.floor(Math.random() * pool.length)], kind) : false;
    },
  };
}
