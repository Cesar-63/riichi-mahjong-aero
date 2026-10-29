// 3D stage for the table: renderer, camera and the setting, a dim mahjong
// parlour like the Tetsuya games (wooden table with green felt under a warm
// lamp, chairs in the dark).
import * as THREE from '../../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../../vendor/three/RoundedBoxGeometry.js';
import { TUNING } from './tuning.js';

export const TABLE = 30; // table side in world units (1 unit = one tile width)

// signal: an AbortSignal that removes the window listeners (the lab makes
// a fresh table for every run)
export function createWorld(container, { signal } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1400);

  // the parlour; its reflections come from dark walls with one warm lamp overhead
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(gradientDome([0x050403, 0x16110c, 0x2a2118], new THREE.Vector3(0, 1, 0), 0xfff0d0, 0.9));
  const lights = addParlour(scene);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.background = new THREE.Color(0x080706);
  scene.fog = new THREE.Fog(0x080706, 60, 140);
  // a parlour lit by one weak lamp, kept on the dim side (tuning.js; read
  // every frame so the lab can change it live)
  const applyLight = () => {
    const L = TUNING.light;
    renderer.toneMappingExposure = L.exposure;
    scene.environmentIntensity = L.environment;
    lights.lamp.intensity = L.lamp;
    lights.hemi.intensity = L.hemi;
    lights.ambient.intensity = L.ambient;
  };
  applyLight();

  const clock = new THREE.Clock();
  const tickers = [];
  const tickersEarly = [];
  const overlays = [];
  let overlaysOn = true;
  renderer.autoClear = false;
  // Camera views: 'player' (low, close to the player's side, Tetsuya style),
  // 'overview' (the whole table) and 'drawer' (looking down at the point
  // stick drawer at the player's edge). Portrait screens use the overview
  // instead of the player view, since the low view would cut the table's
  // width. A forced view can also be a free { pos, target } (the result
  // screen framing a winning hand).
  const views = { player: null, overview: null, drawer: null };
  let mode = 'player';
  let forced = null;
  let locked = null; // the lab's free camera, over everything else
  const current = () => locked || (forced && typeof forced === 'object' ? forced : views[forced || mode]);
  // listeners hear the name of the view in use ('free' for a { pos, target })
  const viewListeners = [];
  let announced = null;
  const announce = () => {
    const name = forced ? (typeof forced === 'object' ? 'free' : forced) : mode;
    if (name === announced) return;
    announced = name;
    for (const f of viewListeners) f(name);
  };
  const look = new THREE.Vector3();
  let snapped = false;
  const fit = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = camera.aspect < 1.05;
    // distance that fits the table's width (plus rim) in the horizontal field of view
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    // the views were framed for a 26-wide table: they step back to match
    const k = TABLE / 26;
    const dist = (portrait ? Math.max(36, 15.5 / Math.tan(halfH) * 0.92) : 36) * k;
    views.overview = {
      pos: new THREE.Vector3(0, dist * (portrait ? 0.88 : 0.78), dist * (portrait ? 0.55 : 0.72)),
      target: new THREE.Vector3(0, -2.2 * k, (portrait ? 1.2 : 1.6) * k),
    };
    // aimed nearer than the scaled view, so the player's own wall (further
    // out on the larger table) shows above the hand and the calls against
    // the player's edge show in the right-hand corner; close enough that
    // the felt runs on behind the hand, so it never floats over the floor
    views.player = portrait ? views.overview : {
      pos: new THREE.Vector3(0, 13 * k + 3.5, 21 * k + 3.8),
      target: new THREE.Vector3(0, -0.6 * k, -2.8 * k + 5.4),
    };
    // the drawer comes out of the player's edge of the table
    views.drawer = {
      pos: new THREE.Vector3(0, portrait ? 13 : 9.5, (portrait ? 23 : 21.5) + (TABLE - 26) / 2),
      target: new THREE.Vector3(0, -1.1, 15.3 + (TABLE - 26) / 2),
    };
    camera.updateProjectionMatrix();
    if (!snapped) {
      snapped = true;
      const v = current();
      camera.position.copy(v.pos);
      look.copy(v.target);
      camera.lookAt(look);
    }
  };
  tickersEarly.push((dt) => {
    const v = current();
    const k = locked ? 1 : 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(v.pos, k);
    look.lerp(v.target, k);
    camera.lookAt(look);
  });
  window.addEventListener('resize', fit, { signal });
  fit();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    applyLight();
    for (const f of tickersEarly) f(dt, t);
    for (const f of tickers) f(dt, t);
    renderer.clear();
    draw(scene, camera, false);
    // overlays (the player's hand) are drawn on top with their own depth
    for (const [s2, c2] of overlaysOn ? overlays : []) {
      renderer.clearDepth();
      draw(s2, c2, true);
    }
  });

  // Render passes for the lab's video capture, as guides for video-to-video
  // models: 'color' (the game as it is), 'arcilla' (every surface in one
  // matte clay, no textures: shapes, light and shadows only) and
  // 'profundidad' (white near the camera, black far). Transparent things
  // (contact shadows, labels, the band behind the hand) are left out of the
  // guides, and the overlay hand counts as the nearest thing on screen.
  let pass = 'color';
  const clay = new THREE.MeshStandardMaterial({ color: 0xb4ada2, roughness: 0.92 });
  const depth = new THREE.ShaderMaterial({
    uniforms: { near: { value: 1 }, far: { value: 100 } },
    vertexShader: 'varying float vz; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vz = -p.z; gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform float near; uniform float far; varying float vz; void main() { float d = 1.0 - smoothstep(near, far, vz); gl_FragColor = vec4(vec3(d), 1.0); }',
  });
  const nearest = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.Color(0x000000);
  const grey = new THREE.Color(0x3a3834);
  function draw(s, c, overlay) {
    if (pass === 'color') return renderer.render(s, c);
    const mat = pass === 'arcilla' ? clay : overlay ? nearest : depth;
    if (mat === depth) {
      // the depth range follows the camera: from a bit before what it looks at to well past it
      const d = c.position.distanceTo(look);
      depth.uniforms.near.value = Math.max(0.5, d * 0.6);
      depth.uniforms.far.value = d * 1.45;
    }
    const swapped = [];
    s.traverse((o) => {
      if (!o.material || !o.visible) return;
      swapped.push([o, o.material]);
      if ([o.material].flat().some((m) => m.transparent)) o.visible = false;
      else o.material = mat;
    });
    const keep = [s.background, s.fog];
    if (!overlay) {
      s.background = pass === 'arcilla' ? grey : black;
      s.fog = null;
    }
    renderer.render(s, c);
    [s.background, s.fog] = keep;
    for (const [o, m] of swapped) {
      o.material = m;
      o.visible = true;
    }
  }

  return {
    THREE, scene, camera, renderer, onTick: (f) => tickers.push(f), fit, RoundedBoxGeometry, signal,
    setView: (m) => { mode = m; announce(); },
    forceView: (m) => { forced = m; announce(); },
    onView: (f) => { viewListeners.push(f); f(announced || mode); },
    addOverlay: (s2, c2) => overlays.push([s2, c2]),
    // lab: a { pos, target } that overrides every view (null: back to normal)
    lockView: (v) => { locked = v; },
    // lab: hide the overlays (the player's hand facing the screen)
    showOverlays: (on) => { overlaysOn = on; },
    // lab: 'color', 'arcilla' or 'profundidad' (see draw above)
    setPass: (p) => { pass = p; },
    destroy() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

// Simple vertical gradient sphere (bottom, middle, top) with an optional glow.
function gradientDome([bottom, mid, top], glowDir, glowColor, glow) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        cb: { value: new THREE.Color(bottom) },
        cm: { value: new THREE.Color(mid) },
        ct: { value: new THREE.Color(top) },
        gd: { value: glowDir.clone().normalize() },
        gc: { value: new THREE.Color(glowColor) },
        gi: { value: glow },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 cb; uniform vec3 cm; uniform vec3 ct; uniform vec3 gd; uniform vec3 gc; uniform float gi;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h < 0.0 ? mix(cm, cb, -h) : mix(cm, ct, h);
          c += gc * pow(max(dot(normalize(vDir), gd), 0.0), 12.0) * gi;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

// Green felt with a darker worn centre and some fibre noise.
function feltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 30, 256, 256, 360);
  grad.addColorStop(0, '#33573a');
  grad.addColorStop(0.45, '#46704a');
  grad.addColorStop(1, '#3d6342');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Wood with long grain lines, darker streaks and a few knots.
