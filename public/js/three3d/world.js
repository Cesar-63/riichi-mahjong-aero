// 3D stage for the table: renderer, camera and two interchangeable settings:
// 'aero' (Frutiger Aero: the table floats in a bright sky over a sea of
// clouds, with grass islands and iridescent soap bubbles) and 'tetsuya'
// (a dim mahjong parlour like the Tetsuya games: wooden table with green
// felt under a warm lamp, chairs in the dark).
import * as THREE from '../../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../../vendor/three/RoundedBoxGeometry.js';

export const TABLE = 26; // table side in world units (1 unit = one tile width)
const SUN_DIR = new THREE.Vector3(-0.5, 0.55, -0.67).normalize();

export function createWorld(container, initialTheme = 'aero') {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1400);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const built = {};
  let current = null;
  let animate = [];
  const themeListeners = [];
  function setTheme(name) {
    const theme = THEMES[name] ? name : 'aero';
    if (current === theme) return;
    if (current) scene.remove(built[current].group);
    if (!built[theme]) built[theme] = THEMES[theme](pmrem);
    const b = built[theme];
    scene.add(b.group);
    scene.environment = b.env;
    scene.environmentIntensity = b.envIntensity;
    scene.background = b.background || null;
    scene.fog = b.fog || null;
    renderer.toneMappingExposure = b.exposure;
    animate = b.animate;
    current = theme;
    for (const f of themeListeners) f(theme);
  }
  setTheme(initialTheme);

  const clock = new THREE.Clock();
  const tickers = [];
  const tickersEarly = [];
  const overlays = [];
  renderer.autoClear = false;
  // Two camera views: 'player' (low, close to the player's side, Tetsuya
  // style) and 'overview' (the whole table). Portrait screens always use the
  // overview, since the low view would cut the table's width.
  const views = { player: null, overview: null };
  let mode = 'player';
  let forced = null;
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
    const dist = portrait ? Math.max(36, 15.5 / Math.tan(halfH) * 0.92) : 36;
    views.overview = {
      pos: new THREE.Vector3(0, dist * (portrait ? 0.88 : 0.78), dist * (portrait ? 0.55 : 0.72)),
      target: new THREE.Vector3(0, -2.2, portrait ? 1.2 : 1.6),
    };
    views.player = portrait ? views.overview : {
      pos: new THREE.Vector3(0, 14.5, 24),
      target: new THREE.Vector3(0, -0.6, -2.8),
    };
    camera.updateProjectionMatrix();
    if (!snapped) {
      snapped = true;
      const v = views[forced || mode];
      camera.position.copy(v.pos);
      look.copy(v.target);
      camera.lookAt(look);
    }
  };
  tickersEarly.push((dt) => {
    const v = views[forced || mode];
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(v.pos, k);
    look.lerp(v.target, k);
    camera.lookAt(look);
  });
  window.addEventListener('resize', fit);
  fit();

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (!still) for (const f of animate) f(dt, t);
    for (const f of tickersEarly) f(dt, t);
    for (const f of tickers) f(dt, t);
    renderer.clear();
    renderer.render(scene, camera);
    // overlays (the player's hand) are drawn on top with their own depth
    for (const [s2, c2] of overlays) {
      renderer.clearDepth();
      renderer.render(s2, c2);
    }
  });

  return {
    THREE, scene, camera, renderer, onTick: (f) => tickers.push(f), fit, RoundedBoxGeometry,
    setView: (m) => { mode = m; },
    forceView: (m) => { forced = m; },
    setTheme,
    addOverlay: (s2, c2) => overlays.push([s2, c2]),
    onTheme: (f) => { themeListeners.push(f); f(current); },
  };
}

const THEMES = {
  aero(pmrem) {
    const group = new THREE.Group();
    const sky = makeSky();
    group.add(sky);
    // Reflections come from the sky itself, so glossy things mirror blue sky and sun.
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const animate = [addClouds(group), addIslands(group), addBubbles(group)];
    addTable(group);
    addLights(group);
    return { group, animate, env: pmrem.fromScene(envScene, 0.02).texture, envIntensity: 0.85, exposure: 0.95 };
  },
  tetsuya(pmrem) {
    const group = new THREE.Group();
    // dim room reflections: dark walls with one warm lamp overhead
    const envScene = new THREE.Scene();
    envScene.add(gradientDome([0x050403, 0x16110c, 0x2a2118], new THREE.Vector3(0, 1, 0), 0xfff0d0, 0.9));
    addParlour(group);
    return {
      group,
      animate: [],
      env: pmrem.fromScene(envScene, 0.02).texture,
      envIntensity: 0.6,
      exposure: 1.05,
      background: new THREE.Color(0x080706),
      fog: new THREE.Fog(0x080706, 60, 140),
    };
  },
};

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
  grad.addColorStop(0, '#3f6a3a');
  grad.addColorStop(0.45, '#5b8a52');
  grad.addColorStop(1, '#4f7c47');
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

