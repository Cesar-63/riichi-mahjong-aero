// The town: draws what logic.js decides. Everything is unlit, in the manner
// of a PS2 or PSP game: the scene has no lights at all, every static
// surface shows texture × vertex colour (baked once by bake.js when the
// zone is built), neon is full-bright faces plus additive halos, people
// get a blob shadow, and the picture is rendered small and stretched to
// the window. Each zone is a handful of merged meshes (one per texture).
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { createState, restore, snapshot, step, promptFor, fadeAlpha } from './logic.js';
import { buildZone, zoneLights, tintAt, hexToRgb } from './bake.js';
import { texture, spotTexture, neonAtlas } from './textures.js';
import { loadActor } from './actors.js';

const raw = (hex) => new THREE.Color().setRGB(...hexToRgb(hex)); // colours as written, no gamma
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export async function loadMap(url = 'city/map.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar el mapa (${res.status})`);
  return res.json();
}

function geometry({ positions, uvs, colors, indices }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

// A flat quad into the arrays of a mesh being put together: centre c,
// half-sides a and b (vectors), uv rectangle, one colour
function quad(out, c, a, b, [u0, v0, u1, v1], color) {
  const base = out.positions.length / 3;
  for (const [sa, sb, u, v] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
    out.positions.push(c[0] + a[0] * sa + b[0] * sb, c[1] + a[1] * sa + b[1] * sb, c[2] + a[2] * sa + b[2] * sb);
    out.uvs.push(u, v);
    out.colors.push(color[0], color[1], color[2]);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const arrays = () => ({ positions: [], uvs: [], colors: [], indices: [] });

// root: the element of the town's screen (index.html #city). opts: map,
// character or resume (a snapshot), height (internal resolution), onSit
// (table, snapshot) and onExit.
export async function createCity(root, opts) {
  const { map } = opts;
  const stage = root.querySelector('.city-stage');
  const el = {
    zone: root.querySelector('.city-zone'),
    prompt: root.querySelector('.city-prompt'),
    fade: root.querySelector('.city-fade'),
  };
  // text for the neon signs: the page's own font, if it arrives in time
  if (document.fonts) {
    await Promise.race([
      document.fonts.load('700 32px "Zen Kaku Gothic New"', '麻雀'),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => {});
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  // colours go to the screen as computed: texture × vertex colour, nothing else
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  stage.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(); // no lights are ever added to it
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 60);
  let height = opts.height || map.render.height;

  function resize() {
    const aspect = clamp(stage.clientWidth / Math.max(1, stage.clientHeight), 0.5, 2.4);
    const w = Math.round(height * aspect);
    renderer.setSize(w, height, false);
    camera.aspect = w / height;
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- materials
  const materials = new Map();
  const material = (tex) => {
    if (!materials.has(tex)) materials.set(tex, new THREE.MeshBasicMaterial({ map: texture(tex), vertexColors: true }));
    return materials.get(tex);
  };
  const haloMat = new THREE.MeshBasicMaterial({
    map: spotTexture('glow'), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const shadowMat = new THREE.MeshBasicMaterial({ map: spotTexture('shadow'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadowQuad = (out, x, z, r) => quad(out, [x, 0.012, z], [r, 0, 0], [0, 0, -r], [0, 0, 1, 1], [1, 1, 1]);

  // -------------------------------------------------------------- zones
  const zones = {};
  async function build(name) {
    const zone = map.zones[name];
    const group = new THREE.Group();
    const lights = zoneLights(zone);
    for (const [tex, arr] of buildZone(zone)) group.add(new THREE.Mesh(geometry(arr), material(tex)));
    // neon: the signs at full brightness, all on one texture, and their halos
    const halos = arrays();
    const neons = zone.neons || [];
    let atlas = null;
    if (neons.length) {
      atlas = neonAtlas(neons);
      const signs = arrays();
      neons.forEach((n, i) => {
        const [nx, , nz] = n.normal;
        const right = [nz, 0, -nx];
        const [w, h] = n.size;
        quad(signs, n.at, right.map((v) => v * w / 2), [0, h / 2, 0], atlas.rects[i], [1, 1, 1]);
        const g = n.glow ?? 0.6;
        const c = hexToRgb(n.color).map((v) => v * 0.5);
        quad(halos, [n.at[0] + nx * 0.03, n.at[1], n.at[2] + nz * 0.03], right.map((v) => v * (w / 2 + g)), [0, h / 2 + g, 0], [0, 0, 1, 1], c);
      });
      group.add(new THREE.Mesh(geometry(signs), new THREE.MeshBasicMaterial({ map: atlas.texture })));
    }
    // lamps: three crossed quads, so the glow shows from any side
    for (const g of zone.glows || []) {
      const c = hexToRgb(g.color).map((v) => v * 0.6);
      const r = g.size / 2;
      quad(halos, g.at, [r, 0, 0], [0, r, 0], [0, 0, 1, 1], c);
      quad(halos, g.at, [0, 0, r], [0, r, 0], [0, 0, 1, 1], c);
      quad(halos, g.at, [r, 0, 0], [0, 0, r], [0, 0, 1, 1], c);
    }
    if (halos.indices.length) {
      const m = new THREE.Mesh(geometry(halos), haloMat);
      m.renderOrder = 2;
      group.add(m);
    }
    // the people of the zone, each tinted with the light where they sit,
    // and their blob shadows in one mesh
    const blobs = arrays();
    const npcs = await Promise.all((zone.npcs || []).map(async (n, i) => {
      const actor = await loadActor(n.character);
      actor.place(n.x, n.z, n.facing || 0);
      actor.tint(tintAt(zone, n.x, 1, n.z, lights));
      if (n.pose === 'sit') actor.sit(0, i);
      group.add(actor.root);
      shadowQuad(blobs, n.x, n.z, 0.45);
      return { actor, sits: n.pose === 'sit', k: i };
    }));
    if (blobs.indices.length) {
      const m = new THREE.Mesh(geometry(blobs), shadowMat);
      m.renderOrder = 1;
      group.add(m);
    }
    // A zone can bring a model made in Blender, with the light painted on
    // its vertices (COLOR_0); it is drawn unlit like everything else. Its
    // boxes in the map then stay as walls only ("visible": false).
    if (zone.model) {
      const gltf = await new GLTFLoader().loadAsync(zone.model);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const tex = o.material.map;
        if (tex) tex.colorSpace = THREE.NoColorSpace;
        o.material = new THREE.MeshBasicMaterial({ map: tex, vertexColors: !!o.geometry.getAttribute('color') });
      });
      group.add(gltf.scene);
    }
    return { zone, group, lights, npcs, atlas, fog: new THREE.Fog(raw(zone.fog.color), zone.fog.near, zone.fog.far), background: raw(zone.fog.color) };
  }
  for (const name of Object.keys(map.zones)) zones[name] = await build(name);

  // ------------------------------------------------------------- player
  let state = opts.resume ? restore(map, opts.resume) : createState(map, opts.character);
  const player = await loadActor(state.character);
  scene.add(player.root);
  const blob = new THREE.Mesh(geometry((() => { const a = arrays(); shadowQuad(a, 0, 0, 0.42); return a; })()), shadowMat);
  blob.renderOrder = 1;
  scene.add(blob);

  let current = null;
  let camYaw = 0;
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  function enterZone(camFacing) {
    if (current) scene.remove(current.group);
    current = zones[state.zone];
    scene.add(current.group);
    scene.fog = current.fog;
    scene.background = current.background;
    el.zone.textContent = current.zone.name;
    camYaw = camFacing ?? state.facing;
    placeCamera(1);
  }

  // Where the camera stands. A fixed one may turn a little towards the
  // player (track); the street's follows behind, staying inside the zone.
  function placeCamera(k) {
    const cam = current.zone.camera;
    const b = current.zone.bounds;
    if (cam.type === 'follow') {
      const x = clamp(state.x - Math.sin(camYaw) * cam.distance, b.minX + 0.4, b.maxX - 0.4);
      const z = clamp(state.z - Math.cos(camYaw) * cam.distance, b.minZ + 0.4, b.maxZ - 0.4);
      camPos.lerp(new THREE.Vector3(x, cam.height, z), k);
      camTarget.lerp(new THREE.Vector3(state.x, cam.look, state.z), k);
    } else {
      const t = cam.track || 0;
      camPos.set(...cam.position);
      camTarget.lerp(new THREE.Vector3(cam.target[0] + (state.x - cam.target[0]) * t, cam.target[1], cam.target[2] + (state.z - cam.target[2]) * t), k);
    }
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  // -------------------------------------------------------------- input
  const keys = new Set();
  const stick = { on: false, id: null, x0: 0, y0: 0, x: 0, y: 0 };
  let interact = false;
  let running = false;
  const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const onKeyDown = (e) => {
    if (!running || e.target.closest('input, textarea, dialog')) return;
    if (MOVE[e.code]) {
      keys.add(e.code);
      e.preventDefault();
    } else if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) interact = true;
    else if (e.code === 'Escape') opts.onExit();
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  // touch (or mouse): drag anywhere on the picture to walk that way
  const onDown = (e) => {
    if (!running || stick.on) return;
    Object.assign(stick, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
  };
  const onMove = (e) => {
    if (!stick.on || e.pointerId !== stick.id) return;
    const R = 50;
    stick.x = clamp((e.clientX - stick.x0) / R, -1, 1);
    stick.y = clamp((stick.y0 - e.clientY) / R, -1, 1);
  };
  const onUp = (e) => {
    if (e.pointerId === stick.id) Object.assign(stick, { on: false, x: 0, y: 0 });
  };
  const onPrompt = () => { if (running) interact = true; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', resize);
  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  el.prompt.addEventListener('click', onPrompt);

  // --------------------------------------------------------------- loop
  let time = 0;
  let last = 0;
  let raf = 0;
  let promptText = null;
  let steer = null; // debug: a direction on the ground to walk in, whatever the keys say
  function frame(dt) {
    time += dt;
    // which way "forward" is on the ground, as the camera sees it
    let ix = stick.x;
    let iy = stick.y;
    for (const k of keys) {
      ix += MOVE[k][0];
      iy += MOVE[k][1];
    }
    const fx = camTarget.x - camPos.x;
    const fz = camTarget.z - camPos.z;
    const fl = Math.hypot(fx, fz) || 1;
    const input = {
      x: (fx / fl) * iy + (-fz / fl) * ix,
      z: (fz / fl) * iy + (fx / fl) * ix,
      interact,
    };
    if (steer) Object.assign(input, { x: steer[0], z: steer[1] });
    interact = false;
    for (const ev of step(state, map, input, dt)) {
      if (ev.type === 'zone') enterZone(ev.door.cam);
      else if (ev.type === 'sit') {
        stop();
        opts.onSit(ev.table, snapshot(state));
        return;
      }
    }
    // the street's camera swings round behind the player, unless they walk
    // towards it
    if (current.zone.camera.type === 'follow' && state.moving) {
      const ahead = Math.cos(angleDiff(state.facing, camYaw));
      if (ahead > -0.3) camYaw += angleDiff(state.facing, camYaw) * (1 - Math.exp(-dt * 1.6));
    }
    placeCamera(1 - Math.exp(-dt * 8));
    player.place(state.x, state.z, state.facing);
    player.walk(state.moving, dt, time);
    player.tint(tintAt(current.zone, state.x, 1, state.z, current.lights));
    blob.position.set(state.x, 0, state.z);
    for (const n of current.npcs) if (n.sits) n.actor.sit(time, n.k);
    const p = promptFor(state, map);
    const text = p ? p.text : null;
    if (text !== promptText) {
      promptText = text;
      el.prompt.textContent = text || '';
      el.prompt.classList.toggle('show', !!text);
    }
    el.fade.style.opacity = fadeAlpha(state);
    renderer.render(scene, camera);
  }
  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
  }
  function start() {
    if (running) return;
    running = true;
    resize();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    keys.clear();
    Object.assign(stick, { on: false, x: 0, y: 0 });
    interact = false;
  }

  enterZone();
  resize();
  frame(0);

  return {
    start,
    stop,
    get running() { return running; },
    snapshot: () => snapshot(state),
    // back in town where a snapshot says (after a game of mahjong)
    resumeAt(snap) {
      state = restore(map, snap || snapshot(state));
      enterZone();
      start();
    },
    // the internal resolution: lines of the picture before it is stretched
    setHeight(h) {
      height = h;
      resize();
      if (!running) frame(0);
    },
    // for the capture script and for checking the cost of a zone
    debug: {
      frame,
      state: () => state,
      steer(dir) { steer = dir; },
      info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lights: scene.children.filter((o) => o.isLight).length, size: renderer.getSize(new THREE.Vector2()).toArray() }),
    },
    dispose() {
      stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', resize);
      stage.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.prompt.removeEventListener('click', onPrompt);
      for (const z of Object.values(zones)) {
        z.group.traverse((o) => o.geometry && o.geometry.dispose());
        z.npcs.forEach((n) => n.actor.dispose());
        if (z.atlas) z.atlas.texture.dispose();
      }
      player.dispose();
      blob.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
