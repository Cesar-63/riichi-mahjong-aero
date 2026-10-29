// Animation lab: plays fixed scenes (lab/scenarios.json, built with
// scripts/lab-scenarios.mjs) on the real 3D table, on the page's virtual
// clock (lab.html), with a free camera and the animation settings of
// three3d/tuning.js changing live.
import { createTable3D } from './three3d/table3d.js';
import { showCallouts } from './render.js';
import { TUNING, TUNING_INFO, TUNING_DEFAULTS } from './three3d/tuning.js';

const $ = (s) => document.querySelector(s);
const clock = window.labClock;
const stage = $('#lab-stage');
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

// ------------------------------------------------------------- playback
let scenes = [];
let scene = null;
let table = null;
let abort = null;
let ui = null;
let t0 = 0;
let next = 0;
let lastView = null;
let seeking = false;
let pass = 'color';

// a fresh table for every run, so each run starts from nothing
function start() {
  if (table) {
    abort.abort();
    table.destroy();
  }
  abort = new AbortController();
  table = createTable3D(stage, { signal: abort.signal, onPick: () => {} });
  table.setCallouts([...stage.querySelectorAll('.callout')]);
  table.showHand($('#lab-hand').checked);
  table.setPass(pass);
  // calls already made before the scene starts are not shouted
  const first = scene.steps[0].view;
  ui = { lastEvent: Math.max(0, ...first.events.map((e) => e.id)) };
  t0 = clock.t;
  next = 0;
  lastView = null;
  applyCamera();
}

const elapsed = () => clock.t - t0;

// jump to a moment: replay from the start, fast
function seek(ms) {
  start();
  clock.ff = Math.max(0, ms);
  seeking = true;
}

function frame() {
  if (scene && table) {
    const e = elapsed();
    while (next < scene.steps.length && scene.steps[next].at <= e) {
      const v = scene.steps[next].view;
      table.update(v, ui);
      showCallouts(stage, v, ui);
      lastView = v;
      next++;
    }
    if (seeking && clock.ff <= 0) seeking = false;
    if (!seeking && !clock.paused && e >= scene.length && $('#lab-loop').checked) start();
    $('#lab-time').textContent = `${Math.round(Math.min(e, scene.length))} ms`;
    $('#lab-ff').classList.toggle('hidden', !seeking);
    if (document.activeElement !== $('#lab-seek')) $('#lab-seek').value = String(Math.min(e, scene.length));
  }
  requestAnimationFrame(frame);
}

function chooseScene(id) {
  scene = scenes.find((s) => s.id === id) || scenes[0];
  store.set('lab.scene', scene.id);
  $('#lab-scene').value = scene.id;
  $('#lab-note').textContent = scene.note;
  $('#lab-seek').max = String(scene.length);
  $('#lab-marks').innerHTML = scene.steps.map((s) => `<i style="left:${(s.at / scene.length) * 100}%"></i>`).join('');
  start();
}

function setPaused(p) {
  clock.paused = p;
  $('#lab-play').textContent = p ? '▶ Seguir' : '⏸ Pausa';
}

$('#lab-scene').addEventListener('change', (e) => chooseScene(e.target.value));
$('#lab-restart').addEventListener('click', () => start());
$('#lab-play').addEventListener('click', () => setPaused(!clock.paused));
$('#lab-step').addEventListener('click', () => {
  setPaused(true);
  clock.step += 1000 / 60;
});
$('#lab-speed').addEventListener('change', (e) => { clock.speed = Number(e.target.value); });
$('#lab-seek').addEventListener('change', (e) => seek(Number(e.target.value)));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ') {
    e.preventDefault();
    setPaused(!clock.paused);
  } else if (e.key === 'ArrowRight') {
    setPaused(true);
    clock.step += 1000 / 60;
  } else if (e.key === 'r' || e.key === 'R') start();
});

$('#lab-drawer').addEventListener('click', () => {
  if (!table || !lastView) return;
  if (table.pointsOpen()) return table.closePoints();
  // optionally another score for my seat, to check how the sticks lie
  const score = $('#lab-score').value;
  const v = score === '' ? lastView : { ...lastView, players: lastView.players.map((p, i) => (i === lastView.seat ? { ...p, score: Number(score) } : p)) };
  table.openPoints(v);
});

