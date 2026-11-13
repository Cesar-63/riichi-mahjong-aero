// The climate around the table while somebody is on a streak: the parlour
// gives way to open sky, deep sea or fire, painted on a dome around the
// room, and the light on the table takes its colour. It fades in and out;
// a change of climate fades the old one out first.
import * as THREE from '../../vendor/three/three.module.min.js';

// fog: what the far floor fades into; sky/ground/lamp: the light on the
// table; fill: extra fill light; glow: the colour of the hand's glow
export const CLIMATES = {
  cielo: { id: 0, fog: 0x9fc6ea, sky: 0xdcecff, ground: 0xffe9cf, lamp: 0xfff4e0, fill: 0.55, glow: 0xffe9a0 },
  mar: { id: 1, fog: 0x06324a, sky: 0x7fe0ea, ground: 0x04202e, lamp: 0xbfeaff, fill: 0.4, glow: 0x5fe6ff },
  fuego: { id: 2, fog: 0x2a0903, sky: 0xff8a3a, ground: 0x6a1200, lamp: 0xffc48a, fill: 0.4, glow: 0xff7a1a },
};

const FADE = 1.4; // seconds to come in or go out

const FRAGMENT = `
uniform float time;
uniform float amount;
uniform int kind;
varying vec3 dir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return v;
}
// thin bright veins where the noise crosses its middle
float veins(float n, float sharp) { return pow(1.0 - abs(n * 2.0 - 1.0), sharp); }

// above the clouds: blue overhead, a low sun, a sea of clouds below
vec3 cielo(vec3 d) {
  float h = d.y;
  vec3 c = mix(vec3(0.80, 0.89, 0.98), vec3(0.13, 0.38, 0.80), smoothstep(0.0, 0.75, h));
  vec3 sun = normalize(vec3(-0.45, 0.22, -0.85));
  float s = max(dot(d, sun), 0.0);
  c += vec3(1.0, 0.82, 0.58) * pow(s, 6.0) * 0.55 + vec3(1.0) * pow(s, 300.0) * 2.0;
  vec2 uv = d.xz / (abs(h) + 0.2);
  vec2 drift = vec2(time * 0.035, time * 0.012);
  float n = fbm(uv * 1.1 + drift);
  float shade = fbm(uv * 1.1 + drift + vec2(0.12, 0.08));
  if (h < 0.0) {
    // the cloud floor: thick, with blue gaps down to the haze
    float cover = smoothstep(0.42, 0.68, n);
    vec3 cloud = mix(vec3(0.66, 0.75, 0.90), vec3(0.97, 0.955, 0.93), smoothstep(0.3, 0.75, shade));
    vec3 gap = mix(vec3(0.42, 0.62, 0.90), vec3(0.24, 0.47, 0.84), smoothstep(0.0, -0.9, h));
    c = mix(c, mix(gap, cloud, cover), smoothstep(0.0, -0.12, h));
  } else {
    float wisps = smoothstep(0.55, 0.9, n) * smoothstep(0.03, 0.35, h);
    c = mix(c, vec3(1.0), wisps * 0.7);
  }
  return c;
}

// under the sea: light from above in shafts, caustics crawling over the deep
vec3 mar(vec3 d) {
  float h = d.y;
  vec3 c = mix(vec3(0.02, 0.20, 0.33), vec3(0.10, 0.62, 0.74), smoothstep(-0.2, 0.9, h));
  c = mix(c, vec3(0.00, 0.05, 0.13), smoothstep(-0.05, -0.95, h));
  vec2 uv = d.xz / (abs(h) + 0.25);
  float ca = veins(fbm(uv * 2.2 + vec2(time * 0.06, -time * 0.04)), 7.0);
  float cb = veins(fbm(uv * 3.1 - vec2(time * 0.05, time * 0.03) + 9.0), 7.0);
  float caustic = ca * 0.7 + cb * 0.5;
  // on the surface overhead they are bright; on the deep, a faint net
  c += vec3(0.55, 0.95, 1.0) * caustic * (h > 0.0 ? smoothstep(0.0, 0.7, h) * 0.9 : smoothstep(0.0, -0.5, h) * 0.22);
  float a = atan(d.z, d.x);
  float rays = smoothstep(0.52, 0.85, noise(vec2(a * 5.0 + time * 0.04, 3.0))) * smoothstep(-0.35, 0.6, h);
  c += vec3(0.35, 0.80, 0.85) * rays * 0.28;
  return c;
}

// in the fire: a crust of lava below, flames along the horizon, smoke above
vec3 fuego(vec3 d) {
  float h = d.y;
  vec3 c = mix(vec3(0.42, 0.08, 0.01), vec3(0.03, 0.005, 0.0), smoothstep(0.0, 0.7, h));
  float a = atan(d.z, d.x);
  float flame = fbm(vec2(a * 3.5, h * 5.0 - time * 0.9));
  float tongues = smoothstep(0.35, 0.8, flame) * smoothstep(0.55, 0.0, h);
  c += vec3(1.0, 0.42, 0.04) * tongues * 0.9 + vec3(1.0, 0.85, 0.3) * pow(tongues, 3.0) * 0.6;
  if (h < 0.0) {
    vec2 uv = d.xz / (abs(h) + 0.22);
    float n = fbm(uv * 1.7 + vec2(time * 0.02, time * 0.015));
    float crack = veins(n, 5.0);
    float pulse = 0.85 + 0.15 * sin(time * 1.3 + n * 12.0);
    vec3 lava = mix(vec3(0.06, 0.012, 0.0), vec3(1.0, 0.33, 0.02), crack * pulse);
    lava += vec3(1.0, 0.85, 0.35) * pow(crack, 4.0) * 0.8;
    c = mix(c, lava, smoothstep(0.0, -0.1, h));
  }
  return c;
}

void main() {
  vec3 d = normalize(dir);
  vec3 c = kind == 0 ? cielo(d) : kind == 1 ? mar(d) : fuego(d);
  // the colours above are picked as they should look on screen
  gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), amount);
  #include <colorspace_fragment>
}`;

