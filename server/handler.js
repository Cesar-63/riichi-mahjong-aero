// Stateless request handler: every call loads the room from the store,
// applies the request plus any expired timers, and saves it back.
import { Game } from './engine/game.js';

const env = (typeof process !== 'undefined' && process.env) || {};
export const TIMING = {
  turnMs: Number(env.TURN_SECONDS || 5) * 1000,
  bankMs: Number(env.BANK_SECONDS || 10) * 1000,
  graceMs: 1200, // network/polling latency allowance
  resultMs: Number(env.RESULT_SECONDS || 12) * 1000,
  autoMs: 700, // forced riichi tsumogiri
  offlineMs: 1500, // decision time for disconnected players
  offlineAfterMs: 10000,
};
const ROOM_TTL = 6 * 3600 * 1000;
const LOCK_MS = 5000;

const keys = (code) => ({
  room: `mj:room:${code}`,
  meta: `mj:meta:${code}`,
  lock: `mj:lock:${code}`,
  seen: `mj:seen:${code}`,
});

function newRoom(code) {
  return { code, version: 0, status: 'lobby', queue: [], seats: null, game: null, clock: null, deadline: null };
}

function cleanName(n) {
  return String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Jugador';
}

export async function handle(body, store, now = Date.now()) {
  const op = body && body.op;
  const code = String(body.room || 'publica').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'publica';
  const token = String(body.token || '');
  if (!/^[a-f0-9]{16,64}$/.test(token)) return { status: 400, body: { error: 'token inválido' } };
  const k = keys(code);

  if (body.hb) await store.hset(k.seen, token, String(now), ROOM_TTL);

  if (op === 'poll') {
    const meta = await store.get(k.meta);
    if (meta) {
      const [ver, dl] = meta.split(':').map(Number);
      if (ver === body.since && (!dl || now < dl)) return { status: 200, body: { same: true, version: ver, now } };
      if (dl && now >= dl) {
        const r = await withRoom(store, code, now, () => false, { wait: false });
        if (r) return { status: 200, body: viewFor(r.room, token, r.seen, now) };
      }
    }
    const room = await load(store, code);
    const seen = room.status === 'playing' ? await store.hgetall(k.seen) : {};
    return { status: 200, body: viewFor(room, token, seen, now) };
  }

  if (op === 'join' || op === 'leave' || op === 'act') {
    let error = null;
    const r = await withRoom(store, code, now, (room, seen) => {
      try {
        return apply(room, op, token, body, now, seen);
      } catch (e) {
        error = e.message;
        return false;
      }
    });
    if (!r) return { status: 503, body: { error: 'sala ocupada, reintenta' } };
    const out = viewFor(r.room, token, r.seen, now);
    if (error) out.error = error;
    return { status: 200, body: out };
  }
  return { status: 400, body: { error: 'op desconocida' } };
}

async function load(store, code) {
  const raw = await store.get(keys(code).room);
  return raw ? JSON.parse(raw) : newRoom(code);
}

async function withRoom(store, code, now, fn, { wait = true } = {}) {
  const k = keys(code);
  const lockId = Math.random().toString(36).slice(2);
  let got = false;
  for (let i = 0; i < (wait ? 60 : 1); i++) {
    if (await store.setnx(k.lock, lockId, LOCK_MS)) {
      got = true;
      break;
    }
    await new Promise((res) => setTimeout(res, 50 + Math.random() * 50));
  }
  if (!got) return null;
  try {
    const room = await load(store, code);
    const seen = await store.hgetall(k.seen);
    let changed = fn(room, seen);
    if (room.status === 'playing') changed = processTimeouts(room, now, seen) || changed;
    if (changed) {
      room.version++;
      await store.setMany([
        [k.room, JSON.stringify(room), ROOM_TTL],
        [k.meta, `${room.version}:${room.deadline || 0}`, ROOM_TTL],
      ]);
    }
    return { room, seen };
  } finally {
    await store.del(k.lock);
  }
}

