// Stateless request handler: every call loads the room from the store,
// applies the request plus any expired timers, and saves it back.
import { Game } from './engine/game.js';
import { botAction, LEVELS } from './engine/bot.js';

const env = (typeof process !== 'undefined' && process.env) || {};
export const TIMING = {
  turnMs: Number(env.TURN_SECONDS || 5) * 1000,
  bankMs: Number(env.BANK_SECONDS || 10) * 1000,
  graceMs: 1200, // network/polling latency allowance
  resultMs: Number(env.RESULT_SECONDS || 16) * 1000,
  autoMs: 700, // forced riichi tsumogiri
  botMs: 600, // test-mode bot thinking time
  // pause at the start of every hand for the shuffle/wall/dice/deal animation
  introMs: Number(env.INTRO_SECONDS ?? 8) * 1000,
  offlineMs: 1500, // decision time for disconnected players
  offlineAfterMs: 10000,
};
const ROOM_TTL = 6 * 3600 * 1000;
const LOCK_MS = 5000;

const MODE_NAME = { classic: 'Clásico', teams: 'Por equipos' };

const keys = (code) => ({
  room: `mj:room:${code}`,
  meta: `mj:meta:${code}`,
  lock: `mj:lock:${code}`,
  seen: `mj:seen:${code}`,
});

function newRoom(code) {
  // mode: 'classic' (ranked, 4 individual players) or 'teams' (2 vs 2); set by whoever opens the room
  return { code, version: 0, status: 'lobby', mode: null, queue: [], seats: null, game: null, clock: null, deadline: null };
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

  // the heartbeat is written alongside the request, not before it
  const hb = body.hb ? store.hset(k.seen, token, String(now), ROOM_TTL) : null;
  try {
    return await route(body, store, now, op, code, token, k);
  } finally {
    await hb;
  }
}

