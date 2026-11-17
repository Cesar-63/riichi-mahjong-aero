// Tile model for the 3D view, PS2 style: one plain box per tile (no rounded
// separate pieces, so no step between the face and the back), with the
// edge bevel and shading painted into the textures instead of modelled.
// The sides use vertex colours: ivory body towards the face, a band of the
// back colour towards the back, with a short blend between them.
import * as THREE from '../../vendor/three/three.module.min.js';
import { tileType, isAka, isGlass, suitOf, numOf, imageName, HONOR_KANJI, SUIT_KANJI } from '../shared/tiles.js';
import { tileset } from '../render.js';

export const W = 1; // width
export const H = 4 / 3; // height (face long side)
export const D = 0.74; // thickness
export const GAP = 0.045; // air between neighbouring tiles, so they never fuse into one block
const BACK_SHARE = 0.36; // part of the thickness in the back colour

// parlour tiles: yellow backs, ivory bodies
// muted, aged colours: the parlour is not brightly lit
const look = { back: '#c49c4e', backHi: '#dcbf7e', backLo: '#8a6426', ivory: '#e9e1c9', ivoryLo: '#c3b593', glow: 0xff9a2a, shine: 14 };
// Washizu glass tiles: a pale, cold body you see through, with the design
// on the face and again, readable, on the back
const glassLook = { body: '#cfe6ee', face: [228, 242, 248], shine: 80 };

