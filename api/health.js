// GET /api/health: reports which store the functions use (never secrets).
import { createStore, findRedisEnv } from '../server/store.js';

const store = createStore();

export async function GET() {
  const { urlName, tokenName } = findRedisEnv();
  const out = { store: store.kind, urlVar: urlName || null, tokenVar: tokenName || null, ok: false };
  if (store.kind === 'upstash') {
    try {
      await store.setMany([['mj:health', String(Date.now()), 60000]]);
      out.ok = (await store.get('mj:health')) !== null;
    } catch (e) {
      out.error = e.message;
    }
  } else {
    // Only Redis variables that are not the REST API: help spot a non-Upstash database.
    out.otherRedisVars = Object.keys(process.env).filter((n) => /REDIS|KV_/.test(n));
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