function addParlour(group) {
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE, 0.8, TABLE),
    new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95, envMapIntensity: 0.3 }),
  );
  felt.position.y = -0.4;
  felt.receiveShadow = true;
  group.add(felt);
  // wooden frame: four mitred-looking rails a little above the felt
  const railTex = woodTexture('#9a7448', '#5a3a1c', '#c49a64');
  railTex.repeat.set(2, 1);
  const wood = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.5, envMapIntensity: 0.6 });
  const darkTex = woodTexture('#43301e', '#1e140a', '#6a4c2e');
  darkTex.repeat.set(2, 1);
  const darkWood = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.65 });
  const R = 1.3;
  for (let i = 0; i < 4; i++) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(TABLE + 2 * R, 1.3, R), wood);
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
    chair.position.set(Math.sin(a) * (TABLE / 2 + 7), -3, Math.cos(a) * (TABLE / 2 + 7));
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

  group.add(new THREE.HemisphereLight(0xffe9c8, 0x0d0a08, 0.35));
  group.add(new THREE.AmbientLight(0xffffff, 0.12));
  const lamp = new THREE.SpotLight(0xfff1d6, 900, 90, Math.PI / 4.2, 0.55, 1.6);
  lamp.position.set(0, 34, 4);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.00025;
  lamp.shadow.normalBias = 0;
  lamp.shadow.camera.near = 12;
  lamp.shadow.camera.far = 60;
  group.add(lamp, lamp.target);
}

function makeSky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x0a6fd8) },
        mid: { value: new THREE.Color(0x46b8ff) },
        horizon: { value: new THREE.Color(0xeafcff) },
        below: { value: new THREE.Color(0x8fdcff) },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0
            ? mix(mix(horizon, mid, smoothstep(0.0, 0.3, h)), zenith, smoothstep(0.3, 0.95, h))
            : mix(horizon, below, smoothstep(0.0, -0.6, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0, 0.97, 0.88) * (pow(s, 900.0) * 3.0 + pow(s, 30.0) * 0.5 + pow(s, 5.0) * 0.15);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

// Soft puffy cloud texture drawn once on a canvas.
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const puffs = [[70, 78, 46], [120, 60, 58], [175, 76, 44], [100, 88, 40], [150, 92, 42], [205, 90, 30], [45, 92, 28]];
  for (const [x, y, r] of puffs) {
    const grad = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.65, 'rgba(250,253,255,.9)');
    grad.addColorStop(1, 'rgba(230,246,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addClouds(scene) {
  const mat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false });
  const clouds = [];
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(mat);
    const ang = Math.random() * Math.PI * 2;
    const rad = 16 + Math.pow(Math.random(), 0.7) * 160;
    s.position.set(Math.cos(ang) * rad, -16 - Math.random() * 26 + (rad > 110 ? 14 : 0), Math.sin(ang) * rad - 20);
    const size = 22 + Math.random() * 38;
    s.scale.set(size, size / 2, 1);
    s.userData.v = 0.6 + Math.random() * 1.2;
    clouds.push(s);
    scene.add(s);
  }
  return (dt) => {
    for (const s of clouds) {
      s.position.x += s.userData.v * dt;
      if (s.position.x > 190) s.position.x = -190;
    }
  };
}