function apply(room, op, token, body, now, seen) {
  if (op === 'join') {
    if (room.status === 'playing' && room.seats.some((s) => s.token === token)) return false;
    if (room.status === 'finished') Object.assign(room, newRoom(room.code), { version: room.version });
    if (room.status === 'playing') throw new Error('Hay una partida en curso en esta sala');
    const name = cleanName(body.name);
    const existing = room.queue.find((q) => q.token === token);
    if (existing) existing.name = name;
    else room.queue.push({ token, name });
    if (room.queue.length === 4) startGame(room, now, seen);
    return true;
  }
  if (op === 'leave') {
    if (room.status !== 'lobby') return false;
    const before = room.queue.length;
    room.queue = room.queue.filter((q) => q.token !== token);
    return room.queue.length !== before;
  }
  // act
  if (room.status !== 'playing') throw new Error('No hay partida en curso');
  const seat = room.seats.findIndex((s) => s.token === token);
  if (seat < 0) throw new Error('No estás en esta partida');
  const g = new Game(room.game);
  const dec = room.clock.decisions[seat];
  if (dec && !dec.auto && g.s.phase !== 'result') {
    const over = now - dec.start - TIMING.turnMs - TIMING.graceMs;
    if (over > 0) room.clock.bank[seat] = Math.max(0, room.clock.bank[seat] - over);
  }
  g.act(seat, body.action || {});
  afterChange(room, g);
  schedule(room, now, seen);
  return true;
}

function startGame(room, now, seen) {
  const players = room.queue.slice();
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }
  room.seats = players;
  room.queue = [];
  room.status = 'playing';
  room.game = Game.create(players.map((p) => p.name)).s;
  room.clock = { bank: [0, 0, 0, 0], decisions: {}, kyokuKey: null };
  afterChange(room, new Game(room.game));
  schedule(room, now, seen);
}

function afterChange(room, g) {
  const s = g.s;
  const key = `${s.round}-${s.kyokuNum}-${s.honba}`;
  if (room.clock.kyokuKey !== key && s.phase !== 'result') {
    room.clock.kyokuKey = key;
    room.clock.bank = [0, 0, 0, 0].map(() => TIMING.bankMs);
  }
  if (s.phase === 'end') {
    room.status = 'finished';
    room.clock.decisions = {};
    room.deadline = null;
  }
}

const isOffline = (room, seat, seen, now) =>
  now - Number(seen[room.seats[seat].token] || 0) > TIMING.offlineAfterMs;

function schedule(room, now, seen) {
  if (room.status !== 'playing') return;
  const g = new Game(room.game);
  const key = `${g.s.phase}:${g.s.seq}`;
  const old = room.clock.decisions;
  const next = {};
  for (const seat of g.pendingSeats()) {
    if (old[seat] && old[seat].key === key) {
      next[seat] = old[seat];
      continue;
    }
    const offline = isOffline(room, seat, seen, now);
    let deadline;
    let auto = false;
    if (g.s.phase === 'result') deadline = now + (offline ? TIMING.offlineMs : TIMING.resultMs);
    else if (g.isForced(seat)) {
      deadline = now + TIMING.autoMs;
      auto = true;
    } else if (offline) deadline = now + TIMING.offlineMs;
    else deadline = now + TIMING.turnMs + TIMING.graceMs + room.clock.bank[seat];
    next[seat] = { key, start: now, deadline, auto };
  }
  room.clock.decisions = next;
  const dls = Object.values(next).map((d) => d.deadline);
  room.deadline = dls.length ? Math.min(...dls) : null;
}

export function processTimeouts(room, now, seen) {
  let changed = false;
  for (let guard = 0; guard < 200 && room.status === 'playing'; guard++) {
    schedule(room, now, seen);
    const due = Object.entries(room.clock.decisions).filter(([, d]) => d.deadline <= now);
    if (!due.length) break;
    const g = new Game(room.game);
    const [seatStr, d] = due[0];
    const seat = Number(seatStr);
    if (!d.auto && g.s.phase !== 'result') room.clock.bank[seat] = 0;
    g.defaultAction(seat);
    afterChange(room, g);
    changed = true;
  }
  return changed;
}

function viewFor(room, token, seen, now) {
  const base = { version: room.version, now, room: room.code, status: room.status };
  if (room.status === 'lobby') {
    return {
      ...base,
      queue: room.queue.map((q) => q.name),
      inQueue: room.queue.some((q) => q.token === token),
    };
  }
  const seat = room.seats.findIndex((s) => s.token === token);
  if (seat < 0) return { ...base, spectator: true, names: room.seats.map((s) => s.name) };
  const g = new Game(room.game);
  const view = g.view(seat);
  view.players.forEach((p, i) => {
    p.online = !isOffline(room, i, seen, now) || room.seats[i].token === token;
  });
  const dec = room.clock && room.clock.decisions[seat];
  view.clock = dec
    ? {
      // The grace period is hidden from the displayed countdown.
      deadline: dec.auto || room.game.phase === 'result' ? dec.deadline : dec.deadline - TIMING.graceMs,
      start: dec.start,
      turnMs: TIMING.turnMs,
      bank: room.clock.bank[seat],
      auto: dec.auto,
    }
    : null;
  return { ...base, game: view };
}
