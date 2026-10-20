// Vercel Function: POST /api/game  (body: { op, room, token, ... })
import { handle } from '../server/handler.js';
import { createStore } from '../server/store.js';

const store = createStore();

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // empty or invalid body falls through to a 400 from handle()
  }
  try {
    const res = await handle(body, store);
    return Response.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'error interno' }, { status: 500 });
  }
}