function woodTexture(base, dark, light) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 90; i++) {
    const y0 = Math.random() * 256;
    const amp = 2 + Math.random() * 6;
    const freq = 0.004 + Math.random() * 0.01;
    const ph = Math.random() * 10;
    g.strokeStyle = Math.random() < 0.6 ? dark : light;
    g.globalAlpha = 0.08 + Math.random() * 0.22;
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const x = 120 + Math.random() * 780;
    const y = 40 + Math.random() * 176;
    for (let r = 18; r > 2; r -= 3) {
      g.globalAlpha = 0.12;
      g.strokeStyle = dark;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(x, y, r * 2.2, r * 0.7, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// One side of a picture-frame style border: a trapezoid (inner edge `inner`
// long, outer edge 2 * width longer) extruded to `height`, centred on its
// own origin, with the outside along +z and a small rounded edge. The wood
// grain runs along the rail, so it changes direction at every mitre.
function mitredRail(inner, width, height) {
  const a = inner / 2;
  const b = inner / 2 + width;
  const shape = new THREE.Shape([
    new THREE.Vector2(-a, -width / 2),
    new THREE.Vector2(a, -width / 2),
    new THREE.Vector2(b, width / 2),
    new THREE.Vector2(-b, width / 2),
  ]);
  const bevel = 0.07;
  const L = 2 * b;
  // u along the rail, v across it (top) or up its sides
  const uvs = {
    generateTopUV(geo, v, ia, ib, ic) {
      return [ia, ib, ic].map((i) => new THREE.Vector2(v[i * 3] / L + 0.5, v[i * 3 + 1] / width + 0.5));
    },
    generateSideWallUV(geo, v, ia, ib, ic, id) {
      return [ia, ib, ic, id].map((i) => new THREE.Vector2(
        (v[i * 3] + v[i * 3 + 1]) / L + 0.5,
        v[i * 3 + 2] / height,
      ));
    },
  };
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    UVGenerator: uvs,
  });
  // shape y -> world z, extrusion -> height, centred like the old box
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height / 2 - bevel, 0);
  return geo;
}

