// Tiny key-value store: Upstash Redis over REST in production, in-memory
// otherwise. The Vercel Marketplace may add a custom prefix to the variable
// names (e.g. STORAGE_KV_REST_API_URL), so any prefix is accepted.

const URL_RE = /(^|_)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/;
const TOKEN_RE = /(^|_)(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)$/;

export function findRedisEnv(env = process.env) {
  const names = Object.keys(env).sort((a, b) => a.length - b.length);
  const urlName = names.find((n) => URL_RE.test(n) && env[n]);
  const tokenName = names.find((n) => TOKEN_RE.test(n) && env[n]);
  return { urlName, tokenName, url: urlName && env[urlName], token: tokenName && env[tokenName] };
}

export function createStore(env = process.env) {
  const { url, token } = findRedisEnv(env);
  if (url && token) return upstashStore(url.replace(/\/$/, ''), token);
  if (env.VERCEL) {
    console.warn('No Redis configured: falling back to memory, rooms will not survive between instances');
  }
  return memoryStore();
}

function upstashStore(url, token) {
  async function pipeline(cmds) {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!res.ok) throw new Error(`redis http ${res.status}`);
    const out = await res.json();
    for (const r of out) if (r.error) throw new Error(`redis: ${r.error}`);
    return out.map((r) => r.result);
  }
  const one = async (...cmd) => (await pipeline([cmd]))[0];
  return {
    kind: 'upstash',
    get: (k) => one('GET', k),
    mget: (...keys) => one('MGET', ...keys),
    // entries: [[key, value, ttlMs]]
    setMany: (entries) => pipeline(entries.map(([k, v, px]) => ['SET', k, v, 'PX', String(px)])),
    setnx: async (k, v, px) => (await one('SET', k, v, 'NX', 'PX', String(px))) === 'OK',
    del: (k) => one('DEL', k),
    hset: (k, f, v, px) => pipeline([['HSET', k, f, v], ['PEXPIRE', k, String(px)]]),
    hgetall: async (k) => {
      const flat = (await one('HGETALL', k)) || [];
      const obj = {};
      for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
      return obj;
    },
  };
}

function memoryStore() {
  const data = globalThis.__mjStore || (globalThis.__mjStore = new Map());
  const live = (k) => {
    const e = data.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      data.delete(k);
      return null;
    }
    return e;
  };
  return {
    kind: 'memory',
    get: async (k) => live(k)?.v ?? null,
    mget: async (...keys) => keys.map((k) => live(k)?.v ?? null),
    setMany: async (entries) => {
      for (const [k, v, px] of entries) data.set(k, { v, exp: Date.now() + px });
    },
    setnx: async (k, v, px) => {
      if (live(k)) return false;
      data.set(k, { v, exp: Date.now() + px });
      return true;
    },
    del: async (k) => {
      data.delete(k);
    },
    hset: async (k, f, v, px) => {
      const e = live(k) || { v: {} };
      e.v[f] = v;
      e.exp = Date.now() + px;
      data.set(k, e);
    },
    hgetall: async (k) => ({ ...(live(k)?.v || {}) }),
  };
}