// --------------------------------------------------------------- camera
// The free camera orbits a target point: yaw (round the table), pitch (up)
// and distance. "Juego" gives the camera back to the game's own views.
// Positions are world units, the player sits at +z.
const PRESETS = [
  ['Juego', null],
  ['Mesa completa', [0, 33, 31], [0, -2.5, 1.8]],
  ['Desde arriba', [0, 46, 0.01], [0, 0, 0]],
  ['Jugador', [0, 16.7, 27.7], [0, -0.7, -1.4]],
  ['Tu mano de cerca', [0, 6, 21], [0, 0.5, 12]],
  ['Centro de cerca', [0, 13, 11], [0, 0, 0]],
  ['Rival derecha', [24, 9, 0], [12, 0.5, 0]],
  ['Rival enfrente', [0, 9, -24], [0, 0.5, -12]],
  ['Rival izquierda', [-24, 9, 0], [-12, 0.5, 0]],
  ['Tus llamadas (esquina)', [13, 7, 24], [10, 0.5, 13.5]],
  ['Llamadas del rival derecho', [5, 11, -3], [13.5, 0.3, -11]],
];
let cam = null; // { target: [x, y, z], yaw, pitch, dist }
function orbitFrom(pos, target) {
  const d = pos.map((p, i) => p - target[i]);
  const dist = Math.hypot(...d);
  return { target: [...target], yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(d[1] / dist), dist };
}
function camPos(c) {
  const cp = Math.cos(c.pitch);
  return [c.target[0] + Math.sin(c.yaw) * cp * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * cp * c.dist];
}
const xyz = ([x, y, z]) => ({ x, y, z });
const fmt = (a) => `[${a.map((n) => Math.round(n * 100) / 100).join(', ')}]`;
function applyCamera() {
  if (!table) return;
  if (!cam) {
    table.lockView(null);
    $('#lab-cam').textContent = 'Cámara del juego';
    return;
  }
  const pos = camPos(cam);
  table.lockView({ pos: xyz(pos), target: xyz(cam.target) });
  $('#lab-cam').textContent = `posición ${fmt(pos)} · mira a ${fmt(cam.target)}`;
}
for (const [name, pos, target] of PRESETS) {
  const b = document.createElement('button');
  b.className = 'paper';
  b.type = 'button';
  b.textContent = name;
  b.addEventListener('click', () => {
    cam = pos ? orbitFrom(pos, target) : null;
    applyCamera();
  });
  $('#lab-presets').append(b);
}
$('#lab-hand').addEventListener('change', (e) => table && table.showHand(e.target.checked));
$('#lab-copycam').addEventListener('click', () => copy(cam ? `posición ${fmt(camPos(cam))}, mira a ${fmt(cam.target)}` : 'cámara del juego'));

let drag = null;
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  const orbit = e.button === 2;
  const pan = e.button === 1 || (e.button === 0 && e.shiftKey);
  if (!orbit && !pan) return;
  e.preventDefault();
  if (!cam) cam = orbitFrom(PRESETS[3][1], PRESETS[3][2]);
  drag = { x: e.clientX, y: e.clientY, pan };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.pan) {
    // move the target across the screen's plane, faster when far
    const s = cam.dist * 0.0016;
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const fwd = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];
    cam.target = cam.target.map((t, i) => t - right[i] * dx * s + fwd[i] * dy * s);
  } else {
    cam.yaw -= dx * 0.006;
    cam.pitch = Math.max(0.05, Math.min(1.55, cam.pitch + dy * 0.006));
  }
  applyCamera();
});
stage.addEventListener('pointerup', () => { drag = null; });
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!cam) cam = orbitFrom(PRESETS[3][1], PRESETS[3][2]);
  cam.dist = Math.max(2, Math.min(90, cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
  applyCamera();
}, { passive: false });

