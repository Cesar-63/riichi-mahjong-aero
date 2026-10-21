// The player's own hand in the 3D view: real tile models in an overlay scene
// with an orthographic camera in screen pixels, so the hand always faces the
// player at the bottom of the screen (Tenhou/Tetsuya style) and is sized to
// fit any screen. Tiles stand slightly tilted back so their top edge shows.
import * as THREE from '../../vendor/three/three.module.min.js';
import { H, GAP } from './tiles3d.js';

const TILT = 0.32; // top edge leans towards the player, so it shows

export function createHand3D({ world, kit, onPick }) {
  const { renderer } = world;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
  camera.position.z = 1000;
  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(0.35, 0.9, 1);
  scene.add(ambient, key);

  // dark band behind the hand (Tetsuya setting only)
  const bandCanvas = document.createElement('canvas');
  bandCanvas.width = 512;
  bandCanvas.height = 128;
  const bandTex = new THREE.CanvasTexture(bandCanvas);
  bandTex.colorSpace = THREE.SRGBColorSpace;
  const band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, depthWrite: false }));
  band.position.z = -400;
  scene.add(band);
  (() => {
    const g = bandCanvas.getContext('2d');
    g.shadowColor = 'rgba(50,110,255,.9)';
    g.shadowBlur = 26;
    g.fillStyle = '#0a0f22';
    g.fillRect(28, 26, 456, 76);
    g.shadowBlur = 0;
    g.strokeStyle = '#3a4a7a';
    g.lineWidth = 2;
    g.strokeRect(28, 26, 456, 76);
    bandTex.needsUpdate = true;
  })();

  const tiles = new Map(); // id -> { mesh, target: Vector3, scale }
  let size = 60; // px per tile width
  let legal = new Set();
  let hover = null;
  let last = null;
  let theme = 'aero';

  function fit() {
    const w = renderer.domElement.clientWidth || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    camera.right = w;
    camera.top = h;
    camera.updateProjectionMatrix();
    size = Math.max(18, Math.min(64, (w * 0.92) / 15.8, (h * 0.125) / H));
    document.documentElement.style.setProperty('--hand3d-h', `${Math.round(size * H + 30)}px`);
    if (last) layout(...last);
  }
  window.addEventListener('resize', fit);

  // spawn: optional { id, x, y } screen point (bottom-left origin) a new tile flies in from
  function layout(v, ui, visible = Infinity, spawn = null) {
    last = [v, ui, visible, null];
    const ids = [...v.hand, ...(v.drawn !== null ? [v.drawn] : [])];
    const gap = v.drawn !== null ? size * 0.45 : 0;
    const pitch = size * (1 + GAP * 1.5); // a visible line of air between tiles
    const total = ids.length * pitch - (pitch - size) + gap;
    const x0 = (camera.right - total) / 2 + size / 2;
    const y = 16 + (size * H) / 2;
    const o = v.options;
    const myTurn = o && o.kind === 'turn';
    legal = new Set(myTurn ? (ui.riichiMode ? o.riichi : o.discard) : []);
    const seen = new Set();
    ids.forEach((id, i) => {
      seen.add(id);
      let t = tiles.get(id);
      const target = new THREE.Vector3(x0 + i * pitch + (v.drawn !== null && i === ids.length - 1 ? gap : 0), y, 0);
      if (!t) {
        const mesh = kit.makeTile(id);
        mesh.castShadow = mesh.receiveShadow = false;
        mesh.rotation.x = TILT;
        scene.add(mesh);
        t = { mesh };
        tiles.set(id, t);
        if (spawn && spawn.id === id) {
          mesh.position.set(spawn.x, spawn.y, 0);
          t.scale = size * 0.45;
          t.wait = spawn.wait || 0; // until the previous play has landed
        } else {
          mesh.position.copy(target).add(new THREE.Vector3(0, size * 1.2, 0));
          t.scale = size;
        }
        mesh.scale.setScalar(t.scale);
      }
      t.target = target;
      t.index = i;
      t.mesh.visible = i < visible;
      const glow = id === v.partnerRequest ? 0xff9a1a : 0;
      kit.style(t.mesh, myTurn && !legal.has(id) ? 0.6 : 1, glow);
    });
    for (const [id, t] of tiles) {
      if (!seen.has(id)) {
        scene.remove(t.mesh);
        kit.dispose(t.mesh);
        tiles.delete(id);
      }
    }
    band.scale.set(total + size * 1.6, size * H + size * 0.9, 1);
    // no band while the hand is put away (intro, reveals)
    band.visible = theme === 'tetsuya' && visible > 0;
    band.position.set(camera.right / 2, y, -400);
  }

  // tiles move at a steady speed (no easing), growing to full size as they arrive
  const goal = new THREE.Vector3();
  world.onTick((dt) => {
    const step = size * 78 * dt;
    for (const [id, t] of tiles) {
      if (t.wait > 0) {
        t.wait -= dt * 1000;
        continue;
      }
      const lift = hover === id && legal.has(id) ? size * 0.22 : 0;
      goal.set(t.target.x, t.target.y + lift, 0);
      const left = t.mesh.position.distanceTo(goal);
      if (left <= step) t.mesh.position.copy(goal);
      else t.mesh.position.lerp(goal, step / left);
      t.scale = left <= step ? size : t.scale + (size - t.scale) * Math.min(1, step / left);
      t.mesh.scale.setScalar(t.scale);
    }
  });
  world.addOverlay(scene, camera);

  // ---------------------------------------------------------------- input
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...tiles.values()].filter((t) => t.mesh.visible).map((t) => t.mesh), false)[0];
    return hit ? hit.object.userData.id : null;
  };
  renderer.domElement.addEventListener('pointermove', (ev) => {
    hover = pick(ev);
    renderer.domElement.style.cursor = hover !== null && legal.has(hover) ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => { hover = null; });
  renderer.domElement.addEventListener('click', (ev) => {
    const id = pick(ev);
    if (id !== null && legal.has(id)) onPick(id);
  });

  fit();
  return {
    layout,
    setTheme(name) {
      theme = name;
      band.visible = name === 'tetsuya' && (!last || last[2] > 0);
      ambient.intensity = name === 'tetsuya' ? 0.6 : 0.75;
      key.color.setHex(name === 'tetsuya' ? 0xfff0d8 : 0xffffff);
    },
    // test hook: screen point (top-left origin) of a hand tile
    tileOnScreen(id) {
      const t = tiles.get(id);
      return t ? { x: t.mesh.position.x, y: camera.top - t.mesh.position.y } : null;
    },
  };
}
