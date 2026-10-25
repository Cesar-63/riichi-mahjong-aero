import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/handler.js';
import { createStore } from '../server/store.js';

const tokens = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));

// Four players join a waiting room, pick teams (0,1 North; 2,3 South), get
// ready and the host (first to join) starts. Returns the host's start view.
async function startTeams(store, room, now) {
  const call = async (body) => (await handle({ room, ...body }, store, now)).body;
  for (let i = 0; i < 4; i++) await call({ op: 'join', token: tokens[i], name: `P${i}`, hb: true, mode: 'teams' });
  for (let i = 0; i < 4; i++) {
    await call({ op: 'team', token: tokens[i], team: i < 2 ? 'N' : 'S' });
    await call({ op: 'ready', token: tokens[i], ready: true });
  }
  return call({ op: 'start', token: tokens[0] });
}

test('four players join, play via actions and timeouts until the game ends', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 1_000_000;
  const call = async (body) => (await handle({ room: 't1', ...body }, store, now)).body;

  for (let i = 0; i < 3; i++) {
    const r = await call({ op: 'join', token: tokens[i], name: `P${i}`, hb: true });
    assert.equal(r.status, 'lobby');
    assert.equal(r.mode, 'classic');
    assert.equal(r.queue.length, i + 1);
  }
  assert.ok((await call({ op: 'join', token: tokens[3], name: 'P3', mode: 'teams' })).error, 'mode must match the room');
  const r4 = await call({ op: 'join', token: tokens[3], name: 'P3', hb: true });
  assert.equal(r4.status, 'playing', 'classic rooms start at four players');
  assert.equal(r4.game.players.length, 4);
  // Other players' hands are never sent; classic mode has no teammate.
  assert.equal(JSON.stringify(r4).includes('"hands"'), false);
  assert.equal(r4.game.partner, undefined);
  assert.ok(r4.game.players.every((p) => p.team === null));
  assert.ok((await call({ op: 'request', token: tokens[0], tile: 1 })).error);

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
  assert.deepEqual(again.queue.map((q) => q.name), ['P0']);
});

test('illegal action is reported, not applied', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  const now = 5_000_000;
await startTeams(store, 't2', now);
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

test('bot room: one player against three bots that call and win', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 9_000_000;
  const call = async (body) => (await handle({ room: 'bots-abc', ...body }, store, now)).body;
  const me = tokens[0];
  const first = await call({ op: 'join', token: me, name: 'Yo', hb: true });
  assert.equal(first.status, 'playing');
  assert.equal(first.game.players.filter((p) => p.bot).length, 3);
  assert.equal(first.game.partner, undefined, 'classic bot room has no teammate');
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
  assert.ok(botWins > 0, 'bots win hands');
});

test('abandon: seat goes on autopilot, can rejoin; last human frees the room', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 20_000_000;
  const call = async (body, room = 't3') => (await handle({ room, ...body }, store, now)).body;
  await startTeams(store, 't3', now);
  const left = await call({ op: 'abandon', token: tokens[1] });
  assert.equal(left.abandoned, true);
  const other = await call({ op: 'poll', token: tokens[0] });
  assert.equal(other.game.players[other.game.players.findIndex((p) => p.name === 'P1')].abandoned, true);
  // Autopilot acts for the abandoned seat after the short offline delay.
  const back = await call({ op: 'join', token: tokens[1], name: 'P1' });
  assert.equal(back.status, 'playing');
  assert.ok(back.game);

  const solo = await call({ op: 'join', token: tokens[0], name: 'Yo' }, 'bots-x');
  assert.equal(solo.status, 'playing');
  const gone = await call({ op: 'abandon', token: tokens[0] }, 'bots-x');
  assert.equal(gone.status, 'lobby');
  now += 1000;
  assert.equal((await call({ op: 'poll', token: tokens[0] }, 'bots-x')).status, 'lobby');
});