// lights: the parlour's { lamp, hemi, floor }; fog: the scene's fog. Call
// tick every frame after the lights get their tuned intensities.
export function createClimate({ scene, lights, fog }) {
  const uniforms = { time: { value: 0 }, amount: { value: 0 }, kind: { value: 0 } };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 48, 32),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.renderOrder = -10; // behind every other see-through thing
  dome.visible = false;
  scene.add(dome);

  const base = {
    fog: fog.color.clone(),
    sky: lights.hemi.color.clone(),
    ground: lights.hemi.groundColor.clone(),
    lamp: lights.lamp.color.clone(),
  };
  const to = { fog: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), lamp: new THREE.Color() };
  const floorMat = lights.floor.material;

  let wanted = null; // the climate asked for
  let shown = null; // the one on the dome
  let amount = 0;

  return {
    set(kind) {
      wanted = CLIMATES[kind] ? kind : null;
    },
    tick(dt, t) {
      const goal = wanted && wanted === shown ? 1 : 0;
      if (amount === 0 && wanted !== shown) {
        shown = wanted;
        if (shown) {
          const c = CLIMATES[shown];
          uniforms.kind.value = c.id;
          for (const k of Object.keys(to)) to[k].setHex(c[k]);
        }
      }
      if (amount !== goal) amount = goal > amount ? Math.min(1, amount + dt / FADE) : Math.max(0, amount - dt / FADE);
      const a = amount * amount * (3 - 2 * amount);
      uniforms.time.value = t;
      uniforms.amount.value = a;
      dome.visible = a > 0;
      // the parlour's floor goes with the room
      if (floorMat.transparent !== a > 0) {
        floorMat.transparent = a > 0;
        floorMat.needsUpdate = true;
      }
      floorMat.opacity = 1 - a;
      lights.floor.visible = a < 1;
      fog.color.copy(base.fog);
      lights.hemi.color.copy(base.sky);
      lights.hemi.groundColor.copy(base.ground);
      lights.lamp.color.copy(base.lamp);
      if (a > 0 && shown) {
        fog.color.lerp(to.fog, a);
        lights.hemi.color.lerp(to.sky, a);
        lights.hemi.groundColor.lerp(to.ground, a);
        lights.lamp.color.lerp(to.lamp, a * 0.6);
        lights.hemi.intensity += CLIMATES[shown].fill * a;
      }
    },
  };
}