// ------------------------------------------------------------- settings
function changes() {
  const out = {};
  for (const [g, vals] of Object.entries(TUNING)) {
    for (const [k, v] of Object.entries(vals)) {
      if (v !== TUNING_DEFAULTS[g][k]) (out[g] ||= {})[k] = v;
    }
  }
  return out;
}
function showChanges() {
  const c = changes();
  $('#lab-out').value = Object.keys(c).length ? JSON.stringify(c, null, 2) : '';
  store.set('lab.tuning', JSON.stringify(c));
  for (const row of document.querySelectorAll('.lab-param')) {
    row.classList.toggle('changed', TUNING[row.dataset.g][row.dataset.k] !== TUNING_DEFAULTS[row.dataset.g][row.dataset.k]);
  }
}
function copy(text) {
  try {
    navigator.clipboard.writeText(text).catch(() => {});
  } catch { /* no clipboard: the text is shown anyway */ }
}

function buildParams() {
  const box = $('#lab-params');
  for (const [g, info] of Object.entries(TUNING_INFO)) {
    const h = document.createElement('h3');
    h.textContent = info._;
    box.append(h);
    for (const [k, [label, min, max, step]] of Object.entries(info)) {
      if (k === '_') continue;
      const row = document.createElement('div');
      row.className = 'lab-param';
      row.dataset.g = g;
      row.dataset.k = k;
      row.innerHTML = `<label for="p-${g}-${k}">${label}</label><input type="range" id="p-${g}-${k}" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
      const [range, num] = row.querySelectorAll('input');
      const set = (val, from) => {
        const n = Number(val);
        if (!Number.isFinite(n)) return;
        TUNING[g][k] = n;
        if (from !== range) range.value = String(n);
        if (from !== num) num.value = String(n);
        showChanges();
      };
      range.addEventListener('input', () => set(range.value, range));
      num.addEventListener('change', () => set(num.value, num));
      row.set = set;
      set(TUNING[g][k]);
      box.append(row);
    }
  }
}
$('#lab-reset').addEventListener('click', () => {
  for (const row of document.querySelectorAll('.lab-param')) row.set(TUNING_DEFAULTS[row.dataset.g][row.dataset.k]);
});
$('#lab-copy').addEventListener('click', () => {
  showChanges();
  copy($('#lab-out').value || '(sin cambios)');
  $('#lab-out').select();
});

// settings changed in an earlier visit come back
try {
  const saved = JSON.parse(store.get('lab.tuning') || '{}');
  for (const [g, vals] of Object.entries(saved)) for (const [k, v] of Object.entries(vals)) if (TUNING[g] && k in TUNING[g]) TUNING[g][k] = v;
} catch { /* nothing saved */ }
buildParams();

// ---------------------------------------------------------------- start
const res = await fetch('lab/scenarios.json');
scenes = (await res.json()).scenes;
$('#lab-scene').innerHTML = scenes.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
// Video capture (lab.html?captura, driven by scripts/lab-capture.mjs): the
// stage alone, and a scene played from its start with the clock paused, so
// the script steps it frame by frame and takes each one.
if (new URLSearchParams(location.search).has('captura')) {
  document.body.classList.add('capture');
  $('#lab-loop').checked = false;
  window.labCapture = {
    scenes: () => scenes.map((s) => ({ id: s.id, name: s.name, length: s.length })),
    cameras: () => PRESETS.map(([name]) => name),
    // { scene, camera (a preset's name or { pos, target }), hand, callouts, pass }
    load(o) {
      setPaused(true);
      const preset = PRESETS.find(([name]) => name === o.camera);
      if (o.camera && typeof o.camera === 'object') cam = orbitFrom(o.camera.pos, o.camera.target);
      else if (preset) cam = preset[1] ? orbitFrom(preset[1], preset[2]) : null;
      else if (o.camera) throw new Error(`no hay cámara "${o.camera}"`);
      $('#lab-hand').checked = o.hand !== false;
      pass = o.pass || 'color';
      // the guides go without the calls: they are added later from the color take
      document.body.classList.toggle('no-callouts', o.callouts === false || pass !== 'color');
      if (!scenes.some((s) => s.id === o.scene)) throw new Error(`no hay escena "${o.scene}"`);
      chooseScene(o.scene);
      return scene.length;
    },
  };
}

chooseScene(store.get('lab.scene'));
requestAnimationFrame(frame);
