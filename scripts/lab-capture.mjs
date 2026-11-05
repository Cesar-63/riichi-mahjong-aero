// Records scenes of the animation lab (public/lab.html) as videos, frame by
// frame on the lab's virtual clock, so every take is the same whatever the
// machine. Besides the game's own look ('color') it records guides for
// video-to-video AI models: 'arcilla' (clay: shapes, light and shadows, no
// textures) and 'profundidad' (depth). Needs Playwright with Chromium, and
// ffmpeg. See docs/animaciones-ia.md.
//
// Usage: npm run lab:capture -- [options]
//   --escena riichi-ron       scene id (--lista shows them and the cameras)
//   --camara "Mesa completa"  a camera preset of the lab ("Juego": the game's own)
//   --pasadas color,arcilla,profundidad
//   --fps 30  --ancho 1280  --alto 720
//   --sin-mano                without the player's hand facing the screen
//   --rivales                 the rivals sitting at the table (characters.js)
//   --sin-avisos              without the big calls (¡Riichi!, ¡Ron!…); the
//                             guides never have them
//   --desde 0 --hasta <ms>    a part of the scene
//   --salida capturas         folder for the videos (and --cuadros to keep the PNGs)
//   --episodio ep01-riichi    an episode (public/lab/episodios/), at its own
//                             size (vertical, 1080×1920) unless --ancho/--alto
//                             or --escala 0.5 say otherwise; --desde/--hasta
//                             are then episode time
import http from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };

// ---------------------------------------------------------------- options
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const o = {
  scene: opt('escena', 'riichi-ron'),
  camera: opt('camara', 'Juego'),
  passes: opt('pasadas', 'color').split(',').map((s) => s.trim()).filter(Boolean),
  fps: Number(opt('fps', 30)),
  width: Number(opt('ancho', 1280)),
  height: Number(opt('alto', 720)),
  hand: !flag('sin-mano'),
  people: flag('rivales'),
  callouts: !flag('sin-avisos'),
  from: Number(opt('desde', 0)),
  to: opt('hasta', null),
  out: resolve(opt('salida', 'capturas')),
  frames: flag('cuadros'),
  episode: opt('episodio', null),
};
// an episode sets its own size (and the camera, the people and the rest)
let epInfo = null;
if (o.episode) {
  epInfo = JSON.parse(await readFile(join(fileURLToPath(new URL('..', import.meta.url)), 'public/lab/episodios', `${o.episode}.json`), 'utf8'));
  const k = Number(opt('escala', 1));
  if (!args.includes('--ancho')) o.width = Math.round((epInfo.ancho || 1080) * k);
  if (!args.includes('--alto')) o.height = Math.round((epInfo.alto || 1920) * k);
  o.passes = ['color'];
}
for (const p of o.passes) {
  if (!['color', 'arcilla', 'profundidad'].includes(p)) throw new Error(`pasada desconocida: ${p} (color, arcilla o profundidad)`);
}

// ------------------------------------------------------- a static server
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(root, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------- recording
// count frames: draw, take, move on (forward runs in the page with ms)
async function record(page, name, count, forward, ms) {
  const dir = join(o.out, `${name}-cuadros`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    // one frame applies the step and draws it (the stage fills the page)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.png`) });
    await page.evaluate(forward, ms);
    if (i % o.fps === 0) process.stdout.write(`\r${name}: ${i}/${count} cuadros`);
  }
  const file = join(o.out, `${name}.mp4`);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(o.fps), '-i', join(dir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', file], { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error('ffmpeg falló (¿está instalado?)');
  if (!o.frames) await rm(dir, { recursive: true, force: true });
  console.log(`\r${name}: ${count} cuadros → ${file}`);
}

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('error en la página:', e.message));
  await page.goto(`${base}/lab.html?captura`);
  await page.waitForFunction(() => window.labCapture);

  if (flag('lista')) {
    const scenes = await page.evaluate(() => window.labCapture.scenes());
    console.log('Escenas:');
    for (const s of scenes) console.log(`  ${s.id.padEnd(12)} ${s.name} (${(s.length / 1000).toFixed(1)} s)`);
    console.log('Cámaras:');
    for (const c of await page.evaluate(() => window.labCapture.cameras())) console.log(`  ${c}`);
  } else if (o.episode) {
    await mkdir(o.out, { recursive: true });
    const { duracion } = await page.evaluate((id) => window.labCapture.loadEpisode(id), o.episode);
    const end = Math.min(duracion, o.to === null ? duracion : Number(o.to));
    const step = 1000 / o.fps;
    if (o.from > 0) await page.evaluate((ms) => window.labCapture.advance(ms), o.from);
    await record(page, o.episode, Math.max(1, Math.round((end - o.from) / step)), (ms) => window.labCapture.advance(ms), step);
  } else {
    await mkdir(o.out, { recursive: true });
    const cam = o.camera.replace(/[^\p{L}\d]+/gu, '-').toLowerCase();
    for (const pass of o.passes) {
      const length = await page.evaluate((x) => window.labCapture.load(x), { scene: o.scene, camera: o.camera, hand: o.hand, people: o.people, callouts: o.callouts, pass });
      const end = Math.min(length, o.to === null ? length : Number(o.to));
      const step = 1000 / o.fps;
      // straight to the part asked for, then one step per frame
      await page.evaluate((ms) => { window.labClock.step += ms; }, o.from);
      await record(page, `${o.scene}-${cam}-${pass}`, Math.max(1, Math.round((end - o.from) / step)), (ms) => { window.labClock.step += ms; }, step);
    }
  }
} finally {
  await browser.close();
  server.close();
}
