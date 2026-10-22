// 3D table renderer (prototype). Consumes the same server view as the 2.5D
// board. Every tile is an object with a stable key (tile id, wall slot, or
// hidden-hand index) that eases towards a target transform each frame, so
// draws, discards and calls animate by themselves. The player's own hand is
// not lying on the table: like Tenhou's 3D view it faces the screen, as 3D
// tiles in an overlay scene (hand3d.js).
import { createWorld } from './world.js';
import { createTileKit, W, H, D, GAP } from './tiles3d.js';
import { createShuffle } from './shuffle.js';
import { createHand3D } from './hand3d.js';
import { deadSlot, tileType, isAka, doraFromIndicator } from '../shared/tiles.js';

const S = 1 / 4.1; // world units per 2.5D board unit
const fx = (x) => (x - 50) * S; // 2.5D board coords -> seat-local world coords
const fz = (y) => (y - 50) * S;
const STACKS = 17;
const SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const PITCH = W + GAP; // distance between neighbouring tiles in a row
// x of the i-th standing/lying tile of a hand row starting at the 2.5D x0
const rowX = (x0, i) => fx(x0) + i * PITCH + W / 2;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function createTable3D(container, { onPick } = {}) {
  const world = createWorld(container);
  const { THREE, scene, camera, renderer, RoundedBoxGeometry } = world;

  // ---------------------------------------------------------------- assets
  const kit = createTileKit(renderer);
  const makeTile = kit.makeTile;
  const hand = createHand3D({ world, kit, onPick: (id) => onPick && onPick(id) });

  // -------------------------------------------------------------- transforms
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const qSeat = SEAT_ANGLE.map((a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
  const qLocal = {
    stand: new THREE.Quaternion(),
    up: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
    down: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
  };
  // lying sideways (riichi / called tile): face up, turned a quarter to the left
  qLocal.side = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(qLocal.up);
  function place(rel, x, y, z, pose) {
    const p = new THREE.Vector3(x, y, z).applyQuaternion(qSeat[rel]);
    const q = qSeat[rel].clone().multiply(qLocal[pose]);
    return { p, q };
  }

  // ------------------------------------------------------------- motion
  // Tiles travel at a steady speed along straight segments, no easing. A
  // tile going somewhere else (or turning over) first rises clear of
  // everything on the table (walls included), crosses at that height and
  // comes straight down. It turns while it rises when it ends lying (so a
  // discard is already flat before it reaches the pond) and while it comes
  // down when it ends standing (a draw only stands up at the hand).
  const SPEED = 48; // world units per second
  const FAST = 96; // draws and discards: they have to feel immediate
  const MINE = 150; // my own discard answers my click
  const FAST_LANES = new Set(['discard', 'draw']);
  const laneSpeed = (lane) => (lane === 'mine' ? MINE : FAST_LANES.has(lane) ? FAST : SPEED);
  const CLEAR = 1.95; // centre height of a lying tile that clears a wall
  const TURN_LEN = 1.1; // shortest stretch of the path used for turning
  const FACE = new THREE.Vector3(0, 0, 1);
  const standingQ = (q) => Math.abs(FACE.clone().applyQuaternion(q).y) < 0.5;
  // options: hy = crossing height (null: straight line), turnAll = turn
  // evenly over the whole path
  function makePath(from, to, { hy, turnAll } = {}) {
    const a = from.p.clone();
    const d = to.p.clone();
    const horiz = Math.hypot(d.x - a.x, d.z - a.z);
    const turn = from.q.angleTo(to.q);
    if (hy === undefined) hy = horiz > 1.5 || turn > 0.3 ? Math.max(a.y, d.y + 0.6, CLEAR) : null;
    const pts = [a];
    if (hy !== null && hy > a.y + 1e-3) pts.push(new THREE.Vector3(a.x, hy, a.z));
    if (hy !== null && hy > d.y + 1e-3) pts.push(new THREE.Vector3(d.x, hy, d.z));
    pts.push(d);
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = lens[lens.length - 1];
    const rise = pts.length > 2 ? lens[1] : 0;
    const drop = pts.length > 2 ? total - lens[lens.length - 2] : 0;
    // the turning window, as a stretch of the path
    let t0 = 0;
    let t1 = total;
    if (turn > 1e-3 && total > TURN_LEN && !turnAll) {
      if (standingQ(to.q)) t0 = total - Math.max(drop, TURN_LEN);
      else t1 = Math.max(rise, TURN_LEN);
    }
    return { pts, lens, total, q0: from.q.clone(), q1: to.q.clone(), t0, t1 };
  }
  // pose `dist` units along the path, written into obj
  function poseAt(path, dist, obj) {
    const s = Math.max(0, Math.min(path.total, dist));
    let i = 1;
    while (i < path.lens.length - 1 && path.lens[i] < s) i++;
    const seg = path.lens[i] - path.lens[i - 1];
    obj.position.lerpVectors(path.pts[i - 1], path.pts[i], seg > 0 ? (s - path.lens[i - 1]) / seg : 1);
    const span = path.t1 - path.t0;
    const f = span > 0 ? Math.max(0, Math.min(1, (s - path.t0) / span)) : 1;
    obj.quaternion.slerpQuaternions(path.q0, path.q1, f);
  }
  const samePose = (a, b) => a.p.distanceToSquared(b.p) < 1e-6 && a.q.angleTo(b.q) < 1e-3;

  // ---------------------------------------------------------- object pool
  const objects = new Map(); // key -> { obj, target: {p, q}, lift }
  let me = 0;

  // Plays never overlap: the moves of one play (a discard, a call, a draw)
  // wait until the previous play's moves have landed, even when a single
  // update brings several plays at once. Moves without a lane (a hand or
  // pond closing a gap) start right away.
  const LANES = ['discard', 'call', 'draw'];
  let laneEnd = 0; // performance.now() when the last queued play lands
  function queuePlays(moves) {
    const now = performance.now();
    // My own discard never waits: whatever is still moving lands at once
    // and the tile leaves the moment I click.
    if (moves.some((m) => m.lane === 'mine')) {
      for (const o of objects.values()) {
        if (!o.path || moves.some((m) => m.o === o)) continue;
        poseAt(o.path, o.path.total, o.obj);
        o.obj.visible = true;
        o.path = null;
      }
      laneEnd = now;
      for (const m of moves) if (m.lane === 'mine') m.lane = 'discard';
    }
    let at = Math.max(now, laneEnd);
    for (const lane of LANES) {
      const group = moves.filter((m) => m.lane === lane);
      if (!group.length) continue;
      for (const m of group) {
        m.o.wait = at - now;
        // a waiting discard would sit inside its hand: it shows when it sets off
        if (lane === 'discard' && m.o.wait > 0) m.o.obj.visible = false;
      }
      at += Math.max(...group.map((m) => m.o.path.total / m.o.path.speed)) * 1000;
    }
    laneEnd = at;
  }
  // how long a new play has to wait for the ones already moving
  const laneWait = () => Math.max(0, laneEnd - performance.now());

  function sync(desired, spawns) {
    const moves = [];
    for (const [key, d] of desired) {
      let o = objects.get(key);
      if (!o) {
        const obj = makeTile(d.id);
        const from = spawns.get(key) || d.target;
        obj.position.copy(from.p);
        obj.quaternion.copy(from.q);
        scene.add(obj);
        o = { obj };
        objects.set(key, o);
        if (!samePose(from, d.target)) {
          o.path = makePath(from, d.target, from);
          o.path.speed = laneSpeed(d.lane);
          o.dist = 0;
          o.wait = 0;
          if (d.lane) moves.push({ o, lane: d.lane });
        }
      } else if (!samePose(o.target, d.target)) {
        o.path = makePath({ p: o.obj.position, q: o.obj.quaternion }, d.target);
        o.path.speed = laneSpeed(d.lane);
        o.dist = 0;
        o.wait = 0;
        if (d.lane) moves.push({ o, lane: d.lane });
      }
      o.target = d.target;
      o.flags = d.flags || {};
    }
    for (const [key, o] of objects) {
      if (!desired.has(key)) {
        scene.remove(o.obj);
        kit.dispose(o.obj);
        if (o.blob) {
          scene.remove(o.blob);
          o.blob.material.dispose();
        }
        objects.delete(key);
      }
    }
    queuePlays(moves);
  }

  // Contact shadows (PS2 style blob shadows): a soft dark patch on the table
  // under every tile resting on it, sized to its footprint, fading as it lifts.
  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.55, 'rgba(0,0,0,.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const SIZE = [W, H, D];
  function updateBlob(o) {
    if (!o.blob) {
      o.blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0 }));
      o.blob.renderOrder = 1;
      scene.add(o.blob);
    }
    const q = o.obj.quaternion;
    axes[0].set(1, 0, 0).applyQuaternion(q);
    axes[1].set(0, 1, 0).applyQuaternion(q);
    axes[2].set(0, 0, 1).applyQuaternion(q);
    let ex = 0;
    let ey = 0;
    let ez = 0;
    axes.forEach((a, i) => {
      ex += Math.abs(a.x) * SIZE[i];
      ey += Math.abs(a.y) * SIZE[i];
      ez += Math.abs(a.z) * SIZE[i];
    });
    const bottom = o.obj.position.y - ey / 2;
    const floor = 0;
    // only the lowest tile of a stack touches the table
    const lift = Math.max(0, bottom - floor);
    o.blob.position.set(o.obj.position.x, floor + 0.012, o.obj.position.z);
    o.blob.scale.set(ex * 1.35 + lift * 0.4, 1, ez * 1.35 + lift * 0.4);
    o.blob.material.opacity = lift > 0.5 ? 0 : 0.42 * (1 - lift / 0.5);
  }

  // ------------------------------------------------------- win reveal
  // Tetsuya style: at the "Tsumo!"/"Ron!" call the winner's hand stands on
  // the table (an opponent's hidden hand simply turns into it; mine, which
  // is not on the table, is set down there tile by tile), waits a moment and
  // then the tiles fall over face up one after the other, each turning
  // about its back bottom edge, so no tile ever dips into the table. A ron
  // tile flies over from the pond into its place. Then the dora indicators fly from
  // the dead wall to a labelled row right in front of that hand, the ura
  // dora (riichi only) are lifted from under them, turned over and laid next
  // to them, and every tile of the hand they make dora lights up: gold for
  // dora and red fives, pink for ura dora. Listeners get { phase: 'dora',
  // result } and { phase: 'done' } (the score screen waits for 'done'). An
  // exhaustive draw lays every hand down the same way (syncDraw) and also
  // ends with 'done'.
  // placeMs/placeGap: my hand set down standing; fallAt: the first tile
  // starts to fall; tileMs between tiles falling; dropMs: one fall
  const WIN = { callMs: 900, placeMs: 150, placeGap: 18, fallAt: 1500, tileMs: 45, dropMs: 240, flyMs: 240, flyGap: 60, holdMs: 1800 };
  const DORA_GLOW = 0xffc83a;
  const URA_GLOW = 0xff5fc8;
  let win = null;
  let winListener = () => {};
  const resultKey = (v) => `${v.round}-${v.kyokuNum}-${v.honba}`;
  const isAgari = (v) => v.phase === 'result' && v.result && v.result.type === 'agari';
  const isRyuukyoku = (v) => v.phase === 'result' && v.result && v.result.type === 'draw' && !v.result.abortive;
  const DRAW = { startMs: 900, tileMs: 40, holdMs: 2200 };

  // flat label lying on the table, readable from the winner's seat
  const labelTex = new Map();
  function tableLabel(text, color) {
    if (!labelTex.has(text)) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0, 0, 0, .55)';
      g.beginPath();
      g.roundRect(4, 8, 248, 80, 26);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = color;
      g.font = '46px "Kaushan Script", "Zen Kaku Gothic New", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 50);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      labelTex.set(text, t);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.71), new THREE.MeshBasicMaterial({ map: labelTex.get(text), transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  function clearWin() {
    if (!win) return;
    for (const it of [...win.items, ...win.flyers]) {
      scene.remove(it.mesh);
      kit.dispose(it.mesh);
    }
    for (const l of win.labels) {
      scene.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.dispose();
    }
    for (const o of objects.values()) o.obj.visible = true;
    win = null;
    if (!intro) world.forceView(null);
  }

  // A hand tipping over in place: the standing tile turns about its bottom
  // edge at a steady rate until it lies face up (towards the centre) or face
  // down (towards its owner, for a noten hand). The standing start is the
  // hand's own row, so the hidden hand is simply replaced.
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  function tipOver(r, x, faceUp) {
    const standZ = fz(95);
    const target = place(r, x, D / 2, faceUp ? standZ - H / 2 - D / 2 : standZ + H / 2 + D / 2, faceUp ? 'up' : 'down');
    const edge = new THREE.Vector3(0, -H / 2, faceUp ? -D / 2 : D / 2).applyQuaternion(target.q);
    const pivot = target.p.clone().add(edge);
    return { target, pivot, arm: edge.negate(), axis: X_AXIS.clone().applyQuaternion(qSeat[r]), angle: faceUp ? Math.PI / 2 : -Math.PI / 2 };
  }
  const qTip = new THREE.Quaternion();
  function tipPose(tip, u, obj) {
    const a = tip.angle * (1 - u);
    obj.position.copy(tip.arm).applyAxisAngle(tip.axis, a).add(tip.pivot);
    obj.quaternion.copy(qTip.setFromAxisAngle(tip.axis, a)).multiply(tip.target.q);
  }
  // One tile of a hand being shown: standing from standAt (dropping the
  // last bit onto the table if it was not there before), falling over
  // (face up or down) from fallAt.
  function revealTile(r, id, x, faceUp, standAt, fallAt) {
    const mesh = makeTile(id);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, id, standAt, fallAt, tip: tipOver(r, x, faceUp), placed: r === 0 };
  }
  const revealZ = (faceUp) => (faceUp ? fz(95) - H / 2 - D / 2 : fz(95) + H / 2 + D / 2);

  function addLabel(labels, r, x, z, text, color, at) {
    const mesh = tableLabel(text, color);
    const p = place(r, x, 0.02, z, 'stand');
    mesh.position.copy(p.p);
    mesh.quaternion.copy(p.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    mesh.visible = false;
    scene.add(mesh);
    labels.push({ mesh, at });
  }

  // Camera behind seat r looking down at everything the win laid out
  // there (world points: the hand, its calls and the dora row), far enough
  // back for all of it to fit the screen's width, and aimed so it sits in
  // the lower part of the screen, under the score sheet.
  const FRAME = { tilt: Math.atan2(11, 10), minDist: 16.6, low: 0.79 };
  function handFrame(r, points) {
    const toLocal = qSeat[r].clone().invert();
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const pt of points) {
      const l = pt.clone().applyQuaternion(toLocal);
      x0 = Math.min(x0, l.x);
      x1 = Math.max(x1, l.x);
      z0 = Math.min(z0, l.z);
      z1 = Math.max(z1, l.z);
    }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW = (x1 - x0) / 2 + 1.4;
    const dist = Math.max(FRAME.minDist, (halfW / (tanV * camera.aspect)) * 1.08);
    const pos = new THREE.Vector3(cx, dist * Math.sin(FRAME.tilt), cz + dist * Math.cos(FRAME.tilt));
    // look a little beyond the hand so it shows at FRAME.low of the height
    const down = FRAME.tilt - Math.atan((FRAME.low - 0.5) * 2 * tanV);
    const target = new THREE.Vector3(cx, 0, pos.z - pos.y / Math.tan(down));
    return { pos: pos.applyQuaternion(qSeat[r]), target: target.applyQuaternion(qSeat[r]) };
  }

  // Seat-local z of the line a winner's calls slide into: the revealed
  // hand's, or a little nearer the owner when the player on their right won
  // too (double ron), since that player's revealed hand starts at the very
  // corner where the calls end.
  function winMeldZ(v, abs) {
    const next = (abs + 1) % 4;
    return v.result.wins.some((w) => w.seat === next) ? revealZ(true) + 0.52 : revealZ(true);
  }

  // seats whose concealed hand is laid down on the table right now
  function laidDown(v) {
    if (isAgari(v)) return new Set(v.result.wins.map((w) => w.seat));
    if (isRyuukyoku(v)) return new Set([0, 1, 2, 3]);
    return new Set();
  }

  function syncWin(v, ui, rel) {
    if (!isAgari(v) && !isRyuukyoku(v)) {
      if (win) clearWin();
      return;
    }
    const key = resultKey(v);
    if (win && win.key === key) return;
    clearWin();
    closePoints();
    if (isRyuukyoku(v)) return syncDraw(v, ui, rel, key);
    const res = v.result;
    const items = [];
    const flyers = [];
    const labels = [];
    const doraTypes = new Set(res.dora.map((d) => doraFromIndicator(tileType(d))));
    let t = WIN.fallAt;
    // first every winner's hand stands and falls over, then each one gets its dora row
    const rows = res.wins.map((w) => {
      const r = rel(w.seat);
      const ids = [...w.hand, w.winTile];
      const x0 = r === 0 ? 10 : 12;
      // a ron tile comes from the pond (it was never in the hand)
      const pond = !w.tsumo ? objects.get(`t${w.winTile}`) : null;
      const hand = ids.map((id, i) => {
        const last = i === ids.length - 1;
        const it = revealTile(r, id, rowX(x0, i) + (last ? 0.35 : 0), true, r === 0 ? i * WIN.placeGap : 0, t + i * WIN.tileMs);
        it.win = last;
        if (last && pond) {
          it.fly = { path: makePath({ p: pond.obj.position.clone(), q: pond.obj.quaternion.clone() }, it.tip.target), hide: `t${w.winTile}` };
          // it lands as the tile before it falls
          it.fallAt = t + (i - 1) * WIN.tileMs + WIN.dropMs * 0.5;
        }
        items.push(it);
        return it;
      });
      t += ids.length * WIN.tileMs + WIN.dropMs + 300;
      return { w, r, x0, hand };
    });
    const doraAt = t;
    for (const { w, r, x0, hand } of rows) {
      // the row lies just in front of the revealed hand and its calls
      // (towards their owner)
      const z = Math.max(revealZ(true) + H + 0.22, winMeldZ(v, w.seat) + H + 0.12);
      const ura = w.ura || [];
      const uraTypes = new Set(ura.map((d) => doraFromIndicator(tileType(d))));
      let x = fx(x0);
      const lbl = (text, color, at) => {
        addLabel(labels, r, x + 0.95, z, text, color, at);
        x += 1.9 + 0.2;
      };
      const flyer = (id, from, n, at, kind) => {
        const mesh = makeTile(id);
        mesh.visible = false;
        scene.add(mesh);
        const target = place(r, x + W / 2, D / 2, z, 'up');
        flyers.push({ mesh, path: makePath(from, target), at: at + n * WIN.flyGap, kind, seat: w.seat });
        x += PITCH;
      };
      lbl('Dora', '#ffd75a', t);
      res.dora.forEach((id, i) => {
        const o = objects.get(`t${id}`);
        const from = o ? { p: o.obj.position.clone(), q: o.obj.quaternion.clone() } : slotPose(v, deadSlot(4 + i), rel);
        flyer(id, from, i, t, 'dora');
        // the indicator itself leaves the dead wall (a second winner's row
        // gets a copy, the tile is already gone)
        if (w === rows[0].w) flyers[flyers.length - 1].hide = `t${id}`;
      });
      t += res.dora.length * WIN.flyGap + WIN.flyMs;
      const doraLit = t;
      if (ura.length) {
        x += 0.4;
        lbl('Ura', '#ff8ad8', t);
        ura.forEach((id, i) => {
          const slot = deadSlot(9 + i);
          flyer(id, slotPose(v, slot, rel), i, t, 'ura');
          flyers[flyers.length - 1].slot = slot;
        });
        t += ura.length * WIN.flyGap + WIN.flyMs;
      }
      // light up the tiles of the hand they make dora (red fives with the dora)
      for (const it of hand) {
        const ty = tileType(it.id);
        if (doraTypes.has(ty) || isAka(it.id)) it.glow = { at: doraLit, color: DORA_GLOW };
        if (uraTypes.has(ty)) it.glow = { at: t, color: it.glow ? DORA_GLOW : URA_GLOW };
      }
      t += 350;
    }
    // the score screen then frames the first winner's hand, calls and dora row
    const first = rows[0];
    const framed = [
      ...first.hand.map((it) => it.tip.target.p),
      ...flyers.filter((f) => f.seat === first.w.seat).map((f) => f.path.pts[f.path.pts.length - 1]),
      ...first.w.melds.flatMap((m) => m.tiles).map((id) => objects.get(`t${id}`)).filter(Boolean).map((o) => o.target.p),
    ];
    const frame = handFrame(first.r, framed);
    win = { key, t0: performance.now(), items, flyers, labels, doraAt, doneAt: t + WIN.holdMs, res, phase: 'tiles', frame };
    // the winners' concealed hands and my overlay hand make way for the reveal
    if (res.wins.some((w) => w.seat === v.seat)) hand.layout(v, ui, 0);
    world.forceView('overview');
  }

  // Exhaustive draw: every hand tips over at once, tile by tile; tenpai
  // hands face up with a テンパイ label, noten hands face down with ノーテン.
  function syncDraw(v, ui, rel, key) {
    const res = v.result;
    const items = [];
    const labels = [];
    const tenpai = new Set(res.tenpai || []);
    v.players.forEach((p, abs) => {
      const r = rel(abs);
      const up = tenpai.has(abs);
      const ids = up ? res.hands[abs] || [] : abs === v.seat ? v.hand : Array.from({ length: p.handCount }, () => null);
      const x0 = r === 0 ? 10 : 12;
      ids.forEach((id, i) => {
        items.push(revealTile(r, id, rowX(x0, i), up, r === 0 ? i * WIN.placeGap : 0, DRAW.startMs + i * DRAW.tileMs));
      });
      const z = up ? revealZ(true) + H / 2 + 0.6 : revealZ(false) - H / 2 - 0.55;
      addLabel(labels, r, fx(x0) + ids.length * PITCH + 1.3, z, up ? 'Tenpai' : 'Noten', up ? '#ffd75a' : '#c8d2dc', DRAW.startMs + ids.length * DRAW.tileMs + WIN.dropMs);
    });
    const last = Math.max(0, ...items.map((it) => it.fallAt));
    win = { key, t0: performance.now(), items, flyers: [], labels, doraAt: Infinity, doneAt: last + WIN.dropMs + DRAW.holdMs, res, phase: 'dora' };
    hand.layout(v, ui, 0);
    world.forceView('overview');
  }

  function stepWin() {
    if (!win) return;
    const e = performance.now() - win.t0;
    for (const it of win.items) {
      let done;
      if (it.fly) {
        // the ron tile: out of the pond, over everything, down in its place
        if (e < it.fallAt) continue;
        const pond = objects.get(it.fly.hide);
        if (pond) pond.obj.visible = false;
        it.mesh.visible = true;
        const dist = ((e - it.fallAt) / 1000) * FAST;
        poseAt(it.fly.path, dist, it.mesh);
        done = dist >= it.fly.path.total;
      } else {
        if (e < it.standAt) continue;
        it.mesh.visible = true;
        if (e < it.fallAt) {
          // standing; mine is set down on the table first
          tipPose(it.tip, 0, it.mesh);
          const set = it.placed ? Math.min(1, (e - it.standAt) / WIN.placeMs) : 1;
          it.mesh.position.y += (1 - set) * 0.8;
          kit.style(it.mesh, 1, 0);
          continue;
        }
        // falling over, faster and faster
        const u = Math.min(1, (e - it.fallAt) / WIN.dropMs);
        tipPose(it.tip, u * u, it.mesh);
        done = u >= 1;
      }
      const glow = it.glow && e >= it.glow.at ? it.glow.color : it.win && done ? kit.glowColor() : 0;
      kit.style(it.mesh, 1, glow);
    }
    if (e >= win.doraAt) {
      // re-applied every frame: view updates restyle the table tiles
      for (const id of win.res.dora) {
        const o = objects.get(`t${id}`);
        if (o) kit.style(o.obj, 1, DORA_GLOW);
      }
    }
    if (e >= win.doraAt && win.phase === 'tiles') {
      win.phase = 'dora';
      winListener({ phase: 'dora', result: win.res });
    }
    for (const l of win.labels) l.mesh.visible = e >= l.at;
    for (const it of win.flyers) {
      if (e < it.at) continue;
      it.mesh.visible = true;
      // the tile it lifts out of the dead wall is not left behind
      const left = it.slot !== undefined ? objects.get(`w${it.slot}`) : it.hide ? objects.get(it.hide) : null;
      if (left) left.obj.visible = false;
      // up out of the wall, across above everything, down into the row
      // (an ura dora starts face down, so it turns over as it rises)
      const u = Math.min(1, (e - it.at) / WIN.flyMs);
      poseAt(it.path, u * it.path.total, it.mesh);
      kit.style(it.mesh, 1, u >= 1 ? (it.kind === 'ura' ? URA_GLOW : DORA_GLOW) : 0);
    }
    if (e >= win.doneAt && win.phase === 'dora') {
      win.phase = 'done';
      // a win: close on the hand, from behind its owner (the score sheet
      // covers the top of the screen); a draw keeps the whole table
      world.forceView(win.frame || 'overview');
      // my own standing hand leaves the screen to the score sheet
      if (lastView) hand.layout(lastView[0], {}, 0);
      winListener({ phase: 'done' });
    }
  }

  // ----------------------------------------------------- riichi sticks
  // The server only marks a riichi once its discard went through without a
  // ron, so the stick is placed exactly when "nobody called".
  const stickGeo = new THREE.BoxGeometry(3.1, 0.1, 0.38);
  const stickSide = new THREE.MeshPhongMaterial({ color: 0xd8d6cc, shininess: 20 });
  const sticks = new Map(); // seat -> { mesh, target }

  // ------------------------------------------------------ points drawer
  // A drawer slides out of the player's edge of the table with their point
  // sticks in it (10000, 5000, 1000 and 100 compartments) while the camera
  // looks down at it; the HUD then shows everyone's score.
  // Point sticks as in a traditional Japanese set (white, painted dots):
  // 100 = eight black dots in two rows; 1000 = one red dot; 5000 = a big red
  // dot with four small ones in a square; 10000 = the same, a small red dot
  // to each side and a big black dot towards each end. [colour, x, y, r] on
  // a 512 x 64 texture, centred.
  const RED = '#c8151f';
  const BLACK = '#1c1414';
  const quincunx = [[RED, 0, 0, 10], ...[[-22, -11], [22, -11], [-22, 11], [22, 11]].map(([x, y]) => [RED, x, y, 5.5])];
  const STICK_DOTS = {
    100: [-33, -11, 11, 33].flatMap((x) => [[BLACK, x, -10, 6], [BLACK, x, 10, 6]]),
    1000: [[RED, 0, 0, 9]],
    5000: quincunx,
    10000: [...quincunx, [RED, -46, 0, 5.5], [RED, 46, 0, 5.5], [BLACK, -92, 0, 10], [BLACK, 92, 0, 10]],
  };
  const stickMats = {};
  for (const [value, dots] of Object.entries(STICK_DOTS)) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#dfe4e6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 64);
    for (const [color, x, y, r] of dots) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(256 + x, 32 + y, r, 0, Math.PI * 2);
      g.fill();
      // a little shine: the dots are glossy paint in a shallow hole
      g.fillStyle = 'rgba(255, 255, 255, .35)';
      g.beginPath();
      g.arc(256 + x - r * 0.3, 32 + y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const top = new THREE.MeshPhongMaterial({ map: t, shininess: 20 });
    stickMats[value] = [stickSide, stickSide, top, stickSide, stickSide, stickSide];
  }
  const DRAWER = { w: 8, d: 3, h: 0.8, wall: 0.12, closedZ: 12.2, openZ: 15.5, y: -0.9, speed: 7 };
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 });
  const drawer = new THREE.Group();
  {
    const box = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), drawerMat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      drawer.add(m);
    };
    const { w, d, h, wall } = DRAWER;
    box(w, wall, d, 0, -h / 2 + wall / 2, 0); // bottom
    box(wall, h, d, -w / 2 + wall / 2, 0, 0);
    box(wall, h, d, w / 2 - wall / 2, 0, 0);
    box(w, h, wall, 0, 0, -d / 2 + wall / 2);
    box(w, h * 1.15, wall * 1.6, 0, 0.04, d / 2 - wall * 0.8); // front, a little taller
    for (const x of [-w / 4, 0, w / 4]) box(0.06, h * 0.7, d - 2 * wall, x, -0.08, 0); // compartments
  }
  drawer.position.set(0, DRAWER.y, DRAWER.closedZ);
  drawer.visible = false;
  scene.add(drawer);
  const drawerSticks = new THREE.Group();
  drawer.add(drawerSticks);
  const drawerStickGeo = new THREE.BoxGeometry(2.55, 0.08, 0.32);
  let drawerState = { open: false, goal: DRAWER.closedZ, shown: null };
  let pointsListener = () => {};

  // Sticks like a real tray: 25000 is 1 x 10000, 2 x 5000, 4 x 1000 and
  // 10 x 100; more points go to 10000s, small change stays in 1000s/100s.
  function stickCounts(score) {
    let r = Math.max(0, Math.round(score / 100) * 100);
    const n10k = Math.max(0, Math.floor((r - 15000) / 10000));
    r -= n10k * 10000;
    const n5k = Math.min(2, Math.floor(r / 5000));
    r -= n5k * 5000;
    const n1k = r >= 1000 ? Math.floor((r - 1000) / 1000) : 0;
    r -= n1k * 1000;
    return [n10k, n5k, n1k, r / 100];
  }
  function fillDrawer(score) {
    drawerSticks.clear();
    const counts = stickCounts(score);
    [10000, 5000, 1000, 100].forEach((value, c) => {
      const n = counts[c];
      const cx = (c - 1.5) * (DRAWER.w / 4);
      for (let j = 0; j < Math.min(n, 30); j++) {
        const m = new THREE.Mesh(drawerStickGeo, stickMats[value]);
        m.rotation.y = Math.PI / 2;
        // side by side, centred in the compartment, five to a layer
        const cols = Math.min(n, 5);
        m.position.set(cx + ((j % 5) - (cols - 1) / 2) * 0.36, -DRAWER.h / 2 + DRAWER.wall + 0.04 + Math.floor(j / 5) * 0.085, 0);
        m.castShadow = true;
        drawerSticks.add(m);
      }
    });
  }
  // onShown: called once the drawer is out and the camera is on it
  function openPoints(v, onShown) {
    if (intro || win || !v) return false;
    fillDrawer(v.players[v.seat].score);
    drawer.visible = true;
    drawerState = { open: true, goal: DRAWER.openZ, shown: onShown };
    world.forceView('drawer');
    // my hand steps aside while I look at the drawer
    hand.layout(v, {}, 0);
    return true;
  }
  function closePoints() {
    if (!drawerState.open) return;
    drawerState = { open: false, goal: DRAWER.closedZ, shown: null };
    world.forceView(intro || win ? 'overview' : null);
    if (lastView && !intro && !win) update(...lastView);
    pointsListener({ open: false });
  }
  world.onTick((dt) => {
    if (!drawer.visible) return;
    const z = drawer.position.z;
    const step = DRAWER.speed * dt;
    drawer.position.z = Math.abs(drawerState.goal - z) <= step ? drawerState.goal : z + Math.sign(drawerState.goal - z) * step;
    if (drawer.position.z === drawerState.goal) {
      if (drawerState.open && drawerState.shown) {
        drawerState.shown();
        drawerState.shown = null;
      }
      if (!drawerState.open) drawer.visible = false;
    }
  });
  function syncSticks(v, rel) {
    v.players.forEach((p, abs) => {
      let st = sticks.get(abs);
      // on the felt in front of the player
      const target = place(rel(abs), 0, 0.06, 2.7, 'stand');
      if (st && p.riichi && !samePose(st.target, target)) {
        st.path = makePath({ p: st.mesh.position.clone(), q: st.mesh.quaternion.clone() }, target, { hy: null, turnAll: true });
        st.dist = 0;
        st.target = target;
      }
      if (p.riichi && !st) {
        const mesh = new THREE.Mesh(stickGeo, stickMats[1000]); // a riichi stick is a 1000
        mesh.castShadow = true;
        // tossed in from above the player's side, turning into place
        const from = { p: place(rel(abs), 0.8, 4.5, 4.6, 'stand').p, q: target.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.4)) };
        mesh.position.copy(from.p);
        mesh.quaternion.copy(from.q);
        scene.add(mesh);
        // it comes in once the riichi discard has landed
        st = { mesh, target, path: makePath(from, target, { hy: null, turnAll: true }), dist: 0, wait: laneWait() };
        mesh.visible = false;
        sticks.set(abs, st);
      } else if (!p.riichi && st) {
        scene.remove(st.mesh);
        sticks.delete(abs);
      }
    });
  }

  world.onTick((dt) => {
    for (const o of objects.values()) {
      if (o.path && o.wait > 0) o.wait -= dt * 1000;
      else if (o.path) {
        o.obj.visible = true;
        o.dist += o.path.speed * dt;
        poseAt(o.path, o.dist, o.obj);
        if (o.dist >= o.path.total) o.path = null;
      }
      updateBlob(o);
    }
    for (const st of sticks.values()) {
      if (st.wait > 0) {
        st.wait -= dt * 1000;
        continue;
      }
      st.mesh.visible = true;
      if (!st.path) continue;
      st.dist += SPEED * 0.6 * dt;
      poseAt(st.path, st.dist, st.mesh);
      if (st.dist >= st.path.total) st.path = null;
    }
    stepWin();
    placeCallouts();
  });

  // --------------------------------------------------------------- layout
  function slotPose(v, slot, rel) {
    const w = v.wall;
    const c = (w.breakStack + (slot >> 1)) % (4 * STACKS);
    const seat = (4 - Math.floor(c / STACKS)) % 4;
    const j = STACKS - 1 - (c % STACKS);
    const top = (slot & 1) === 0;
    return place(rel(seat), fx(12) - (STACKS - 1) * GAP + j * PITCH + W / 2, top ? D * 1.5 : D * 0.5, fz(82) + H / 2, 'down');
  }

  function update(v, ui) {
    me = v.seat;
    const rel = (abs) => (abs - me + 4) % 4;
    const desired = new Map();
    const spawns = new Map();
    const put = (key, id, target, flags, lane) => desired.set(key, { id, target, flags, lane });
    const prevPos = (key) => {
      const o = objects.get(key);
      return o ? { p: o.obj.position.clone(), q: o.obj.quaternion.clone() } : null;
    };

    // wall: every slot still in place is a face-down tile; revealed dora face up
    const w = v.wall;
    if (w) {
      const rinshan = new Set();
      for (let r = 0; r < w.pops; r++) rinshan.add(deadSlot(r));
      const dora = new Map();
      for (let i = 0; i < w.doraCount; i++) dora.set(deadSlot(4 + i), v.dora[i]);
      for (let slot = 0; slot < 136; slot++) {
        if (slot < w.liveTaken || (slot >= 122 - w.pops && slot < 122) || rinshan.has(slot)) continue;
        const pose = slotPose(v, slot, rel);
        if (dora.has(slot)) {
          const flipped = { p: pose.p.clone().setY(D * 1.5), q: pose.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)) };
          put(`t${dora.get(slot)}`, dora.get(slot), flipped, null, 'call');
          // a new indicator turns over in place (the intro already turned the first one)
          if (dora.get(slot) !== introFlipped) spawns.set(`t${dora.get(slot)}`, pose);
        } else put(`w${slot}`, null, pose);
      }
    }
    const drawSlot = w && w.lastDraw && w.lastDraw.n !== ui.lastDraw3d ? w.lastDraw : null;
    if (w && w.lastDraw) ui.lastDraw3d = w.lastDraw.n;

    const laid = laidDown(v);
    v.players.forEach((p, abs) => {
      const r = rel(abs);
      // opponents' hands (the player's own hand is the screen overlay);
      // a winner's concealed hand is replaced by the face-up reveal
      if (r !== 0 && !laid.has(abs)) {
        for (let i = 0; i < p.handCount; i++) put(`h${abs}:${i}`, null, place(r, rowX(12, i), H / 2, fz(95), 'stand'));
        if (p.hasDrawn) {
          put(`h${abs}:d`, null, place(r, rowX(12, p.handCount) + 0.35, H / 2, fz(95), 'stand'), null, 'draw');
          if (drawSlot && drawSlot.seat === abs) spawns.set(`h${abs}:d`, slotPose(v, drawSlot.slot, rel));
        }
      }
      // pond (called tiles leave it; the tile after a called riichi tile goes sideways)
      let sideNext = false;
      let col = 0;
      let row = 0;
      let x = fx(36.1);
      const visible = [];
      for (const d of p.discards) {
        if (d.called) {
          if (d.riichi) sideNext = true;
          continue;
        }
        const side = d.riichi || sideNext;
        if (side) sideNext = false;
        visible.push({ ...d, side });
      }
      const last = [...v.events].reverse().find((e) => e.type === 'discard' || e.type === 'riichi');
      visible.forEach((d) => {
        if (col === 6 && row < 2) {
          row++;
          col = 0;
          x = fx(36.1);
        }
        const width = d.side ? H : W;
        const z0 = fz(63.4) + row * (H + 0.16);
        const target = place(r, x + width / 2, D / 2, d.side ? z0 + H - W / 2 : z0 + H / 2, d.side ? 'side' : 'up');
        x += width + 0.1;
        col++;
        const key = `t${d.tile}`;
        put(key, d.tile, target, { tg: d.tsumogiri, last: last && last.tile === d.tile }, objects.has(key) ? null : r === 0 ? 'mine' : 'discard');
        // a discard lies down flat as soon as it leaves the hand (a riichi
        // discard lies down sideways), crosses over the wall and drops in
        if (!objects.has(key) && r === 0) {
          // my discards come in from the hand overlay at the bottom of the screen
          spawns.set(key, place(0, target.p.x * 0.6, 2.6, fz(104), 'stand'));
        } else if (!objects.has(key)) {
          // opponents' discards leave from their hand: drawn slot for tsumogiri, else inside the hand
          const from = d.tsumogiri ? prevPos(`h${abs}:d`) : prevPos(`h${abs}:${d.tile % Math.max(1, p.handCount)}`);
          if (from) spawns.set(key, from);
        }
      });
      // melds, right-justified next to the hand, first meld outermost; a
      // winner's slide into the line of the laid-down hand (the dora row goes
      // in front of both). Not in a draw: with every hand laid down, they
      // would run into the next player's hand at the corner.
      let mx = fx(r === 0 ? 98 : 97);
      const meldZ = isAgari(v) && laid.has(abs) ? winMeldZ(v, abs) : fz(95);
      p.melds.forEach((m) => {
        const relFrom = (m.from - abs + 4) % 4;
        let parts;
        if (m.type === 'ankan') parts = m.tiles.map((id, i) => ({ id, pose: i === 0 || i === 3 ? 'down' : 'up' }));
        else {
          const others = m.tiles.filter((t) => t !== m.called && t !== m.added).map((id) => ({ id, pose: 'up' }));
          const pos = relFrom === 3 ? 0 : relFrom === 2 ? 1 : others.length;
          others.splice(pos, 0, { id: m.called, pose: 'side', added: m.added });
          parts = others;
        }
        for (let i = parts.length - 1; i >= 0; i--) {
          const t = parts[i];
          const width = t.pose === 'side' ? H : W;
          mx -= width;
          const z = meldZ + (t.pose === 'side' ? H / 2 - W / 2 : 0);
          put(`t${t.id}`, t.id, place(r, mx + width / 2, D / 2, z, t.pose), null, 'call');
          if (t.added !== undefined) put(`t${t.added}`, t.added, place(r, mx + width / 2, D * 1.5, z, 'side'), null, 'call');
          mx -= GAP + 0.02;
        }
        mx -= 0.35;
      });
    });

    sync(desired, spawns);
    syncSticks(v, rel);
    syncRestDice(v);
    syncWin(v, ui, rel);

    // highlights: tsumogiri tiles dimmer, the latest discard glowing
    for (const ob of objects.values()) {
      kit.style(ob.obj, ob.flags.tg ? 0.8 : 1, ob.flags.last ? kit.glowColor() : 0);
    }
    // my hand: a freshly drawn tile flies in from its wall slot
    let spawn = null;
    if (drawSlot && drawSlot.seat === v.seat && v.drawn !== null) {
      const p = slotPose(v, drawSlot.slot, rel).p.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      spawn = { id: v.drawn, x: ((p.x + 1) / 2) * rect.width, y: ((p.y + 1) / 2) * rect.height, wait: laneWait() };
      laneEnd = performance.now() + spawn.wait + 90; // its flight to the hand
    }
    const away = drawerState.open || (win && win.phase === 'done');
    if (!laidDown(v).has(v.seat)) hand.layout(v, ui, away ? 0 : Infinity, spawn);
  }

  let lastView = null;

  // ------------------------------------------------------------ callouts
  const anchors = [0, 1, 2, 3].map((r) => new THREE.Vector3(0, 2.2, fz(76)).applyQuaternion(qSeat[r]));
  let calloutEls = [];
  let relOf = () => 0;
  function placeCallouts() {
    if (!calloutEls.length) return;
    const rect = renderer.domElement.getBoundingClientRect();
    for (const el of calloutEls) {
      const p = anchors[relOf(Number(el.dataset.seat))].clone().project(camera);
      el.style.left = `${((p.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((1 - p.y) / 2) * rect.height}px`;
    }
  }


  // ------------------------------------------------------------ hand intro
  // At the start of every hand the server pauses the clocks (view.intro) and
  // the table plays: 1) shuffle face down, 2) build the walls a little outward
  // and push them into place, 3) throw the dice into the middle and then
  // set them together at the dealer's right, 4) deal in blocks of four
  // (4-4-4 then 1, plus the dealer's draw) and flip the dora indicator. It
  // uses its own temporary tiles that end exactly where the normal view puts
  // them, so the hand-over is seamless. Tiles never pass through each other:
  // the shuffle is a small collision simulation (shuffle.js), and every move
  // over other tiles lifts first, travels high enough to clear them and only
  // then comes down.
  const PHASES = { shuffle: [0, 0.3], build: [0.3, 0.48], push: [0.48, 0.55], dice: [0.55, 0.77], deal: [0.77, 0.97], flip: [0.95, 1] };
  // within the dice phase: the throw, a moment lying where they fell, then
  // they are picked up and set together at the dealer's right
  const DICE = { landed: 0.6, pickUp: 0.7 };
  const span = (p, [a, b]) => (p - a) / (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // The tiles spin in a disc over the whole middle of the table first, then
  // the pile is pushed together (and squared up) inside the line where the
  // walls get built.
  const PILE = { radius: 10.8, open: 13, closed: 10.2, squeeze: [0.2, 0.3] };
  const PRE_OUT = 2.6; // walls are built this far outside their final place
  const buildStart = (t) => PHASES.build[0] + t.order * 0.15;
  let intro = null;
  let introKey = '';
  let introListener = () => {};

  const pipTexture = (n) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fbfdff';
    g.fillRect(0, 0, 128, 128);
    const spots = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]], 4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]], 6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]] }[n];
    for (const [x, y] of spots) {
      g.fillStyle = n === 1 ? '#e0242f' : '#14365a';
      g.beginPath();
      g.arc(x, y, n === 1 ? 20 : 12, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (opposite faces add up to 7)
  const DIE_FACES = [3, 4, 1, 6, 2, 5];
  const DIE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((n) => new THREE.Vector3(...n));
  const dieMats = DIE_FACES.map((n) => new THREE.MeshPhysicalMaterial({ map: pipTexture(n), roughness: 0.4, clearcoat: 0.3 }));
  const DIE = 0.45;
  const dieGeo = new RoundedBoxGeometry(DIE, DIE, DIE, 3, 0.07);

  // Where the dice come to rest, in the dealer's frame: together on the felt
  // at the dealer's right, clear of every pond, where they stay for the whole
  // hand to show who deals. The turn is fixed per hand so the thrown dice and the
  // resting ones match.
  function diceRest(v, i) {
    const dealerRel = (v.dealer - v.seat + 4) % 4;
    // side by side and squared with each other (a quarter turn keeps them so)
    const local = new THREE.Vector3(5 + (i ? 1 : -1) * (DIE / 2 + 0.02), DIE / 2, 4.6);
    const up = DIE_NORMALS[DIE_FACES.indexOf(v.wall.dice[i])];
    const yaw = (((v.round * 7 + v.kyokuNum * 13 + v.honba * 5 + i * 3) % 4) * Math.PI) / 2;
    const q = qSeat[dealerRel].clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw))
      .multiply(new THREE.Quaternion().setFromUnitVectors(up, Y_AXIS));
    return { p: local.applyQuaternion(qSeat[dealerRel]), q };
  }
  let restDice = { key: '', meshes: [] };
  let introFlipped = null; // dora indicator the intro turned face up
  function syncRestDice(v) {
    const key = v.wall && v.phase !== 'end' ? `${resultKey(v)}:${v.wall.dice.join('')}:${v.seat}` : '';
    if (key === restDice.key) return;
    for (const m of restDice.meshes) scene.remove(m);
    restDice = { key, meshes: [] };
    if (!key) return;
    restDice.meshes = v.wall.dice.map((_, i) => {
      const m = new THREE.Mesh(dieGeo, dieMats);
      m.castShadow = true;
      const rest = diceRest(v, i);
      m.position.copy(rest.p);
      m.quaternion.copy(rest.q);
      scene.add(m);
      return m;
    });
  }

  function startIntro(v, ui) {
    closePoints();
    clearWin();
    const rel = (abs) => (abs - v.seat + 4) % 4;
    const total = v.intro.total;
    // drop what is on the table from the previous hand
    for (const [key, o] of objects) {
      scene.remove(o.obj);
      kit.dispose(o.obj);
      if (o.blob) {
        scene.remove(o.blob);
        o.blob.material.dispose();
      }
      objects.delete(key);
    }
    if (v.wall && v.wall.lastDraw) ui.lastDraw3d = v.wall.lastDraw.n;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pile = createShuffle({ count: 136, hw: W / 2, hh: H / 2, ring: [0, PILE.radius], square: PILE.open, panel: 0 });
    syncRestDice({ ...v, wall: null });
    introFlipped = v.dora[0];
    // the previous hand's riichi sticks were paid out
    for (const st of sticks.values()) scene.remove(st.mesh);
    sticks.clear();
    const tiles = [];
    for (let slot = 0; slot < 136; slot++) {
      const isDora = slot === deadSlot(4);
      const obj = makeTile(isDora ? v.dora[0] : null);
      scene.add(obj);
      const final = slotPose(v, slot, rel);
      const stack = (v.wall.breakStack + (slot >> 1)) % (4 * STACKS);
      const ownerRel = rel((4 - Math.floor(stack / STACKS)) % 4);
      const outward = new THREE.Vector3(0, 0, PRE_OUT).applyQuaternion(qSeat[ownerRel]);
      const top = (slot & 1) === 0;
      tiles.push({
        obj,
        slot,
        isDora,
        sim: pile.tiles[slot],
        pre: { p: final.p.clone().add(outward), q: final.q },
        final,
        // build order: walls fill stack by stack from their left end, the
        // bottom tile of a stack first so the top one lands on it
        order: ((STACKS - 1 - (stack % STACKS)) + (top ? 0.5 : 0)) / STACKS,
      });
    }
    // deal schedule: blocks of 4 (two stacks) three times round, then singles, then the dealer's draw
    const deal = [];
    const handTarget = (abs, i) => {
      const r = rel(abs);
      if (r === 0) return { p: place(0, (i - 6.5) * 0.9, 6, fz(112), 'stand').p, q: place(0, 0, 0, 0, 'stand').q, mine: true };
      return place(r, rowX(12, i) + (i === 13 ? 0.35 : 0), H / 2, fz(95), 'stand');
    };
    let slot = 0;
    const order = [0, 1, 2, 3].map((i) => (v.dealer + i) % 4);
    for (let round = 0; round < 3; round++) {
      for (const abs of order) {
        deal.push({ slots: [slot, slot + 1, slot + 2, slot + 3], abs, first: round * 4 });
        slot += 4;
      }
    }
    for (const abs of order) deal.push({ slots: [slot++], abs, first: 12 });
    deal.push({ slots: [slot++], abs: v.dealer, first: 13 });
    deal.forEach((d, n) => {
      d.t0 = PHASES.deal[0] + (n / deal.length) * (PHASES.deal[1] - PHASES.deal[0] - 0.02);
      d.slots.forEach((sl, k) => {
        const t = tiles[sl];
        // consecutive blocks are in the air together: each flies at its own height
        t.deal = { t0: d.t0, dur: 0.06, lift: 2.2 + (n % 3) * 0.7, to: handTarget(d.abs, d.first + k), mine: rel(d.abs) === 0 };
      });
    });
    // dice: the dealer throws them into the middle of the table, a
    // different way every hand, and they land showing the real roll at any
    // angle; then they are lifted and set side by side at the dealer's right
    const dealerRel = rel(v.dealer);
    const toWorld = (vec) => vec.applyQuaternion(qSeat[dealerRel]);
    const from0 = new THREE.Vector3(rnd(-1.5, 3.5), 3.2, 8.4); // over the dealer's wall
    const aim = new THREE.Vector3(rnd(-2.2, 2.2), 0, rnd(-2, 1.5));
    const dir = aim.clone().sub(from0).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const dice = v.wall.dice.map((value, i) => {
      const m = new THREE.Mesh(dieGeo, dieMats);
      m.castShadow = true;
      scene.add(m);
      const rest = diceRest(v, i);
      const from = toWorld(from0.clone().addScaledVector(side, i ? 0.3 : -0.3));
      const land = toWorld(aim.clone()
        .addScaledVector(side, (i ? 0.55 : -0.55) + rnd(-0.2, 0.2))
        .addScaledVector(dir, rnd(-0.7, 0.7))
        .setY(DIE / 2));
      const up = DIE_NORMALS[DIE_FACES.indexOf(value)];
      const landQ = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rnd(0, Math.PI * 2))
        .multiply(new THREE.Quaternion().setFromUnitVectors(up, Y_AXIS));
      return {
        m, from, land, landQ,
        gather: makePath({ p: land, q: landQ }, rest, { hy: DIE / 2 + 1.4, turnAll: true }),
        axis: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(),
        turns: rnd(4, 7),
      };
    });
    world.forceView('overview');
    intro = { t0: performance.now() - (total - v.intro.left), total, tiles, dice, pile, myDealt: -1, v, ui };
    hand.layout(v, ui, 0);
    introListener({ active: true, myTiles: 0 });
  }

  function stepIntro(dt) {
    if (!intro) return;
    const p = Math.min(1, (performance.now() - intro.t0) / intro.total);
    const tmpQ = new THREE.Quaternion();
    let myTiles = 0;
    if (p < PHASES.push[0]) {
      const q = clamp01(span(p, PILE.squeeze));
      intro.pile.setArea({ ring: [0, PILE.radius + q * 5], square: PILE.open - q * (PILE.open - PILE.closed) });
      for (const t of intro.tiles) t.sim.active = p < buildStart(t);
      // the swirl slows down and squares the pile up before the walls are built
      intro.pile.step(dt || 1 / 60, 1 - q * 0.75, q);
    }
    for (const t of intro.tiles) {
      const o = t.obj;
      if (t.deal && p >= t.deal.t0) {
        // dealing: up clear of the walls, across, down at the hand
        const u = clamp01((p - t.deal.t0) / t.deal.dur);
        t.deal.path ||= makePath(t.final, t.deal.to, { hy: t.deal.lift });
        poseAt(t.deal.path, u * t.deal.path.total, o);
        o.visible = !(t.deal.mine && u >= 1);
        if (t.deal.mine && u >= 1) myTiles++;
        continue;
      }
      if (p < buildStart(t)) {
        // shuffling: lying face down where the simulation put it
        o.position.set(t.sim.x, D / 2, t.sim.z);
        o.quaternion.copy(qLocal.down).premultiply(tmpQ.setFromAxisAngle(Y_AXIS, t.sim.yaw));
        continue;
      }
      if (p < PHASES.push[0]) {
        // building: out of the pile (over its other tiles) into a line a
        // little outside its final place
        t.build ||= makePath({ p: o.position.clone(), q: o.quaternion.clone() }, t.pre, { hy: Math.max(o.position.y, t.pre.p.y) + 0.8 });
        poseAt(t.build, clamp01((p - buildStart(t)) / 0.05) * t.build.total, o);
        continue;
      }
      // pushing the walls in, then (dora) turning face up
      o.position.lerpVectors(t.pre.p, t.final.p, clamp01(span(p, PHASES.push)));
      o.quaternion.copy(t.pre.q);
      if (t.isDora && p > PHASES.flip[0]) {
        t.flip ||= makePath(t.final, { p: t.final.p.clone().setY(D * 1.5), q: t.final.q.clone().multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)) });
        poseAt(t.flip, clamp01(span(p, PHASES.flip)) * t.flip.total, o);
      }
    }
    const diceU = clamp01(span(p, PHASES.dice));
    for (const d of intro.dice) {
      d.m.visible = p >= PHASES.dice[0];
      if (diceU < DICE.landed) {
        // the throw: sliding to a stop with three bounces, each lower, and
        // a roll that dies out on the real face
        const u = diceU / DICE.landed;
        d.m.position.lerpVectors(d.from, d.land, 1 - (1 - u) ** 2);
        d.m.position.y = d.land.y + Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) ** 1.5 * 1.6 + (1 - u) * (d.from.y - d.land.y) * 0.35;
        d.m.quaternion.copy(d.landQ).multiply(tmpQ.setFromAxisAngle(d.axis, (1 - u) ** 2 * d.turns * Math.PI * 2));
      } else {
        // picked up and set in place at the usual steady speed
        const at = PHASES.dice[0] + DICE.pickUp * (PHASES.dice[1] - PHASES.dice[0]);
        const secs = Math.max(0, p - at) * intro.total / 1000;
        poseAt(d.gather, secs * SPEED, d.m);
      }
    }
    if (myTiles !== intro.myDealt) {
      intro.myDealt = myTiles;
      hand.layout(...(intro.pending || [intro.v, intro.ui]), myTiles);
      introListener({ active: true, myTiles });
    }
    if (p >= 1) endIntro();
  }

  function endIntro() {
    for (const t of intro.tiles) {
      scene.remove(t.obj);
      kit.dispose(t.obj);
    }
    for (const d of intro.dice) scene.remove(d.m);
    const pending = intro.pending;
    intro = null;
    world.forceView(null);
    introListener({ active: false });
    if (pending) update(...pending);
  }
  world.onTick(stepIntro);

  // Mouse over the top half of the screen (or a touch there) shows the whole
  // table; the bottom half (or a touch there) goes back to the player view.
  const pickView = (y) => {
    // carrying a tile up to discard it does not move the camera
    if (!hand.dragging()) world.setView(y < window.innerHeight * 0.5 ? 'overview' : 'player');
  };
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pickView(e.clientY); });
  window.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') pickView(e.clientY); });

  return {
    update(v, ui) {
      relOf = (abs) => (abs - v.seat + 4) % 4;
      const key = `${v.round}-${v.kyokuNum}-${v.honba}`;
      if (v.intro && v.intro.left > 400 && v.wall && key !== introKey) {
        introKey = key;
        if (intro) endIntro();
        startIntro(v, ui);
      }
      if (intro) {
        intro.pending = [v, ui];
        return;
      }
      introKey = key;
      lastView = [v, ui];
      update(v, ui);
    },
    onIntro(cb) {
      introListener = cb;
    },
    onWin(cb) {
      winListener = cb;
    },
    openPoints,
    closePoints,
    onPoints(cb) {
      pointsListener = cb;
    },
    pointsOpen: () => drawerState.open,
    // discard with a single click (default: click to pick up, click again)
    setOneClick: hand.setOneClick,
    // keep the hand sorted (default) or as the player arranges it
    setAutoSort: hand.setAutoSort,
    // the camera view in use: 'player', 'overview', 'drawer' or 'free'
    onView: world.onView,
    setCallouts(els) {
      calloutEls = els;
    },
    // Screen position of a wall slot (where a drawn tile came from).
    slotOnScreen(v, slot) {
      if (!v.wall) return null;
      const p = slotPose(v, slot, (abs) => (abs - v.seat + 4) % 4).p.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    resize: world.fit,
  };
}