function addIslands(scene) {
  const grass = new THREE.MeshStandardMaterial({ color: 0x6fd94f, roughness: 0.6 });
  const earth = new THREE.MeshStandardMaterial({ color: 0xf0d29c, roughness: 0.85, emissive: 0x6a4a20, emissiveIntensity: 0.25 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3fbf45, roughness: 0.5 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0xa27a4a, roughness: 0.8 });
  const make = (r) => {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), grass);
    top.scale.y = 0.28;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(r * 0.98, r * 1.25, 40), earth);
    rock.rotation.x = Math.PI;
    rock.position.y = -r * 0.62;
    g.add(top, rock);
    for (let i = 0; i < Math.round(r / 2.2); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.6;
      const h = 1.2 + Math.random() * 1.6;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h, 8), trunk);
      t.position.set(Math.cos(a) * d, r * 0.2 + h / 2, Math.sin(a) * d);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.8, 16, 12), leaf);
      f.position.set(t.position.x, t.position.y + h / 2 + 0.6, t.position.z);
      g.add(t, f);
    }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return g;
  };
  // beside the table (seen at the sides of wide screens) and further up/back (top corners)
  const spots = [[-31, -7, -2, 5], [32, -8, 6, 6], [-29, -11, 15, 4], [-50, 1, -40, 8], [52, 3, -44, 9]];
  const islands = spots.map(([x, y, z, r]) => {
    const g = make(r);
    g.position.set(x, y, z);
    g.userData.y = y;
    g.userData.phase = Math.random() * 6;
    scene.add(g);
    return g;
  });
  return (dt, t) => {
    for (const g of islands) g.position.y = g.userData.y + Math.sin(t * 0.5 + g.userData.phase) * 0.6;
  };
}

// Soap bubbles: transparent centre, iridescent fresnel rim and a sun glint.
function addBubbles(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, sunDir: { value: SUN_DIR } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vWN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float time; uniform vec3 sunDir; varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main() {
        float f = 1.0 - abs(dot(vN, vV));
        float rim = pow(f, 2.4);
        vec3 film = 0.55 + 0.45 * cos(6.2831 * (f * 1.6 + vec3(0.0, 0.33, 0.67)) + time * 0.4);
        float glint = pow(max(dot(vWN, sunDir), 0.0), 120.0) * 2.2;
        vec3 col = mix(vec3(0.9, 0.97, 1.0), film, 0.65) * (rim * 0.9 + 0.04) + glint;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const geo = new THREE.SphereGeometry(1, 40, 20);
  const list = [];
  const spawn = (b, initial) => {
    // never between the camera and the table
    let x;
    let z;
    do {
      const ang = Math.random() * Math.PI * 2;
      const rad = 17 + Math.random() * 40;
      x = Math.cos(ang) * rad;
      z = Math.sin(ang) * rad - 6;
    } while (z > 4 && Math.abs(x) < 26);
    b.position.set(x, initial ? -20 + Math.random() * 45 : -22, z);
    b.scale.setScalar(0.5 + Math.random() * 2.3);
    b.userData.v = 1 + Math.random() * 2;
    b.userData.phase = Math.random() * 10;
  };
  for (let i = 0; i < 40; i++) {
    const b = new THREE.Mesh(geo, mat);
    b.renderOrder = 3;
    spawn(b, true);
    scene.add(b);
    list.push(b);
  }
  return (dt, t) => {
    mat.uniforms.time.value = t;
    for (const b of list) {
      b.position.y += b.userData.v * dt;
      b.position.x += Math.sin(t * 0.6 + b.userData.phase) * dt * 0.7;
      if (b.position.y > 28) spawn(b, false);
    }
  };
}

function addTable(scene) {
  const top = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE, 0.8, TABLE, 6, 0.6),
    new THREE.MeshPhysicalMaterial({
      color: 0x0c9f95, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12,
      sheen: 0.35, sheenColor: new THREE.Color(0x8ff7ff), envMapIntensity: 0.55,
    }),
  );
  top.position.y = -0.4;
  top.receiveShadow = true;
  scene.add(top);
  const rim = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE + 1.6, 1.1, TABLE + 1.6, 6, 0.55),
    new THREE.MeshPhysicalMaterial({ color: 0xf4fbff, roughness: 0.15, clearcoat: 1, envMapIntensity: 1.2 }),
  );
  rim.position.y = -0.75;
  rim.receiveShadow = true;
  scene.add(rim);
  // translucent glass base, the table floats on it above the clouds
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 4, 3, 64, 1),
    new THREE.MeshPhysicalMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.5, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.5 }),
  );
  base.position.y = -2.8;
  scene.add(base);
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xe6f8ff, 0x7fcfff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-9, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -15; c.right = 15; c.top = 15; c.bottom = -15; c.near = 10; c.far = 50;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0;
  scene.add(sun);
}