async function route(body, store, now, op, code, token, k) {

  if (op === 'poll') {
    const meta = await store.get(k.meta);
    if (meta) {
      const [ver, dl] = meta.split(':').map(Number);
      if (ver === body.since && (!dl || now < dl)) return { status: 200, body: { same: true, version: ver, now } };
      if (dl && now >= dl) {
        const r = await withRoom(store, code, now, () => false, { wait: false, beat: body.hb ? token : null });
        if (r) return { status: 200, body: viewFor(r.room, token, r.seen, now) };
      }
    }
    const [room, allSeen] = await Promise.all([load(store, code), store.hgetall(k.seen)]);
    const seen = room.status === 'playing' ? allSeen : {};
    if (body.hb && room.status === 'playing') seen[token] = String(now);
    return { status: 200, body: viewFor(room, token, seen, now) };
  }

  if (['join', 'leave', 'act', 'abandon', 'team', 'ready', 'start', 'fill', 'request'].includes(op)) {
    let error = null;
    const r = await withRoom(store, code, now, (room, seen) => {
      try {
        return apply(room, op, token, body, now, seen);
      } catch (e) {
        error = e.message;
        return false;
      }
    }, { beat: body.hb ? token : null });
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

// Runs fn on the room under the room lock. Two Redis round trips in all:
// lock + read, then write + unlock (or just unlock when nothing changed).
// `beat`: token whose heartbeat this request is writing at the same time.
async function withRoom(store, code, now, fn, { wait = true, beat = null } = {}) {
  const k = keys(code);
  const lockId = Math.random().toString(36).slice(2);
  let got = null;
  for (let i = 0; i < (wait ? 120 : 1); i++) {
    const r = await store.lockLoad(k.lock, lockId, LOCK_MS, k.room, k.seen);
    if (r.got) {
      got = r;
      break;
    }
    await new Promise((res) => setTimeout(res, 15 + Math.random() * 25));
  }
  if (!got) return null;
  let unlocked = false;
  try {
    const room = got.raw ? JSON.parse(got.raw) : newRoom(code);
    const seen = got.seen;
    if (beat) seen[beat] = String(now);
    let changed = fn(room, seen);
    if (room.status === 'playing') changed = (await processTimeouts(room, now, seen)) || changed;
    if (changed) {
      room.version++;
      await store.saveUnlock([
        [k.room, JSON.stringify(room), ROOM_TTL],
        [k.meta, `${room.version}:${room.deadline || 0}`, ROOM_TTL],
      ], k.lock);
      unlocked = true;
    }
    return { room, seen };
  } finally {
    if (!unlocked) await store.del(k.lock);
  }
}

function apply(room, op, token, body, now, seen) {
  if (op === 'join') {
    const mine = room.status === 'playing' && room.seats.find((s) => s.token === token);
    if (mine) {
      // Rejoining after abandoning takes the seat back from the autopilot.
      if (!mine.abandoned) return false;
      mine.abandoned = false;
      delete room.clock.decisions[room.seats.indexOf(mine)];
      schedule(room, now, seen);
      return true;
    }
    if (room.status === 'finished') Object.assign(room, newRoom(room.code), { version: room.version });
    if (room.status === 'playing') throw new Error('Hay una partida en curso en esta sala');
    const name = cleanName(body.name);
    const mode = body.mode === 'teams' ? 'teams' : 'classic';
    if (isBotRoom(room.code)) {
      // Test mode, starts right away. Teams: the player and Bot 1 against two bots.
      room.mode = mode;
      const bots = [1, 2, 3].map((n) => newBot(n, body.levels));
      room.queue = [{ token, name }, ...bots];
      if (mode === 'teams') room.queue.forEach((q, i) => { q.team = i < 2 ? 'N' : 'S'; });
      startGame(room, now, seen);
      return true;
    }
    if (room.queue.length === 0) room.mode = mode;
    else if (room.mode !== mode) {
      throw new Error(`La sala "${room.code}" es de modo ${MODE_NAME[room.mode]}: elige ese modo o usa otra sala`);
    }
    const existing = room.queue.find((q) => q.token === token);
    if (existing) existing.name = name;
    else {
      if (room.queue.length >= 4) throw new Error('La sala está llena (4/4)');
      room.queue.push(mode === 'teams' ? { token, name, team: null, ready: false } : { token, name });
    }
    // Classic (ranked) rooms start as soon as four players are in.
    if (mode === 'classic' && room.queue.length === 4) startGame(room, now, seen);
    return true;
  }
  if (op === 'team' || op === 'ready' || op === 'start') {
    if (room.status !== 'lobby') return false;
    if (room.mode !== 'teams') throw new Error('Esta sala no es de modo por equipos');
    const me = room.queue.find((q) => q.token === token);
    if (!me) throw new Error('No estás en esta sala');
    if (op === 'team') {
      const team = body.team === 'N' || body.team === 'S' ? body.team : null;
      if (team && room.queue.filter((q) => q !== me && q.team === team).length >= 2) {
        throw new Error('Ese equipo ya está completo');
      }
      me.team = team;
      me.ready = false;
      return true;
    }
    if (op === 'ready') {
      if (!me.team) throw new Error('Elige un equipo primero');
      me.ready = !!body.ready;
      return true;
    }
    if (room.queue[0] !== me) throw new Error('Solo el host puede comenzar la partida');
    const n = room.queue.filter((q) => q.team === 'N').length;
    if (room.queue.length !== 4 || n !== 2) throw new Error('Hacen falta 2 jugadores en cada equipo');
    if (!room.queue.every((q) => q.ready)) throw new Error('Todos tienen que estar listos');
    startGame(room, now, seen);
    return true;
  }
  if (op === 'fill') {
    // The host starts now and bots take the empty seats. By teams, anyone
    // without a team joins the one with room; the bots fill what is left.
    if (room.status !== 'lobby') return false;
    if (room.queue[0] && room.queue[0].token !== token) throw new Error('Solo el anfitrión puede empezar la partida');
    if (!room.queue.length) throw new Error('No estás en esta sala');
    const bots = [];
    for (let n = 1; room.queue.length + bots.length < 4; n++) {
      if (!room.queue.some((q) => q.name === `Bot ${n}`)) bots.push(newBot(n, body.levels));
    }
    room.queue.push(...bots);
    if (room.mode === 'teams') {
      const count = (t) => room.queue.filter((q) => q.team === t).length;
      // the humans first, then the bots
      for (const q of [...room.queue.filter((x) => !x.bot), ...bots]) {
        if (!q.team) q.team = count('N') <= count('S') ? 'N' : 'S';
      }
    }
    startGame(room, now, seen);
    return true;
  }
  if (op === 'request') {
    // Ask the teammate to discard one of their tiles (a hint, not enforced).
    if (room.status !== 'playing') return false;
    const seat = room.seats.findIndex((x) => x.token === token);
    const mate = partnerOf(room, seat);
    if (seat < 0 || mate < 0) throw new Error('No tienes compañero en esta partida');
    room.requests = room.requests || {};
    const tile = Number.isInteger(body.tile) ? body.tile : null;
    if (tile === null) delete room.requests[seat];
    else {
      if (!room.game.k.hands[mate].includes(tile)) throw new Error('Esa ficha ya no está en la mano de tu compañero');
      room.requests[seat] = { tile };
    }
    return true;
  }
  if (op === 'leave') {
    if (room.status !== 'lobby') return false;
    const before = room.queue.length;
    room.queue = room.queue.filter((q) => q.token !== token);
    return room.queue.length !== before;
  }
  if (op === 'abandon') {
    if (room.status !== 'playing') return false;
    const seat = room.seats.findIndex((s) => s.token === token);
    if (seat < 0 || room.seats[seat].abandoned) return false;
    room.seats[seat].abandoned = true;
    // Nobody left to play for: free the room instead of letting bots/autopilot run on.
    if (room.seats.every((s) => s.bot || s.abandoned)) {
      Object.assign(room, newRoom(room.code), { version: room.version });
      return true;
    }
    delete room.clock.decisions[seat];
    schedule(room, now, seen);
    return true;
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
  afterChange(room, g, now);
  schedule(room, now, seen);
  return true;
}

const shuffled = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Teammates sit next to each other: one team takes seats 0-1, the other 2-3.
function startGame(room, now, seen) {
  const players = room.mode === 'teams'
    ? shuffled(['N', 'S']).flatMap((t) => shuffled(room.queue.filter((q) => q.team === t))).map(({ ready, ...p }) => p)
    : shuffled(room.queue).map(({ team, ready, ...p }) => p);
  room.seats = players;
  room.requests = {};
  room.queue = [];
  room.status = 'playing';
  room.game = Game.create(players.map((p) => p.name)).s;
  room.clock = { bank: [0, 0, 0, 0], decisions: {}, kyokuKey: null };
  afterChange(room, new Game(room.game), now);
  schedule(room, now, seen);
}

function afterChange(room, g, now) {
  const s = g.s;
  const key = `${s.round}-${s.kyokuNum}-${s.honba}`;
  if (room.clock.kyokuKey !== key && s.phase !== 'result') {
    room.clock.kyokuKey = key;
    room.clock.bank = [0, 0, 0, 0].map(() => TIMING.bankMs);
    room.clock.introUntil = now + TIMING.introMs; // nobody's clock runs during the deal animation
    room.requests = {}; // tile ids are reused every hand
  }
  if (s.phase === 'end') {
    room.status = 'finished';
    room.clock.decisions = {};
    room.deadline = null;
  }
}

export function partnerOf(room, seat) {
  if (seat < 0 || !room.seats[seat].team) return -1;
  return room.seats.findIndex((x, i) => i !== seat && x.team === room.seats[seat].team);
}

// A teammate's pending discard request, if the tile is still in this seat's hand.
function requestFor(room, seat) {
  const mate = partnerOf(room, seat);
  const r = mate >= 0 && room.requests && room.requests[mate];
  return r && room.game.k.hands[seat].includes(r.tile) ? r.tile : null;
}

// Bot n plays at the level the player chose for it: levels[n - 1].
function newBot(n, levels) {
  const level = Array.isArray(levels) && LEVELS.includes(levels[n - 1]) ? levels[n - 1] : 'normal';
  return { token: `bot-${n}`, name: `Bot ${n}`, bot: true, level };
}

// Rooms named "bots-…" are single-player test rooms filled with bots.
export const isBotRoom = (code) => code.startsWith('bots-');

const isOffline = (room, seat, seen, now) =>
  !room.seats[seat].bot
  && (room.seats[seat].abandoned || now - Number(seen[room.seats[seat].token] || 0) > TIMING.offlineAfterMs);

function schedule(room, now, seen) {
  if (room.status !== 'playing') return;
  const g = new Game(room.game);
  const key = `${g.s.phase}:${g.s.seq}`;
  const old = room.clock.decisions;
  const next = {};
  // Decisions taken during the deal animation start counting when it ends.
  const t0 = Math.max(now, room.clock.introUntil || 0);
  for (const seat of g.pendingSeats()) {
    if (old[seat] && old[seat].key === key) {
      next[seat] = old[seat];
      continue;
    }
    if (room.seats[seat].bot) {
      const delay = g.s.phase === 'result' ? 0 : TIMING.botMs;
      next[seat] = { key, start: t0, deadline: t0 + delay, auto: true, bot: true };
      continue;
    }
    const offline = isOffline(room, seat, seen, now);
    let deadline;
    let auto = false;
    if (g.s.phase === 'result') deadline = t0 + (offline ? TIMING.offlineMs : TIMING.resultMs);
    else if (g.isForced(seat)) {
      deadline = t0 + TIMING.autoMs;
      auto = true;
    } else if (offline) deadline = t0 + TIMING.offlineMs;
    else deadline = t0 + TIMING.turnMs + TIMING.graceMs + room.clock.bank[seat];
    next[seat] = { key, start: t0, deadline, auto };
  }
  room.clock.decisions = next;
  const dls = Object.values(next).map((d) => d.deadline);
  room.deadline = dls.length ? Math.min(...dls) : null;
}

export async function processTimeouts(room, now, seen) {
  let changed = false;
  for (let guard = 0; guard < 200 && room.status === 'playing'; guard++) {
    schedule(room, now, seen);
    const due = Object.entries(room.clock.decisions).filter(([, d]) => d.deadline <= now);
    if (!due.length) break;
    const g = new Game(room.game);
    const [seatStr, d] = due[0];
    const seat = Number(seatStr);
    if (d.bot) {
      g.act(seat, await botAction(g, seat, requestFor(room, seat), room.seats[seat].level));
    } else {
      if (!d.auto && g.s.phase !== 'result') room.clock.bank[seat] = 0;
      g.defaultAction(seat);
    }
    afterChange(room, g, now);
    changed = true;
  }
  return changed;
}

function viewFor(room, token, seen, now) {
  const base = { version: room.version, now, room: room.code, status: room.status, mode: room.mode || 'classic' };
  if (room.status === 'lobby') {
    return {
      ...base,
      queue: room.queue.map((q, i) => ({ name: q.name, team: q.team, ready: !!q.ready, host: i === 0, you: q.token === token })),
      inQueue: room.queue.some((q) => q.token === token),
    };
  }
  const seat = room.seats.findIndex((s) => s.token === token);
  if (seat < 0) return { ...base, spectator: true, names: room.seats.map((s) => s.name) };
  if (room.seats[seat].abandoned) return { ...base, abandoned: true };
  const g = new Game(room.game);
  const view = g.view(seat);
  view.players.forEach((p, i) => {
    p.online = !isOffline(room, i, seen, now) || room.seats[i].token === token;
    p.bot = !!room.seats[i].bot;
    if (p.bot) p.level = room.seats[i].level || 'normal';
    p.abandoned = !!room.seats[i].abandoned;
    p.team = room.seats[i].team || null;
  });
  const mate = partnerOf(room, seat);
  if (mate >= 0) {
    const mine = room.requests && room.requests[seat];
    view.partner = {
      seat: mate,
      ...g.handOf(mate),
      // what I asked my teammate to discard / what my teammate asks of me
      myRequest: mine && room.game.k.hands[mate].includes(mine.tile) ? mine.tile : null,
    };
    view.partnerRequest = requestFor(room, seat);
  }
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
  const introLeft = (room.clock && room.clock.introUntil || 0) - now;
  view.intro = introLeft > 0 ? { left: introLeft, total: TIMING.introMs } : null;
  return { ...base, game: view };
}
