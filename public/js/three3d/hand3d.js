// The player's own hand in the 3D view: real tile models in an overlay scene
// with an orthographic camera in screen pixels, so the hand always faces the
// player at the bottom of the screen (Tenhou/Tetsuya style) and is sized to
// fit any screen. Tiles stand slightly tilted back so their top edge shows.
import * as THREE from '../../vendor/three/three.module.min.js';
import { H, GAP } from './tiles3d.js';
import { TUNING } from './tuning.js';

const TILT = 0.32; // top edge leans towards the player, so it shows

export function createHand3D({ world, kit, onPick }) {
  const { renderer } = world;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
  camera.position.z = 1000;
  // the same warm, low lamp light as the table
  const ambient = new THREE.AmbientLight(0xffecd4, TUNING.light.handAmbient);
  const key = new THREE.DirectionalLight(0xffdcb0, TUNING.light.handKey);
  key.position.set(0.35, 0.9, 1);
  scene.add(ambient, key);

  // dark band behind the hand, standing on the bottom edge of the screen
  // (the texture's rim and glow go round the top and the sides only)
  const BAND_TOP = 26 / 128; // part of the texture above the band itself
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
    g.fillRect(28, 26, 456, 128);
    g.shadowBlur = 0;
    g.strokeStyle = '#3a4a7a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(28, 128);
    g.lineTo(28, 26);
    g.lineTo(484, 26);
    g.lineTo(484, 128);
    g.stroke();
    bandTex.needsUpdate = true;
  })();

  const tiles = new Map(); // id -> { mesh, target: Vector3, scale }
  let size = 60; // px per tile width
  let legal = new Set();
  let hover = null;
  // Discarding takes two clicks by default, as in most mahjong games: the
  // first one picks the tile up, a second one on it discards it (a click on
  // another tile picks that one instead). With oneClick a single click
  // discards the tile under the cursor.
  let oneClick = false;
  let selected = null;
  let last = null;
  let lastDrawn = null; // drawn tile of the previous layout
  // The hand can be rearranged by dragging tiles. With autoSort (the
  // default) a dropped tile first lands where it was let go and then goes
  // back to its sorted place; without it the arrangement stays. order holds
  // that arrangement (or the drop being shown), [] for plain sorted order.
  let autoSort = true;
  let order = [];
  let settle = null; // timer that sorts a dropped tile back
  let drag = null; // { id, sx, sy, moved, x, y } while a tile is held

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
  window.addEventListener('resize', fit, { signal: world.signal });

  // The row of the hand, left to right, and the drawn tile when it sits
  // apart in its own slot. Tiles placed by the player keep their place; any
  // other tile joins at the right end (in sorted order).
  function rowOf(v) {
    const all = new Set([...v.hand, ...(v.drawn !== null ? [v.drawn] : [])]);
    const row = order.filter((id) => all.has(id));
    const apart = v.drawn !== null && !row.includes(v.drawn) ? v.drawn : null;
    for (const id of v.hand) if (!row.includes(id)) row.push(id);
    return { row, apart };
  }
  // screen geometry of the row: first tile centre, spacing, height
  function geometry(v) {
    const gap = size * 0.45;
    const pitch = size * (1 + GAP * 1.5); // a visible line of air between tiles
    // the hand is laid out as if it always held a drawn tile, so the slot for
    // the draw stays free and the hand does not shift on every draw
    const total = (v.hand.length + 1) * pitch - (pitch - size) + gap;
    return { gap, pitch, total, x0: (camera.right - total) / 2 + size / 2, y: 16 + (size * H) / 2 };
  }

  // spawn: optional { id, x, y } screen point (bottom-left origin) a new tile flies in from
  let handKey = '';
  function layout(v, ui, visible = Infinity, spawn = null) {
    last = [v, ui, visible, null];
    // a new hand starts sorted
    const key = `${v.round}-${v.kyokuNum}-${v.honba}`;
    if (key !== handKey) {
      handKey = key;
      order = [];
    }
    const { row, apart } = rowOf(v);
    const ids = apart !== null ? [...row, apart] : row;
    const { gap, pitch, total, x0, y } = geometry(v);
    const o = v.options;
    const myTurn = o && o.kind === 'turn';
    legal = new Set(myTurn ? (ui.riichiMode ? o.riichi : o.discard) : []);
    if (!legal.has(selected)) selected = null;
    // tedashi: the tile just drawn now belongs inside the hand
    const slotted = lastDrawn !== null && v.drawn === null && v.hand.includes(lastDrawn) ? lastDrawn : null;
    lastDrawn = v.drawn;
    const seen = new Set();
    ids.forEach((id, i) => {
      seen.add(id);
      let t = tiles.get(id);
      const target = new THREE.Vector3(x0 + i * pitch + (apart !== null && i === ids.length - 1 ? gap : 0), y, 0);
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
          t.fast = true; // a draw flies in at draw speed
        } else {
          mesh.position.copy(target).add(new THREE.Vector3(0, size * 1.2, 0));
          t.scale = size;
        }
        mesh.scale.setScalar(t.scale);
      }
      t.target = target;
      // Tetsuya style: it rises, passes over the tiles in between and drops
      // into its place while they make room (no hop when it simply ends last)
      if ((id === slotted && i < ids.length - 1) || (t.index !== undefined && t.resort && t.index !== i)) t.hop = { up: size * H * 1.05 };
      t.resort = false;
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
    // its top edge stays where it was, level with the tops of the tiles
    const bandH = (y + (size * H + size * 0.9) * (0.5 - BAND_TOP)) / (1 - BAND_TOP);
    band.scale.set(total + size * 1.6, bandH, 1);
    // no band while the hand is put away (intro, reveals)
    band.visible = visible > 0;
    band.position.set(camera.right / 2, bandH / 2, -400);
  }

  // tiles move at a steady speed (no easing), growing to full size as they arrive
  const goal = new THREE.Vector3();
  world.onTick((dt) => {
    ambient.intensity = TUNING.light.handAmbient;
    key.intensity = TUNING.light.handKey;
    for (const [id, t] of tiles) {
      if (drag && drag.moved && drag.id === id) {
        // held: it follows the pointer, a little larger, above the others
        t.mesh.position.set(drag.x, drag.y, 50);
        t.mesh.scale.setScalar(size * 1.08);
        continue;
      }
      if (t.wait > 0) {
        t.wait -= dt * 1000;
        continue;
      }
      // a fresh draw flies twice as fast as the hand rearranging
      const step = size * (t.fast ? TUNING.hand.drawSpeed : TUNING.hand.moveSpeed) * dt;
      const lift = selected === id ? size * TUNING.hand.selectLift : hover === id && !drag && legal.has(id) ? size * (oneClick ? 0.22 : 0.1) : 0;
      goal.set(t.target.x, t.target.y + lift, 0);
      if (t.hop) {
        // up, across above the hand, then straight down
        const p = t.mesh.position;
        const top = t.target.y + t.hop.up;
        if (Math.abs(p.x - t.target.x) > 0.5) goal.set(p.y < top - 0.5 ? p.x : t.target.x, top, 0);
        else t.hop = null;
      }
      const left = t.mesh.position.distanceTo(goal);
      if (left <= step) t.fast = false;
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
  // pointer position in the overlay's coordinates (origin bottom-left),
  // kept on the screen
  const toOverlay = (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const half = size / 2;
    return {
      x: Math.max(half, Math.min(camera.right - half, ev.clientX - rect.left)),
      y: Math.max(half * H, Math.min(camera.top - half * H, camera.top - (ev.clientY - rect.top))),
    };
  };
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (drag) {
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 6) {
        drag.moved = true;
        selected = null;
        renderer.domElement.style.cursor = 'grabbing';
      }
      if (drag.moved) Object.assign(drag, toOverlay(ev));
      return;
    }
    hover = pick(ev);
    renderer.domElement.style.cursor = hover !== null && legal.has(hover) ? 'pointer' : hover !== null ? 'grab' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => { hover = null; });
  // Press: the second click of a two-click discard goes at once (the
  // discard starts as the button goes down); otherwise the tile may be
  // picked up and dragged.
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const id = pick(ev);
    if (id === null) {
      selected = null;
      return;
    }
    if (!oneClick && selected === id && legal.has(id)) {
      selected = null;
      onPick(id);
      return;
    }
    if (!oneClick) selected = legal.has(id) ? id : null;
    drag = { id, sx: ev.clientX, sy: ev.clientY, moved: false, ...toOverlay(ev) };
    renderer.domElement.setPointerCapture(ev.pointerId);
  });
  const release = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    hover = null;
    renderer.domElement.style.cursor = '';
    if (!d.moved) {
      // a plain click
      if (oneClick && legal.has(d.id)) onPick(d.id);
      return;
    }
    const v = last && last[0];
    if (!v || !tiles.has(d.id)) return;
    const { pitch, x0, y } = geometry(v);
    // let go well above the hand, over the table: discard it
    if (ev && d.y > y + size * H * 1.15 && legal.has(d.id)) {
      onPick(d.id);
      return;
    }
    // otherwise it slots into the row where it was let go
    const { row } = rowOf(v);
    const rest = row.filter((id) => id !== d.id);
    const at = Math.max(0, Math.min(rest.length, Math.round((d.x - x0) / pitch)));
    rest.splice(at, 0, d.id);
    order = rest;
    clearTimeout(settle);
    layout(...last);
    if (autoSort) {
      // shown there for a moment, then back to its sorted place
      settle = setTimeout(() => {
        order = [];
        const t = tiles.get(d.id);
        if (t) t.resort = true;
        if (last) layout(...last);
      }, 320);
    }
  };
  renderer.domElement.addEventListener('pointerup', release);
  renderer.domElement.addEventListener('pointercancel', () => release(null));

  fit();
  return {
    layout,
    setOneClick(on) {
      oneClick = !!on;
      selected = null;
    },
    // auto sort on: back to sorted order; off: the current order stays
    setAutoSort(on) {
      autoSort = !!on;
      clearTimeout(settle);
      if (last) order = autoSort ? [] : rowOf(last[0]).row;
      if (last) layout(...last);
    },
    dragging: () => !!(drag && drag.moved),
    // test hook: screen point (top-left origin) of a hand tile
    tileOnScreen(id) {
      const t = tiles.get(id);
      return t ? { x: t.mesh.position.x, y: camera.top - t.mesh.position.y } : null;
    },
  };
}
