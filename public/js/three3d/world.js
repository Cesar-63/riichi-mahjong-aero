// 3D stage for the table: renderer, camera and a Frutiger Aero sky world.
// The table floats in a bright sky over a sea of clouds, with floating grass
// islands and drifting iridescent soap bubbles.
import * as THREE from '../../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../../vendor/three/RoundedBoxGeometry.js';

export const TABLE = 26; // table side in world units (1 unit = one tile width)
const SUN_DIR = new THREE.Vector3(-0.5, 0.55, -0.67).normalize();

export function createWorld(container) {
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

  const sky = makeSky();
  scene.add(sky);
  // Reflections come from the sky itself, so glossy things mirror blue sky and sun.
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.85;

  const animate = [addClouds(scene), addIslands(scene), addBubbles(scene)];
  addTable(scene);
  addLights(scene);

  const clock = new THREE.Clock();
  const tickers = [];
  const tickersEarly = [];
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
    renderer.render(scene, camera);
  });

  return {
    THREE, scene, camera, renderer, onTick: (f) => tickers.push(f), fit, RoundedBoxGeometry,
    setView: (m) => { mode = m; },
    forceView: (m) => { forced = m; },
  };
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
  c.left = -16; c.right = 16; c.top = 16; c.bottom = -16; c.near = 5; c.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);
}