export function createTileKit(renderer) {
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
    const back = new THREE.Color(look.back).lerp(new THREE.Color(look.backHi), 0.15).convertSRGBToLinear();
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
  // a soft line round a face: blurred a little, so neighbouring tiles stay
  // apart without a hard drawn edge
  function outline(g, w, h, color, lw) {
    g.save();
    g.filter = `blur(${lw * 0.35}px)`;
    g.lineWidth = lw;
    g.strokeStyle = color;
    g.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
    g.restore();
  }
  const edges = canvasTex(64, 64);
  edges.g.fillStyle = '#fff';
  edges.g.fillRect(0, 0, 64, 64);
  outline(edges.g, 64, 64, 'rgba(60, 46, 26, .38)', 3);

  const back = canvasTex(192, 256);
  function paintBack() {
    const { g } = back;
    // a nearly flat colour (real tile backs are one plastic colour), only
    // the faintest shading and a soft bevel at the rim
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, new THREE.Color(look.back).lerp(new THREE.Color(look.backHi), 0.12).getStyle());
    grad.addColorStop(1, new THREE.Color(look.back).lerp(new THREE.Color(look.backLo), 0.1).getStyle());
    g.fillStyle = grad;
    g.fillRect(0, 0, 192, 256);
    bevel(g, 192, 256, 'rgba(255,255,255,.22)', 'rgba(0,0,0,.16)', 8);
    outline(g, 192, 256, 'rgba(0,0,0,.28)', 3);
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
  // the design alone (image or painted text), in a 240 x 320 face
  function drawDesign(g, f) {
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
  }
  function paintFace(f) {
    if (f.glass) return paintGlass(f);
    const { g } = f;
    const grad = g.createLinearGradient(0, 0, 60, 320);
    grad.addColorStop(0, '#f5efdd');
    grad.addColorStop(0.5, look.ivory);
    grad.addColorStop(1, look.ivoryLo);
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 320);
    drawDesign(g, f);
    bevel(g, 240, 320, 'rgba(255,255,255,.95)', 'rgba(120,100,60,.38)', 12);
    outline(g, 240, 320, 'rgba(70,55,30,.32)', 4);
    f.t.needsUpdate = true;
  }

  // Glass faces: see-through, a little frosted so the design always reads
  // (on the felt and over the dark under my hand), with a cold rim and a
  // streak of light across. The back carries the same design, readable
  // from behind and a touch fainter, as seen through the glass.
  const glassFaces = new Map();
  function glassTexture(id, back) {
    const key = `${id === null ? 'blank' : imageName(id)}:${back ? 'b' : 'f'}`;
    if (glassFaces.has(key)) return glassFaces.get(key);
    const f = canvasTex(240, 320);
    Object.assign(f, { key, id, glass: true, back, img: null });
    if (id !== null && tileset.mode === 'img') {
      f.img = new Image();
      f.img.onload = () => paintFace(f);
      f.img.src = `${tileset.dir}${imageName(id)}.${tileset.ext}`;
    }
    paintFace(f);
    glassFaces.set(key, f);
    return f;
  }
  function paintGlass(f) {
    const { g } = f;
    const [r, gr, b] = glassLook.face;
    g.clearRect(0, 0, 240, 320);
    const grad = g.createLinearGradient(0, 0, 240, 320);
    grad.addColorStop(0, `rgba(${r},${gr},${b},${f.back ? 0.62 : 0.86})`);
    grad.addColorStop(1, `rgba(${r - 30},${gr - 18},${b - 10},${f.back ? 0.52 : 0.78})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 320);
    g.save();
    g.globalAlpha = f.back ? 0.82 : 1;
    drawDesign(g, f);
    g.restore();
    // a streak of light across the glass
    g.save();
    g.globalCompositeOperation = 'lighter';
    const shine = g.createLinearGradient(0, 0, 240, 320);
    shine.addColorStop(0.18, 'rgba(255,255,255,0)');
    shine.addColorStop(0.26, 'rgba(255,255,255,.22)');
    shine.addColorStop(0.32, 'rgba(255,255,255,0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, 240, 320);
    g.restore();
    bevel(g, 240, 320, 'rgba(255,255,255,.95)', 'rgba(70,110,130,.55)', 12);
    outline(g, 240, 320, 'rgba(40,80,100,.45)', 4);
    f.t.needsUpdate = true;
  }

  // ---------------------------------------------------------- materials
  const phong = (opts) => new THREE.MeshPhongMaterial({ specular: 0x151515, shininess: look.shine, ...opts });
  const backMat = phong({ map: back.t });
  const sideMat = phong({ vertexColors: true, map: edges.t });

  paintSides();
  paintBack();

  // BoxGeometry material order: +x, -x, +y, -y, +z (face), -z (back).
  // Side and face materials are per tile so each can be dimmed or lit alone.
  // Washizu (setWashizu): a glass copy is made of glass; glass = true makes a
  // glass tile without a design (the intro's face-down tiles)
  let washizu = false;
  const glassSide = new THREE.MeshPhongMaterial({
    color: glassLook.body, map: edges.t, transparent: true, opacity: 0.38, depthWrite: false, specular: 0x777777, shininess: glassLook.shine,
  });
  const glassMat = (map) => new THREE.MeshPhongMaterial({ map, transparent: true, depthWrite: false, specular: 0x666666, shininess: glassLook.shine });
  function makeGlass(id) {
    const side = glassSide.clone();
    const front = glassMat(glassTexture(id, false).t);
    const behind = glassMat(glassTexture(id, true).t);
    const mesh = new THREE.Mesh(geo, [side, side, side, side, front, behind]);
    // after the felt's shadows and glows, which it does not hide
    mesh.renderOrder = 3;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.id = id;
    mesh.userData.glass = true;
    mesh.userData.mats = [side, front, behind];
    for (const m of mesh.userData.mats) m.userData.base = m.color.clone();
    return mesh;
  }

  function makeTile(id, glass = washizu && id !== null && isGlass(id)) {
    if (glass) return makeGlass(id);
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
      if (m.userData.base) m.color.copy(m.userData.base).multiplyScalar(tint);
      else m.color.setScalar(tint);
      m.emissive.setHex(glow || 0);
      m.emissiveIntensity = glow ? 0.35 : 0;
    }
  }

  function dispose(mesh) {
    for (const m of mesh.userData.mats || []) m.dispose();
  }

  // Washizu on or off; true when it changed (tiles made before are stale)
  function setWashizu(on) {
    const changed = !!on !== washizu;
    washizu = !!on;
    return changed;
  }

  return { makeTile, style, dispose, setWashizu, faceTexture: (id) => faceTexture(id).t, washizu: () => washizu, glowColor: () => look.glow };
}
