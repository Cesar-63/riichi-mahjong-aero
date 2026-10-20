// Local development server: serves public/ and the same /api/game handler
// with an in-memory store. Usage: npm run dev  (PORT=3000 by default)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST } from './api/game.js';
import { GET as health } from './api/health.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/game' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const response = await POST(new Request(url, { method: 'POST', body: Buffer.concat(chunks) }));
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(await response.text());
    return;
  }
  if (url.pathname === '/api/health') {
    const response = await health();
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(await response.text());
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  try {
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`http://localhost:${port}`));
