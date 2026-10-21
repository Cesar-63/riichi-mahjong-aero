// Tile model for the 3D view, PS2 style: one plain box per tile (no rounded
// separate pieces, so no step between the face and the back), with the
// edge bevel and shading painted into the textures instead of modelled.
// The sides use vertex colours: ivory body towards the face, a band of the
// back colour towards the back, with a short blend between them.
import * as THREE from '../../vendor/three/three.module.min.js';
import { tileType, isAka, suitOf, numOf, imageName, HONOR_KANJI, SUIT_KANJI } from '../shared/tiles.js';
import { tileset } from '../render.js';

export const W = 1; // width
export const H = 4 / 3; // height (face long side)
export const D = 0.74; // thickness
export const GAP = 0.045; // air between neighbouring tiles, so they never fuse into one block
const BACK_SHARE = 0.36; // part of the thickness in the back colour

const LOOKS = {
  aero: { back: '#1f98e4', backHi: '#7fd6ff', backLo: '#0c5c9c', ivory: '#f6f1e2', ivoryLo: '#d9cfb4', glow: 0x2bd8ff, shine: 40 },
  tetsuya: { back: '#d8ab52', backHi: '#f4d78a', backLo: '#9c7228', ivory: '#f2ecda', ivoryLo: '#cfc3a2', glow: 0xff9a2a, shine: 18 },
};

export function createTileKit(renderer) {
  let look = LOOKS.aero;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------------------------------------------------------- geometry
  // Box with three depth segments; the inner rings are moved so the side
  // splits into back band | blend | body.
  const geo = new THREE.BoxGeometry(W, H, D, 1, 1, 3);
  const pos = geo.attributes.position;
  const zBack = -D / 2 + D * BACK_SHARE;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (Math.abs(z + D / 6) < 1e-4) pos.setZ(i, zBack);
    else if (Math.abs(z - D / 6) < 1e-4) pos.setZ(i, zBack + D * 0.05);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  function paintSides() {
    // sides get less light than the back face, so the band is a bit brighter
    const back = new THREE.Color(look.back).lerp(new THREE.Color(look.backHi), 0.35).convertSRGBToLinear();
    const ivory = new THREE.Color(look.ivory).convertSRGBToLinear();
    const shade = new THREE.Color(look.ivoryLo).convertSRGBToLinear();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const c = z <= zBack + 1e-4 ? back : z > D / 2 - 1e-4 ? ivory : shade.clone().lerp(ivory, 0.55);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------- textures
  const canvasTex = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return { c, g: c.getContext('2d'), t };
  };
  // painted bevel: light on the top/left rim, shade on the bottom/right rim
  function bevel(g, w, h, hi, lo, r) {
    g.lineWidth = r;
    g.strokeStyle = lo;
    g.beginPath();
    g.moveTo(w - r / 2, r / 2);
    g.lineTo(w - r / 2, h - r / 2);
    g.lineTo(r / 2, h - r / 2);
    g.stroke();
    g.strokeStyle = hi;
    g.beginPath();
    g.moveTo(r / 2, h - r / 2);
    g.lineTo(r / 2, r / 2);
    g.lineTo(w - r / 2, r / 2);
    g.stroke();
  }
  // thin dark line along every edge, so neighbouring tiles always read as
  // separate pieces (on every face, so it also shows on the sides)
  function outline(g, w, h, color, lw) {
    g.lineWidth = lw;
    g.strokeStyle = color;
    g.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
  }
  const edges = canvasTex(64, 64);
  edges.g.fillStyle = '#fff';
  edges.g.fillRect(0, 0, 64, 64);
  outline(edges.g, 64, 64, 'rgba(60, 46, 26, .7)', 4);

  const back = canvasTex(192, 256);
  function paintBack() {
    const { g } = back;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, look.backHi);
    grad.addColorStop(0.45, look.back);
    grad.addColorStop(1, look.backLo);
    g.fillStyle = grad;
    g.fillRect(0, 0, 192, 256);
    bevel(g, 192, 256, 'rgba(255,255,255,.45)', 'rgba(0,0,0,.25)', 10);
    outline(g, 192, 256, 'rgba(0,0,0,.5)', 4);
    back.t.needsUpdate = true;
  }

  const faces = new Map();
  function faceTexture(id) {
    const key = id === null ? 'blank' : imageName(id);
    if (faces.has(key)) return faces.get(key);
    const f = canvasTex(240, 320);
    f.key = key;
    f.id = id;
    f.img = null;
    if (id !== null && tileset.mode === 'img') {
      f.img = new Image();
      f.img.onload = () => paintFace(f);
      f.img.src = `${tileset.dir}${key}.${tileset.ext}`;
    }
    paintFace(f);
    faces.set(key, f);
    return f;
  }
  function paintFace(f) {
    const { g } = f;
    const grad = g.createLinearGradient(0, 0, 60, 320);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, look.ivory);
    grad.addColorStop(1, look.ivoryLo);
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 320);
    if (f.img && f.img.complete && f.img.naturalWidth) g.drawImage(f.img, 18, 22, 204, 276);
    else if (f.id !== null && tileset.mode !== 'img') {
      const t = tileType(f.id);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const red = isAka(f.id) || t < 9 || t === 33;
      g.fillStyle = red ? '#c0261e' : t < 18 ? '#1d4ea3' : t < 27 || t === 32 ? '#1d7a3a' : '#111';
      g.font = 'bold 150px serif';
      if (t >= 27) g.fillText(HONOR_KANJI[t - 27], 120, 165);
      else {
        g.fillText(String(numOf(t)), 120, 110);
        g.font = 'bold 100px serif';
        g.fillText(SUIT_KANJI[suitOf(t)], 120, 238);
      }
    }
    bevel(g, 240, 320, 'rgba(255,255,255,.95)', 'rgba(120,100,60,.38)', 12);
    outline(g, 240, 320, 'rgba(70,55,30,.6)', 5);
    f.t.needsUpdate = true;
  }

  // ---------------------------------------------------------- materials
  const phong = (opts) => new THREE.MeshPhongMaterial({ specular: 0x222222, shininess: look.shine, ...opts });
  const backMat = phong({ map: back.t });
  const sideMat = phong({ vertexColors: true, map: edges.t });

  function setLook(name) {
    look = LOOKS[name] || LOOKS.aero;
    paintSides();
    paintBack();
    for (const f of faces.values()) paintFace(f);
    backMat.shininess = look.shine;
  }
  setLook('aero');

  // BoxGeometry material order: +x, -x, +y, -y, +z (face), -z (back).
  // Side and face materials are per tile so each can be dimmed or lit alone.
  function makeTile(id) {
    const side = sideMat.clone();
    const front = phong({ map: faceTexture(id).t });
    side.shininess = front.shininess = look.shine;
    const mesh = new THREE.Mesh(geo, [side, side, side, side, front, backMat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = id;
    mesh.userData.mats = [side, front];
    return mesh;
  }

  // tint: 1 = normal, <1 darker; glow: hex colour or 0
  function style(mesh, tint, glow) {
    const key = `${tint}:${glow}`;
    if (mesh.userData.style === key) return;
    mesh.userData.style = key;
    for (const m of mesh.userData.mats) {
      m.color.setScalar(tint);
      m.emissive.setHex(glow || 0);
      m.emissiveIntensity = glow ? 0.35 : 0;
    }
  }

  function dispose(mesh) {
    for (const m of mesh.userData.mats || []) m.dispose();
  }

  return { makeTile, style, dispose, setLook, glowColor: () => look.glow };
}
