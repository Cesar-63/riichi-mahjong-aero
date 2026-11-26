// The town: draws what logic.js decides. Everything is unlit, in the manner
// of a PS2 or PSP game: the scene has no lights at all, every static
// surface shows texture × vertex colour (baked once by bake.js when the
// zone is built: sun, shadows and lamps), signs are painted boards, a bare
// bulb gets an additive halo, people get a blob shadow, and the picture is rendered small and stretched to
// the window. Each zone is a handful of merged meshes (one per texture).
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { createState, restore, snapshot, step, promptFor, fadeAlpha } from './logic.js';
import { buildZone, bakeAt, tintAt, hexToRgb } from './bake.js';
import { texture, spotTexture, signAtlas } from './textures.js';
import { loadActor } from './actors.js';
import { introAt, captionText, INTRO_FADE } from './intro.js';
import { CHARACTERS } from '../shared/characters.js';
import { createCat, followCat, createChatter, tickChatter, sayFor } from './cat.js';
import { createCatModel } from './catmodel.js';
import { meow, unlockAudio } from './meow.js';

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
// half-sides a and b (vectors), one colour, and the uv of its corners
// (bottom left, bottom right, top right, top left; the whole texture if none)
const WHOLE = [[0, 0], [1, 0], [1, 1], [0, 1]];
function quad(out, c, a, b, color, uv = WHOLE) {
  const base = out.positions.length / 3;
  for (const [sa, sb, [u, v]] of [[-1, -1, uv[0]], [1, -1, uv[1]], [1, 1, uv[2]], [-1, 1, uv[3]]]) {
    out.positions.push(c[0] + a[0] * sa + b[0] * sb, c[1] + a[1] * sa + b[1] * sb, c[2] + a[2] * sa + b[2] * sb);
    out.uvs.push(u, v);
    out.colors.push(color[0], color[1], color[2]);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const arrays = () => ({ positions: [], uvs: [], colors: [], indices: [] });

// root: the element of the town's screen (index.html #city). opts: map,
// character or resume (a snapshot), height (internal resolution), intro
// (play the opening scene of map.intro first), sound (the cat may meow
// out loud), onSit (table, snapshot) and onExit.
export async function createCity(root, opts) {
  const { map } = opts;
  const stage = root.querySelector('.city-stage');
  const el = {
    zone: root.querySelector('.city-zone'),
    prompt: root.querySelector('.city-prompt'),
    fade: root.querySelector('.city-fade'),
    intro: root.querySelector('.city-intro'),
    caption: root.querySelector('.city-caption'),
    skip: root.querySelector('.city-skip'),
    bubble: root.querySelector('.city-bubble'),
  };
  // lettering for the signs: the page's own brush font, if it arrives in time
  if (document.fonts) {
    await Promise.race([
      document.fonts.load('800 32px "Shippori Mincho B1"', '麻雀'),
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
  const shadowQuad = (out, x, z, r) => quad(out, [x, 0.012, z], [r, 0, 0], [0, 0, -r], [1, 1, 1]);

  // -------------------------------------------------------------- zones
  const zones = {};
  async function build(name) {
    const zone = map.zones[name];
    const group = new THREE.Group();
    for (const [tex, arr] of buildZone(zone)) group.add(new THREE.Mesh(geometry(arr), material(tex)));
    // the signs: painted boards, all on one texture, lit by the bake like
    // the wall they hang on
    const halos = arrays();
    const signs = zone.signs || [];
    let atlas = null;
    if (signs.length) {
      atlas = signAtlas(signs);
      const boards = arrays();
      signs.forEach((n, i) => {
        const [nx, , nz] = n.normal;
        const right = [nz, 0, -nx];
        const [w, h] = n.size;
        const at = [n.at[0] + nx * 0.01, n.at[1], n.at[2] + nz * 0.01];
        quad(boards, at, right.map((v) => v * w / 2), [0, h / 2, 0], bakeAt(zone, at, n.normal), atlas.rects[i]);
      });
      group.add(new THREE.Mesh(geometry(boards), new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true })));
    }
    // bare bulbs: three crossed quads, so the glow shows from any side
    for (const g of zone.glows || []) {
      const c = hexToRgb(g.color).map((v) => v * 0.6);
      const r = g.size / 2;
      quad(halos, g.at, [r, 0, 0], [0, r, 0], c);
      quad(halos, g.at, [0, 0, r], [0, r, 0], c);
      quad(halos, g.at, [r, 0, 0], [0, 0, r], c);
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
      actor.tint(tintAt(zone, n.x, 1, n.z));
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
    // the sky of an outdoor zone: a tall wall all around, deep blue above
    // and hazy at the horizon, that goes wherever the camera goes
    let sky = null;
    if (zone.sky) {
      const top = hexToRgb(zone.sky.top);
      const low = hexToRgb(zone.sky.horizon);
      const a = arrays();
      const R = 40;
      const N = 8;
      for (let i = 0; i <= N; i++) {
        const ang = (i / N) * Math.PI * 2;
        for (const [y, c] of [[-4, low], [3, low], [30, top]]) {
          a.positions.push(Math.cos(ang) * R, y, Math.sin(ang) * R);
          a.uvs.push(0, 0);
          a.colors.push(c[0], c[1], c[2]);
        }
        if (i < N) for (const k of [0, 1]) a.indices.push(i * 3 + k, i * 3 + k + 1, i * 3 + k + 4, i * 3 + k, i * 3 + k + 4, i * 3 + k + 3);
      }
      sky = new THREE.Mesh(geometry(a), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
      sky.renderOrder = -1;
      sky.frustumCulled = false;
      group.add(sky);
    }
    return { zone, group, npcs, atlas, sky, fog: new THREE.Fog(raw(zone.fog.color), zone.fog.near, zone.fog.far), background: raw(zone.sky ? zone.sky.top : zone.fog.color) };
  }
  for (const name of Object.keys(map.zones)) zones[name] = await build(name);

  // ------------------------------------------------------------- player
  let state = opts.resume ? restore(map, opts.resume) : createState(map, opts.character);
  const player = await loadActor(state.character);
  scene.add(player.root);
  const blob = new THREE.Mesh(geometry((() => { const a = arrays(); shadowQuad(a, 0, 0, 0.42); return a; })()), shadowMat);
  blob.renderOrder = 1;
  scene.add(blob);

  // the cat: it keeps the player company and talks about kan
  const cat = map.cat ? createCat(map, state) : null;
  const catModel = cat ? createCatModel() : null;
  const chatter = cat ? createChatter(map.cat) : null;
  let saying = 0; // seconds left of the cat's speech bubble
  let catBlob = null;
  if (cat) {
    scene.add(catModel.root);
    catBlob = new THREE.Mesh(geometry((() => { const a = arrays(); shadowQuad(a, 0, 0, 0.3); return a; })()), shadowMat);
    catBlob.renderOrder = 1;
    scene.add(catBlob);
  }
  // draws the cat where it is, if it is in the zone on screen
  function drawCat(dt, moving) {
    if (!cat) return;
    const here = zones[cat.zone] === current;
    catModel.root.visible = here;
    catBlob.visible = here;
    if (!here) return;
    catModel.place(cat.x, 0, cat.z, cat.facing);
    catModel.pose(moving, cat.idle > 0.6, dt, time);
    catModel.tint(tintAt(current.zone, cat.x, 0.4, cat.z));
    catBlob.position.set(cat.x, 0, cat.z);
  }
  // the speech bubble, over the cat's head on the picture
  const head = new THREE.Vector3();
  function placeBubble(dt) {
    if (!el.bubble) return;
    saying = Math.max(0, saying - dt);
    const show = saying > 0 && cat && zones[cat.zone] === current && !intro;
    el.bubble.classList.toggle('show', show);
    if (!show) return;
    head.set(cat.x, 0.72, cat.z).project(camera);
    const canvas = renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const k = Math.min(r.width / canvas.width, r.height / canvas.height); // object-fit: contain
    const w = canvas.width * k;
    const h = canvas.height * k;
    const sr = root.getBoundingClientRect();
    const x = r.left - sr.left + (r.width - w) / 2 + ((head.x + 1) / 2) * w;
    const y = r.top - sr.top + (r.height - h) / 2 + ((1 - head.y) / 2) * h;
    const behind = head.z > 1;
    el.bubble.style.visibility = behind ? 'hidden' : '';
    const half = el.bubble.offsetWidth / 2;
    el.bubble.style.left = `${clamp(x, half + 8, sr.width - half - 8)}px`;
    el.bubble.style.top = `${clamp(y, el.bubble.offsetHeight + 8, sr.height)}px`;
    el.bubble.style.setProperty('--tail', `${clamp(x - clamp(x, half + 8, sr.width - half - 8), -half + 16, half - 16)}px`);
  }
  function catSays(text) {
    if (!el.bubble) return;
    el.bubble.querySelector('p').textContent = text;
    saying = sayFor(text);
    catModel.speak();
    if (opts.sound !== false) meow();
  }

  let current = null;
  let camYaw = 0;
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  function showZone(name) {
    if (current === zones[name]) return;
    if (current) scene.remove(current.group);
    current = zones[name];
    scene.add(current.group);
    scene.fog = current.fog;
    scene.background = current.background;
    el.zone.textContent = current.zone.name;
  }
  function enterZone(camFacing) {
    showZone(state.zone);
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
  const SKIP = ['Escape', 'Enter', 'Space', 'KeyE'];
  const onKeyDown = (e) => {
    if (!running || e.target.closest('input, textarea, dialog')) return;
    if (opts.sound !== false) unlockAudio();
    if (intro) {
      // the opening scene: these keys skip it, the rest do nothing
      if (SKIP.includes(e.code) && !e.repeat) {
        e.preventDefault();
        endIntro();
      }
      return;
    }
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
    if (opts.sound !== false) unlockAudio();
    if (intro && running) return endIntro();
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
  const onSkip = () => { if (intro) endIntro(); };
  el.skip?.addEventListener('click', onSkip);

  // --------------------------------------------------------------- loop
  let time = 0;
  let last = 0;
  let raf = 0;
  let promptText = null;
  let steer = null; // debug: a direction on the ground to walk in, whatever the keys say

  // ------------------------------------------------------ opening scene
  // While it plays nobody walks: the camera follows the shots of
  // map.intro, and the player shows only in the zone where they start.
  let intro = opts.intro && map.intro?.shots?.length ? { t: 0 } : null;
  let unfade = 0; // after skipping: seconds left of the fade back in
  const cast = CHARACTERS.find((c) => c.id === state.character);
  let captionShot = -1;
  function showIntro(on) {
    root.classList.toggle('intro', on);
    el.intro?.classList.toggle('hidden', !on);
  }
  function endIntro() {
    if (!intro) return;
    intro = null;
    showIntro(false);
    enterZone();
    unfade = INTRO_FADE;
  }
  function introFrame(dt) {
    intro.t += dt;
    const at = introAt(map.intro, map, intro.t);
    if (!at) {
      intro = null;
      showIntro(false);
      enterZone();
      return false;
    }
    showZone(at.shot.zone);
    const c = at.camera;
    camPos.set(...c.position);
    camTarget.set(...c.target);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    if (camera.fov !== c.fov) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
    const here = at.shot.zone === state.zone;
    player.root.visible = here;
    blob.visible = here;
    if (here) {
      // the shot may move them: getting up from the bed, a few steps
      const p = at.player || { x: state.x, z: state.z, facing: state.facing, rise: null, moving: false };
      player.place(p.x, p.z, p.facing);
      if (p.rise !== null) player.perch(p.rise, at.shot.player.seat, time);
      else player.walk(p.moving, dt, time);
      player.tint(tintAt(current.zone, p.x, 1.2, p.z));
      blob.position.set(p.x, 0, p.z);
    }
    if (current.sky) current.sky.position.set(camPos.x, 0, camPos.z);
    for (const n of current.npcs) if (n.sits) n.actor.sit(time, n.k);
    if (cat) cat.idle += dt;
    drawCat(dt, false);
    if (el.caption) {
      if (captionShot !== at.index) {
        captionShot = at.index;
        el.caption.querySelector('.es').textContent = captionText(at.shot.text, cast);
        el.caption.querySelector('.jp').textContent = captionText(at.shot.sub, cast);
      }
      el.caption.style.opacity = at.caption;
    }
    el.fade.style.opacity = at.dark;
    renderer.render(scene, camera);
    return true;
  }

  function frame(dt) {
    time += dt;
    if (intro && introFrame(dt)) return;
    player.root.visible = true;
    blob.visible = true;
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
    player.tint(tintAt(current.zone, state.x, 1.2, state.z));
    if (current.sky) current.sky.position.set(camPos.x, 0, camPos.z);
    blob.position.set(state.x, 0, state.z);
    if (cat) {
      followCat(cat, state, map, dt);
      drawCat(dt, cat.moving);
      // every so often it has something to say (not while the screen is dark)
      if (!state.fade && cat.zone === state.zone) {
        const line = tickChatter(chatter, map.cat, dt);
        if (line) catSays(line);
      }
    }
    placeBubble(dt);
    for (const n of current.npcs) if (n.sits) n.actor.sit(time, n.k);
    const p = promptFor(state, map);
    const text = p ? p.text : null;
    if (text !== promptText) {
      promptText = text;
      el.prompt.textContent = text || '';
      el.prompt.classList.toggle('show', !!text);
    }
    unfade = Math.max(0, unfade - dt);
    el.fade.style.opacity = Math.max(fadeAlpha(state), unfade / INTRO_FADE);
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
  showIntro(!!intro);
  resize();
  frame(0);

  return {
    start,
    stop,
    get running() { return running; },
    snapshot: () => snapshot(state),
    // back in town where a snapshot says (after a game of mahjong)
    resumeAt(snap) {
      if (intro) {
        intro = null;
        showIntro(false);
      }
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
      cat: () => cat && { ...cat },
      catSays: (text) => cat && catSays(text || map.cat.lines[Math.floor(Math.random() * map.cat.lines.length)]),
      intro: () => intro && { ...intro },
      skipIntro: endIntro,
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
      el.skip?.removeEventListener('click', onSkip);
      showIntro(false);
      for (const z of Object.values(zones)) {
        z.group.traverse((o) => o.geometry && o.geometry.dispose());
        z.npcs.forEach((n) => n.actor.dispose());
        if (z.atlas) z.atlas.texture.dispose();
      }
      player.dispose();
      blob.geometry.dispose();
      if (cat) {
        catModel.dispose();
        catBlob.geometry.dispose();
      }
      el.bubble?.classList.remove('show');
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
