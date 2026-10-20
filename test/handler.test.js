import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/handler.js';
import { createStore } from '../server/store.js';

const tokens = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));

test('four players join, play via actions and timeouts until the game ends', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 1_000_000;
  const call = async (body) => (await handle({ room: 't1', ...body }, store, now)).body;

  for (let i = 0; i < 3; i++) {
    const r = await call({ op: 'join', token: tokens[i], name: `P${i}`, hb: true });
    assert.equal(r.status, 'lobby');
    assert.equal(r.queue.length, i + 1);
  }
  const r4 = await call({ op: 'join', token: tokens[3], name: 'P3', hb: true });
  assert.equal(r4.status, 'playing');
  assert.equal(r4.game.players.length, 4);
  // Other players' hands are never sent.
  assert.equal(JSON.stringify(r4).includes('"hands"'), false);

  const spectator = await call({ op: 'poll', token: 'e'.repeat(32) });
  assert.equal(spectator.spectator, true);

  let steps = 0;
  let status = 'playing';
  let since = -1;
  while (status === 'playing') {
    assert.ok(++steps < 30000, 'terminates');
    now += 400;
    // One player (index 3) never acts and goes silent: relies on timeouts.
    for (let i = 0; i < 4; i++) {
      const hb = i < 3 && steps % 5 === 0;
      const v = await call({ op: 'poll', token: tokens[i], since: i === 0 ? since : -1, hb });
      if (v.same) continue;
      if (i === 0) since = v.version;
      status = v.status;
      if (status !== 'playing' || i === 3) continue;
      const o = v.game.options;
      if (v.game.phase === 'result' && !v.game.result.ready[v.game.seat]) {
        await call({ op: 'act', token: tokens[i], action: { type: 'ok' } });
      } else if (o && o.kind === 'turn') {
        const action = o.tsumo ? { type: 'tsumo' } : { type: 'discard', tile: v.game.drawn ?? o.discard[0] };
        const res = await call({ op: 'act', token: tokens[i], action });
        assert.equal(res.error, undefined, res.error);
      } else if (o && o.kind === 'response') {
        const res = await call({ op: 'act', token: tokens[i], action: o.ron ? { type: 'ron' } : { type: 'pass' } });
        assert.equal(res.error, undefined, res.error);
      }
    }
  }
  const end = await call({ op: 'poll', token: tokens[0] });
  assert.equal(end.status, 'finished');
  assert.equal(end.game.final.length, 4);

  // Joining again resets the room to a fresh lobby.
  const again = await call({ op: 'join', token: tokens[0], name: 'P0' });
  assert.equal(again.status, 'lobby');
  assert.deepEqual(again.queue, ['P0']);
});

test('illegal action is reported, not applied', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  const now = 5_000_000;
  for (let i = 0; i < 4; i++) await handle({ op: 'join', room: 't2', token: tokens[i], name: `P${i}`, hb: true }, store, now);
  const r = (await handle({ op: 'act', room: 't2', token: tokens[0], action: { type: 'discard', tile: 999 } }, store, now)).body;
  assert.ok(r.error);
});

test('redis env vars are found with any prefix', async () => {
  const { findRedisEnv } = await import('../server/store.js');
  const env = {
    STORAGE_KV_REST_API_URL: 'https://x.upstash.io',
    STORAGE_KV_REST_API_TOKEN: 'tok',
    STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro',
  };
  const r = findRedisEnv(env);
  assert.equal(r.url, 'https://x.upstash.io');
  assert.equal(r.token, 'tok');
  assert.equal(findRedisEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' }).token, 't');
  assert.equal(findRedisEnv({ REDIS_URL: 'redis://x' }).url, undefined);
});

test('bot room: one player against three bots that call and tsumogiri', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 9_000_000;
  const call = async (body) => (await handle({ room: 'bots-abc', ...body }, store, now)).body;
  const me = tokens[0];
  const first = await call({ op: 'join', token: me, name: 'Yo', hb: true });
  assert.equal(first.status, 'playing');
  assert.equal(first.game.players.filter((p) => p.bot).length, 3);
  const mySeat = first.game.seat;
  let calls = 0;
  let botWins = 0;
  for (let step = 0; step < 20000; step++) {
    now += 700;
    const v = await call({ op: 'poll', token: me, hb: step % 5 === 0 });
    if (v.status === 'finished') break;
    const gv = v.game;
    for (const e of gv.events) if ((e.type === 'pon' || e.type === 'chi') && e.seat !== mySeat) calls++;
    if (gv.phase === 'result') {
      if (gv.result.type === 'agari' && gv.result.wins.some((w) => w.seat !== mySeat)) botWins++;
      if (!gv.result.ready[mySeat]) await call({ op: 'act', token: me, action: { type: 'ok' } });
    } else if (gv.options && gv.options.kind === 'turn') {
      await call({ op: 'act', token: me, action: { type: 'discard', tile: gv.drawn ?? gv.options.discard[0] } });
    } else if (gv.options) {
      await call({ op: 'act', token: me, action: { type: 'pass' } });
    }
  }
  const end = await call({ op: 'poll', token: me });
  assert.equal(end.status, 'finished');
  assert.ok(calls > 0, 'bots made calls');
  assert.equal(botWins, 0, 'bots never win');
});
