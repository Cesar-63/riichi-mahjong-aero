// Renders the portrait of every character (public/img/personajes/<id>.png,
// for the picker in the lobby) from its model. Needs Playwright with
// Chromium. Usage: node scripts/personajes/retratos.mjs
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from '../../public/js/shared/characters.js';

const root = join(fileURLToPath(new URL('../..', import.meta.url)), 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const PAGE = `<!doctype html><body style="margin:0"><script type="module">
import * as THREE from './vendor/three/three.module.min.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(192, 224);
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader();
window.portrait = async (id) => {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfff0dc, 2.1));
  const key = new THREE.DirectionalLight(0xffe2c0, 1.6);
  key.position.set(1, 2, 3);
  scene.add(key);
  const model = (await loader.loadAsync('models/personajes/' + id + '.glb')).scene;
  let top = 0;
  model.traverse((o) => {
    if (o.name === 'headTop') top = o.getWorldPosition(new THREE.Vector3()).y;
    if (o.isMesh) o.frustumCulled = false;
  });
  scene.add(model);
  // head and shoulders, a little from the side
  const camera = new THREE.PerspectiveCamera(24, 192 / 224, 0.1, 20);
  camera.position.set(0.32, top - 0.08, 1.22);
  camera.lookAt(0, top - 0.17, 0);
  renderer.render(scene, camera);
};
window.ready = true;
</script>`;
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = path === 'retrato.html' ? PAGE : await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 192, height: 224 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('error en la página:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/retrato.html`);
  await page.waitForFunction(() => window.ready);
  await mkdir(join(root, 'img', 'personajes'), { recursive: true });
  for (const { id } of CHARACTERS) {
    await page.evaluate((x) => window.portrait(x), id);
    await page.screenshot({ path: join(root, 'img', 'personajes', `${id}.png`), omitBackground: true });
    console.log(`${id}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