test('waiting room: teams of two, ready and host start', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  const now = 30_000_000;
  const call = async (body) => (await handle({ room: 'w1', ...body }, store, now)).body;
  for (let i = 0; i < 4; i++) {
    const r = await call({ op: 'join', token: tokens[i], name: `P${i}`, mode: 'teams' });
    assert.equal(r.status, 'lobby', 'four players do not start a team game by themselves');
  }
  assert.ok((await call({ op: 'join', token: 'e'.repeat(32), name: 'Extra', mode: 'teams' })).error, 'room holds 4');
  assert.ok((await call({ op: 'ready', token: tokens[0], ready: true })).error, 'ready needs a team');
  await call({ op: 'team', token: tokens[0], team: 'N' });
  await call({ op: 'team', token: tokens[1], team: 'N' });
  assert.ok((await call({ op: 'team', token: tokens[2], team: 'N' })).error, 'a team holds 2');
  await call({ op: 'team', token: tokens[2], team: 'S' });
  await call({ op: 'team', token: tokens[3], team: 'S' });
  for (let i = 0; i < 3; i++) await call({ op: 'ready', token: tokens[i], ready: true });
  assert.ok((await call({ op: 'start', token: tokens[0] })).error, 'everyone must be ready');
  await call({ op: 'ready', token: tokens[3], ready: true });
  assert.ok((await call({ op: 'start', token: tokens[1] })).error, 'only the host starts');
  const lobby = await call({ op: 'poll', token: tokens[1] });
  assert.deepEqual(lobby.queue.map((q) => [q.team, q.ready, q.host]), [['N', true, true], ['N', true, false], ['S', true, false], ['S', true, false]]);
  // switching team clears ready
  await call({ op: 'team', token: tokens[3], team: null });
  await call({ op: 'team', token: tokens[3], team: 'S' });
  assert.ok((await call({ op: 'start', token: tokens[0] })).error);
  await call({ op: 'ready', token: tokens[3], ready: true });
  const started = await call({ op: 'start', token: tokens[0] });
  assert.equal(started.status, 'playing');

  // teammates sit next to each other and see each other's hand
  const views = [];
  for (let i = 0; i < 4; i++) views.push((await call({ op: 'poll', token: tokens[i] })).game);
  const seatOf = (i) => views[i].seat;
  for (const [a, b] of [[0, 1], [2, 3]]) {
    assert.equal(Math.abs(seatOf(a) - seatOf(b)) % 2, 1, 'adjacent seats');
    assert.equal(views[a].partner.seat, seatOf(b));
    assert.equal(views[a].partner.hand.length + (views[a].partner.drawn === null ? 0 : 1), views[b].hand.length + (views[b].drawn === null ? 0 : 1));
    assert.deepEqual(views[a].partner.hand, views[b].hand);
  }
  assert.equal(views[0].players[seatOf(0)].team, 'N');
  assert.equal(views[0].players[seatOf(2)].team, 'S');
});

test('discard request: shown to the teammate, validated, cleared when the tile leaves', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  const now = 40_000_000;
  const call = async (body) => (await handle({ room: 'w2', ...body }, store, now)).body;
  await startTeams(store, 'w2', now);
  const v0 = (await call({ op: 'poll', token: tokens[0] })).game;
  const wanted = v0.partner.hand[0];
  assert.ok((await call({ op: 'request', token: tokens[0], tile: 999 })).error);
  const after = (await call({ op: 'request', token: tokens[0], tile: wanted })).game;
  assert.equal(after.partner.myRequest, wanted);
  const mate = (await call({ op: 'poll', token: tokens[1] })).game;
  assert.equal(mate.partnerRequest, wanted);
  const rival = (await call({ op: 'poll', token: tokens[2] })).game;
  assert.equal(rival.partnerRequest, null, 'opponents do not see it');
  assert.equal(rival.partner.myRequest, null);
  await call({ op: 'request', token: tokens[0], tile: null });
  assert.equal((await call({ op: 'poll', token: tokens[1] })).game.partnerRequest, null);
});