function addParlour(group) {
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE, 0.8, TABLE),
    new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95, envMapIntensity: 0.3 }),
  );
  felt.position.y = -0.4;
  felt.receiveShadow = true;
  group.add(felt);
  // wooden frame: four rails a little above the felt, cut at 45 degrees so
  // they meet in a diagonal (mitre) joint at every corner; plain unvarnished
  // wood weathered to a dark grey, as on Tetsuya's tables
  const railTex = woodTexture('#57534c', '#383530', '#6c675f');
  railTex.repeat.set(2, 1);
  const wood = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.92, envMapIntensity: 0.08 });
  const darkTex = woodTexture('#3b3834', '#1d1b18', '#57534c');
  darkTex.repeat.set(2, 1);
  const darkWood = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.9, envMapIntensity: 0.1 });
  const R = 1.3;
  const railGeo = mitredRail(TABLE, R, 1.3);
  for (let i = 0; i < 4; i++) {
    const rail = new THREE.Mesh(railGeo, wood);
    const a = (i * Math.PI) / 2;
    rail.position.set(Math.sin(a) * (TABLE / 2 + R / 2), 0.05, Math.cos(a) * (TABLE / 2 + R / 2));
    rail.rotation.y = a;
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE + 2 * R, 2.4, TABLE + 2 * R), darkWood);
  apron.position.y = -1.8;
  group.add(apron);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 18, 1.6), darkWood);
    leg.position.set(x * (TABLE / 2 - 0.5), -11, z * (TABLE / 2 - 0.5));
    group.add(leg);
  }
  // chairs around the table, only their backs catch the lamp light
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const chair = new THREE.Group();
    for (let k = -1.5; k <= 1.5; k++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.6), chairMat);
      slat.position.set(k * 2.3, 2, 0);
      chair.add(slat);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(9.5, 1.1, 0.8), chairMat);
    rail.position.y = 8.2;
    chair.add(rail);
    const a = (i * Math.PI) / 2;
    chair.position.set(Math.sin(a) * (TABLE / 2 + 8), -3, Math.cos(a) * (TABLE / 2 + 8));
    chair.rotation.y = a;
    if (i === 0) chair.visible = false; // the player's own chair would block the view
    group.add(chair);
  }
  // floor and a far wall to swallow the light
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x1a140f, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -20;
  floor.receiveShadow = true;
  group.add(floor);

  // one warm, weak lamp over the table, fading out softly towards the edges
  // intensities come from tuning.js (see applyLight)
  const hemi = new THREE.HemisphereLight(0xffdcb0, 0x0a0806, 0);
  const ambient = new THREE.AmbientLight(0xffe6c8, 0);
  group.add(hemi, ambient);
  const lamp = new THREE.SpotLight(0xffd9a6, 0, 90, Math.PI / 4.2, 0.75, 1.6);
  lamp.position.set(0, 34, 4);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.00025;
  lamp.shadow.normalBias = 0;
  lamp.shadow.camera.near = 12;
  lamp.shadow.camera.far = 60;
  group.add(lamp, lamp.target);
  return { lamp, hemi, ambient };
}