test('bot partner honours a discard request', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 50_000_000;
  const call = async (body) => (await handle({ room: 'bots-req', ...body }, store, now)).body;
  let v = (await call({ op: 'join', token: tokens[0], name: 'Yo', hb: true, mode: 'teams' })).game;
  assert.equal(v.players[v.partner.seat].name, 'Bot 1');
  const mate = v.partner.seat;
  let honoured = false;
  let asked = null;
  for (let step = 0; step < 400 && !honoured; step++) {
    now += 700;
    v = (await call({ op: 'poll', token: tokens[0], hb: step % 5 === 0 })).game;
    if (!v || v.phase === 'result' || v.phase === 'end') break;
    const ev = [...v.events].reverse().find((e) => e.type === 'discard' && e.seat === mate);
    if (asked !== null && ev && ev.tile === asked) honoured = true;
    if (v.partner.myRequest === null && v.partner.hand.length) {
      // ask for a tile that is not the one it just drew, so tsumogiri would not explain it
      asked = v.partner.hand[v.partner.hand.length - 1];
      await call({ op: 'request', token: tokens[0], tile: asked });
    }
    if (v.options && v.options.kind === 'turn') await call({ op: 'act', token: tokens[0], action: { type: 'discard', tile: v.drawn ?? v.options.discard[0] } });
    else if (v.options) await call({ op: 'act', token: tokens[0], action: { type: 'pass' } });
  }
  assert.ok(honoured, 'bot discarded the requested tile');
});

test('deal animation pause: no clocks or bots run until it ends', async () => {
  const { TIMING } = await import('../server/handler.js');
  globalThis.__mjStore = new Map();
  const store = createStore({});
  let now = 60_000_000;
  const call = async (body) => (await handle({ room: 'bots-intro', ...body }, store, now)).body;
  const first = (await call({ op: 'join', token: tokens[0], name: 'Yo', hb: true })).game;
  assert.equal(first.intro.left, TIMING.introMs);
  const startEvents = first.events.length;
  now += TIMING.introMs - 100;
  const during = (await call({ op: 'poll', token: tokens[0], hb: true })).game;
  assert.equal(during.events.length, startEvents, 'nothing happens during the intro');
  assert.ok(during.intro.left > 0);
  if (during.clock) assert.ok(during.clock.start >= now, 'my clock starts after the intro');
  now += 100 + TIMING.botMs + TIMING.turnMs + TIMING.bankMs + 2000;
  const after = (await call({ op: 'poll', token: tokens[0], hb: true })).game;
  assert.equal(after.intro, null);
  assert.ok(after.events.length > startEvents || after.wallLeft < first.wallLeft, 'play resumes');
});

test('fill with bots: the host starts now and bots take the empty seats', async () => {
  globalThis.__mjStore = new Map();
  const store = createStore({});
  const now = 40_000_000;
  // classic: two humans, two bots
  const call = async (room, body) => (await handle({ room, ...body }, store, now)).body;
  await call('f1', { op: 'join', token: tokens[0], name: 'Ana', mode: 'classic' });
  await call('f1', { op: 'join', token: tokens[1], name: 'Beto', mode: 'classic' });
  assert.ok((await call('f1', { op: 'fill', token: tokens[1] })).error, 'only the host fills');
  const started = await call('f1', { op: 'fill', token: tokens[0] });
  assert.equal(started.status, 'playing');
  const names = started.game.players.map((p) => p.name).sort();
  assert.deepEqual(names, ['Ana', 'Beto', 'Bot 1', 'Bot 2']);
  assert.equal(started.game.players.filter((p) => p.bot).length, 2);

  // teams: a host alone, no team picked yet, gets a bot partner and two bot rivals
  await call('f2', { op: 'join', token: tokens[2], name: 'Cata', mode: 'teams' });
  const t = await call('f2', { op: 'fill', token: tokens[2] });
  assert.equal(t.status, 'playing');
  const me = t.game.players[t.game.seat];
  const teams = t.game.players.map((p) => p.team);
  assert.equal(teams.filter((x) => x === 'N').length, 2);
  assert.equal(teams.filter((x) => x === 'S').length, 2);
  assert.ok(t.game.partner, 'a bot partner');
  assert.ok(t.game.players[t.game.partner.seat].bot);
  assert.equal(t.game.players[t.game.partner.seat].team, me.team);
});
