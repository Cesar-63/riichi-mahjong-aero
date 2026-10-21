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
import { deadSlot, WIND_KANJI, tileType, isAka, doraFromIndicator } from '../shared/tiles.js';

const S = 1 / 4.1; // world units per 2.5D board unit
const fx = (x) => (x - 50) * S; // 2.5D board coords -> seat-local world coords
const fz = (y) => (y - 50) * S;
const STACKS = 17;
const SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const PITCH = W + GAP; // distance between neighbouring tiles in a row
// x of the i-th standing/lying tile of a hand row starting at the 2.5D x0
const rowX = (x0, i) => fx(x0) + i * PITCH + W / 2;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function createTable3D(container, theme = 'aero', { onPick } = {}) {
  const world = createWorld(container, theme);
  const { THREE, scene, camera, renderer, RoundedBoxGeometry } = world;

  // ---------------------------------------------------------------- assets
  const kit = createTileKit(renderer);
  const makeTile = kit.makeTile;
  const hand = createHand3D({ world, kit, onPick: (id) => onPick && onPick(id) });

  // -------------------------------------------------------------- transforms
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

  // ---------------------------------------------------------- object pool
  const objects = new Map(); // key -> { obj, target: {p, q}, lift }
  let me = 0;

  function sync(desired, spawns) {
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
    const onPanel = Math.abs(o.obj.position.x) < 3.3 && Math.abs(o.obj.position.z) < 3.3;
    const floor = onPanel ? 0.3 : 0;
    // only the lowest tile of a stack touches the table
    const lift = Math.max(0, bottom - floor);
    o.blob.position.set(o.obj.position.x, floor + 0.012, o.obj.position.z);
    o.blob.scale.set(ex * 1.35 + lift * 0.4, 1, ez * 1.35 + lift * 0.4);
    o.blob.material.opacity = lift > 0.5 ? 0 : 0.42 * (1 - lift / 0.5);
  }

  // ------------------------------------------------------- win reveal
  // Tetsuya style: after the "Tsumo!"/"Ron!" call the winner's tiles drop
  // face up one by one in front of them. Then the dora indicators fly from
  // the dead wall to a labelled row right in front of that hand, the ura
  // dora (riichi only) are lifted from under them, turned over and laid next
  // to them, and every tile of the hand they make dora lights up: gold for
  // dora and red fives, pink for ura dora. Listeners get { phase: 'dora',
  // result } and { phase: 'done' } (the score screen waits for 'done').
  const WIN = { callMs: 900, tileMs: 80, dropMs: 240, flyMs: 700, flyGap: 170, holdMs: 1500 };
  const DORA_GLOW = 0xffc83a;
  const URA_GLOW = 0xff5fc8;
  let win = null;
  let winListener = () => {};
  const resultKey = (v) => `${v.round}-${v.kyokuNum}-${v.honba}`;
  const isAgari = (v) => v.phase === 'result' && v.result && v.result.type === 'agari';

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
      g.font = 'bold 50px "Segoe UI", "Hiragino Sans", sans-serif';
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
  }

  function syncWin(v, ui, rel) {
    if (!isAgari(v)) {
      if (win) clearWin();
      return;
    }
    const key = resultKey(v);
    if (win && win.key === key) return;
    clearWin();
    const res = v.result;
    const items = [];
    const flyers = [];
    const labels = [];
    const doraTypes = new Set(res.dora.map((d) => doraFromIndicator(tileType(d))));
    let t = WIN.callMs;
    let doraAt = 0;
    let doneAt = 0;
    // first every winner's hand drops, then each one gets its dora row
    const rows = res.wins.map((w) => {
      const r = rel(w.seat);
      const ids = [...w.hand, w.winTile];
      const stand = place(r, 0, 0, 0, 'stand').q;
      const x0 = r === 0 ? 10 : 12;
      const hand = ids.map((id, i) => {
        const x = rowX(x0, i) + (i === ids.length - 1 ? 0.45 : 0);
        const mesh = makeTile(id);
        mesh.visible = false;
        scene.add(mesh);
        const it = { mesh, id, at: t + i * WIN.tileMs, target: place(r, x, D / 2, fz(93), 'up'), from: stand, win: i === ids.length - 1 };
        items.push(it);
        return it;
      });
      t += ids.length * WIN.tileMs + 450;
      return { w, r, x0, hand };
    });
    doraAt = t;
    for (const { w, r, x0, hand } of rows) {
      // the row lies just in front of the revealed hand (towards its owner)
      const z = fz(93) + H + 0.22;
      const ura = w.ura || [];
      const uraTypes = new Set(ura.map((d) => doraFromIndicator(tileType(d))));
      let x = fx(x0);
      const lbl = (text, color, at) => {
        x += 0.95;
        const mesh = tableLabel(text, color);
        const p = place(r, x, 0.02, z, 'stand');
        mesh.position.copy(p.p);
        mesh.quaternion.copy(p.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
        mesh.visible = false;
        scene.add(mesh);
        labels.push({ mesh, at });
        x += 0.95 + 0.2;
      };
      const flyer = (id, from, n, at, kind) => {
        const mesh = makeTile(id);
        mesh.visible = false;
        scene.add(mesh);
        flyers.push({ mesh, from, target: place(r, x + W / 2, D / 2, z, 'up'), at: at + n * WIN.flyGap, kind });
        x += PITCH;
      };
      lbl('ドラ', '#ffd75a', t);
      res.dora.forEach((id, i) => {
        const o = objects.get(`t${id}`);
        const from = o ? { p: o.obj.position.clone(), q: o.obj.quaternion.clone() } : slotPose(v, deadSlot(4 + i), rel);
        flyer(id, from, i, t, 'dora');
      });
      t += res.dora.length * WIN.flyGap + WIN.flyMs;
      const doraLit = t;
      if (ura.length) {
        x += 0.4;
        lbl('裏ドラ', '#ff8ad8', t);
        ura.forEach((id, i) => {
          const slot = deadSlot(9 + i);
          const from = slotPose(v, slot, rel);
          flyer(id, from, i, t, 'ura');
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
    doneAt = t + WIN.holdMs;
    win = { key, t0: performance.now(), items, flyers, labels, doraAt, doneAt, res, phase: 'tiles' };
    // the winners' concealed hands and my overlay hand make way for the reveal
    if (res.wins.some((w) => w.seat === v.seat)) hand.layout(v, ui, 0);
    world.forceView('overview');
  }

  const qa = new THREE.Quaternion();
  function stepWin() {
    if (!win) return;
    const e = performance.now() - win.t0;
    for (const it of win.items) {
      if (e < it.at) continue;
      it.mesh.visible = true;
      const u = Math.min(1, (e - it.at) / WIN.dropMs);
      const k = 1 - (1 - u) ** 3;
      it.mesh.position.copy(it.target.p);
      // falls over from standing, with a tiny bounce at the end
      it.mesh.position.y += (1 - k) * 1.6 + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.12 * (u > 0.85 ? 1 : 0);
      qa.copy(it.from).slerp(it.target.q, k);
      it.mesh.quaternion.copy(qa);
      const glow = it.glow && e >= it.glow.at ? it.glow.color : it.win && u >= 1 ? kit.glowColor() : 0;
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
      if (it.slot !== undefined) {
        const wallTile = objects.get(`w${it.slot}`);
        if (wallTile) wallTile.obj.visible = false;
      }
      const u = Math.min(1, (e - it.at) / WIN.flyMs);
      // lift out, carry high over the walls and hands, settle in the row
      const up = ease(u / 0.3) * ease((1 - u) / 0.3);
      const h = ease((u - 0.2) / 0.6);
      it.mesh.position.lerpVectors(it.from.p, it.target.p, h);
      it.mesh.position.y += up * 2.4;
      // (an ura dora starts face down, so it turns over in the air)
      it.mesh.quaternion.copy(it.from.q).slerp(it.target.q, h);
      kit.style(it.mesh, 1, u >= 1 ? (it.kind === 'ura' ? URA_GLOW : DORA_GLOW) : 0);
    }
    if (e >= win.doneAt && win.phase === 'dora') {
      win.phase = 'done';
      world.forceView(null);
      winListener({ phase: 'done' });
    }
  }

  // ----------------------------------------------------- riichi sticks
  // The server only marks a riichi once its discard went through without a
  // ron, so the stick is placed exactly when "nobody called".
  const stickTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#dfe4e6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#d4202c';
    g.beginPath();
    g.arc(256, 32, 20, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const stickGeo = new THREE.BoxGeometry(3.1, 0.1, 0.38);
  const stickTop = new THREE.MeshPhongMaterial({ map: stickTex, shininess: 50 });
  const stickSide = new THREE.MeshPhongMaterial({ color: 0xe8ecee, shininess: 50 });
  const sticks = new Map(); // seat -> { mesh, target }
  function syncSticks(v, rel) {
    v.players.forEach((p, abs) => {
      let st = sticks.get(abs);
      if (p.riichi && !st) {
        const mesh = new THREE.Mesh(stickGeo, [stickSide, stickSide, stickTop, stickSide, stickSide, stickSide]);
        mesh.castShadow = true;
        const target = place(rel(abs), 0, 0.36, 2.7, 'stand');
        // tossed in from above the player's side, spinning into place
        mesh.position.copy(place(rel(abs), 0.8, 4.5, 4.6, 'stand').p);
        mesh.quaternion.copy(target.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.4));
        scene.add(mesh);
        st = { mesh, target };
        sticks.set(abs, st);
      } else if (!p.riichi && st) {
        scene.remove(st.mesh);
        sticks.delete(abs);
      }
    });
  }

  const tmp = new THREE.Vector3();
  world.onTick((dt) => {
    const k = 1 - Math.exp(-dt * 11);
    for (const o of objects.values()) {
      const t = o.target;
      tmp.copy(t.p);
      o.obj.position.lerp(tmp, k);
      o.obj.quaternion.slerp(t.q, k);
      updateBlob(o);
    }
    const ks = 1 - Math.exp(-dt * 6);
    for (const st of sticks.values()) {
      st.mesh.position.lerp(st.target.p, ks);
      st.mesh.quaternion.slerp(st.target.q, ks);
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
    const put = (key, id, target, flags) => desired.set(key, { id, target, flags });
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
          put(`t${dora.get(slot)}`, dora.get(slot), flipped);
          spawns.set(`t${dora.get(slot)}`, pose);
        } else put(`w${slot}`, null, pose);
      }
    }
    const drawSlot = w && w.lastDraw && w.lastDraw.n !== ui.lastDraw3d ? w.lastDraw : null;
    if (w && w.lastDraw) ui.lastDraw3d = w.lastDraw.n;

    v.players.forEach((p, abs) => {
      const r = rel(abs);
      // opponents' hands (the player's own hand is the screen overlay);
      // a winner's concealed hand is replaced by the face-up reveal
      const revealed = isAgari(v) && v.result.wins.some((x) => x.seat === abs);
      if (r !== 0 && !revealed) {
        for (let i = 0; i < p.handCount; i++) put(`h${abs}:${i}`, null, place(r, rowX(12, i), H / 2, fz(95), 'stand'));
        if (p.hasDrawn) {
          put(`h${abs}:d`, null, place(r, rowX(12, p.handCount) + 0.35, H / 2, fz(95), 'stand'));
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
        put(key, d.tile, target, { tg: d.tsumogiri, last: last && last.tile === d.tile });
        if (!objects.has(key) && d.riichi) {
          // riichi: the tile comes down from above, turning sideways as it lands
          const from = r === 0 ? null : prevPos(`h${abs}:${d.tile % Math.max(1, p.handCount)}`);
          const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
          spawns.set(key, {
            p: (from ? from.p : target.p).clone().setY(3.4),
            q: target.q.clone().premultiply(turn),
          });
        } else if (!objects.has(key) && r === 0) {
          // my discards come in from the hand overlay at the bottom of the screen
          spawns.set(key, place(0, target.p.x * 0.6, 4, fz(112), 'stand'));
        } else if (!objects.has(key)) {
          // opponents' discards leave from their hand: drawn slot for tsumogiri, else inside the hand
          const from = d.tsumogiri ? prevPos(`h${abs}:d`) : prevPos(`h${abs}:${d.tile % Math.max(1, p.handCount)}`);
          if (from) spawns.set(key, from);
        }
      });
      // melds, right-justified next to the hand, first meld outermost
      let mx = fx(r === 0 ? 98 : 97);
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
          const z = fz(95) + (t.pose === 'side' ? H / 2 - W / 2 : 0);
          put(`t${t.id}`, t.id, place(r, mx + width / 2, D / 2, z, t.pose));
          if (t.added !== undefined) put(`t${t.added}`, t.added, place(r, mx + width / 2, D * 1.5, z, 'side'));
          mx -= GAP + 0.02;
        }
        mx -= 0.35;
      });
    });

    sync(desired, spawns);
    syncSticks(v, rel);
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
      spawn = { id: v.drawn, x: ((p.x + 1) / 2) * rect.width, y: ((p.y + 1) / 2) * rect.height };
    }
    const iWon = isAgari(v) && v.result.wins.some((x) => x.seat === v.seat);
    if (!iWon) hand.layout(v, ui, Infinity, spawn);
    drawCenter(v, rel);
  }

  // ---------------------------------------------------------- center panel
  let lastView = null;
  // opaque, so tiles lying on it shadow it like the felt
  const panelMat = new THREE.MeshPhongMaterial({ color: 0x06404f, specular: 0x333333, shininess: 60 });
  const centerCanvas = document.createElement('canvas');
  centerCanvas.width = centerCanvas.height = 1024;
  const centerTex = new THREE.CanvasTexture(centerCanvas);
  centerTex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new RoundedBoxGeometry(6.6, 0.3, 6.6, 4, 0.25),
    panelMat,
  );
  panel.position.y = 0.15;
  scene.add(panel);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshBasicMaterial({ map: centerTex, transparent: true, toneMapped: false }));
  label.rotation.x = -Math.PI / 2;
  label.position.y = 0.31;
  scene.add(label);
  let centerKey = '';

  function drawCenter(v, rel) {
    const key = JSON.stringify([v.round, v.kyokuNum, v.honba, v.kyoutaku, v.wallLeft, v.turn, v.phase, v.dora,
      v.players.map((p) => [p.name, p.score, p.wind, p.riichi, p.online]), v.wall && v.wall.dice]);
    if (key === centerKey) return;
    centerKey = key;
    const c = centerCanvas.getContext('2d');
    c.clearRect(0, 0, 1024, 1024);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0, 20, 40, .9)';
    c.shadowBlur = 10;
    c.fillStyle = '#fff';
    c.font = 'bold 96px "Segoe UI", sans-serif';
    c.fillText(`${WIND_KANJI[v.round] || '?'}${v.kyokuNum + 1}局`, 512, 400);
    c.font = '600 46px "Segoe UI", sans-serif';
    c.fillStyle = '#e6fbff';
    c.fillText(`本 ${v.honba}   供 ${v.kyoutaku}${v.wall ? `   🎲 ${v.wall.dice.join('+')}` : ''}`, 512, 490);
    c.fillStyle = '#fff27a';
    c.font = 'bold 56px "Segoe UI", sans-serif';
    c.fillText(`残り ${v.wallLeft}`, 512, 575);
    v.players.forEach((p, abs) => {
      const r = rel(abs);
      c.save();
      c.translate(512, 512);
      c.rotate([0, -Math.PI / 2, Math.PI, Math.PI / 2][r]);
      const turn = v.turn === abs && v.phase === 'turn';
      if (turn) {
        const g = c.createLinearGradient(-220, 0, 220, 0);
        g.addColorStop(0, 'rgba(127,246,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,.95)');
        g.addColorStop(1, 'rgba(127,246,255,0)');
        c.fillStyle = g;
        c.fillRect(-220, 438, 440, 10);
      }
      c.font = 'bold 66px "Segoe UI", sans-serif';
      c.fillStyle = abs === v.dealer ? '#ff8a8a' : '#d8f4ff';
      c.fillText(WIND_KANJI[p.wind], -150, 330);
      c.fillStyle = turn ? '#fff27a' : '#fff';
      c.fillText(String(p.score), 40, 330);
      c.font = '500 40px "Segoe UI", sans-serif';
      c.fillStyle = '#d8f4ff';
      c.fillText(`${p.name}${p.bot ? ' 🤖' : ''}${p.online ? '' : ' (off)'}`, 0, 395);
      c.restore();
    });
  }

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
  // and push them into place, 3) throw the dice, 4) deal in blocks of four
  // (4-4-4 then 1, plus the dealer's draw) and flip the dora indicator. It
  // uses its own temporary tiles that end exactly where the normal view puts
  // them, so the hand-over is seamless. Tiles never pass through each other:
  // the shuffle is a small collision simulation (shuffle.js), and every move
  // over other tiles lifts first, travels high enough to clear them and only
  // then comes down.
  const PHASES = { shuffle: [0, 0.26], build: [0.26, 0.48], push: [0.48, 0.56], dice: [0.56, 0.72], deal: [0.72, 0.97], flip: [0.95, 1] };
  const span = (p, [a, b]) => (p - a) / (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // The shuffled pile has a lot of room first, then is pushed together (and
  // squared up) inside the line where the walls get built.
  const PILE = { open: 11, closed: 10.2, panel: 3.45, squeeze: [0.17, 0.25] };
  const PRE_OUT = 2.6; // walls are built this far outside their final place
  // lift-carry-drop: vertical offset and horizontal progress for u in 0..1
  function hop(u, height, liftShare) {
    const up = ease(u / liftShare) * ease((1 - u) / liftShare);
    return { y: up * height, h: ease((u - liftShare) / (1 - 2 * liftShare)) };
  }
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
  const dieMats = DIE_FACES.map((n) => new THREE.MeshPhysicalMaterial({ map: pipTexture(n), roughness: 0.25, clearcoat: 1 }));
  const DIE = 0.45;
  const dieGeo = new RoundedBoxGeometry(DIE, DIE, DIE, 3, 0.07);

  function startIntro(v, ui) {
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
    const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const pile = createShuffle({ count: 136, hw: W / 2, hh: H / 2, outer: PILE.open, panel: PILE.panel });
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
        t.deal = { t0: d.t0, dur: 0.06, lift: 1.6 + (n % 3) * 0.8, to: handTarget(d.abs, d.first + k), mine: rel(d.abs) === 0 };
      });
    });
    // dice: thrown from the dealer's side, they land showing the real roll
    const dealerRel = rel(v.dealer);
    const dice = v.wall.dice.map((value, i) => {
      const m = new THREE.Mesh(dieGeo, dieMats);
      m.castShadow = true;
      scene.add(m);
      const from = new THREE.Vector3(i ? 0.8 : -0.8, 3.2, 6.5).applyQuaternion(qSeat[dealerRel]);
      // they land on the centre panel (top at y 0.3)
      const to = new THREE.Vector3(i ? 0.7 : -0.6, 0.3 + DIE / 2, i ? -0.3 : 0.5).applyQuaternion(qSeat[dealerRel]);
      const up = DIE_NORMALS[DIE_FACES.indexOf(value)];
      const q = yawQ(Math.random() * Math.PI * 2).multiply(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0)));
      return { m, from, to, q, axis: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), turns: rnd(5, 8) };
    });
    drawCenter(v, rel);
    world.forceView('overview');
    intro = { t0: performance.now() - (total - v.intro.left), total, tiles, dice, pile, myDealt: -1, v, ui };
    hand.layout(v, ui, 0);
    introListener({ active: true, myTiles: 0 });
  }

  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  function stepIntro(dt) {
    if (!intro) return;
    const p = Math.min(1, (performance.now() - intro.t0) / intro.total);
    const tmpQ = new THREE.Quaternion();
    let myTiles = 0;
    const buildStart = (t) => PHASES.build[0] + t.order * 0.16;
    if (p < PHASES.push[0]) {
      const squeeze = clamp01(span(p, PILE.squeeze));
      intro.pile.setOuter(PILE.open - squeeze * (PILE.open - PILE.closed));
      for (const t of intro.tiles) t.sim.active = p < buildStart(t);
      // the hands slow down and square the pile up before the walls are built
      intro.pile.step(dt || 1 / 60, 1 - squeeze * 0.7, squeeze);
    }
    for (const t of intro.tiles) {
      const o = t.obj;
      if (t.deal && p >= t.deal.t0) {
        // dealing: lift clear of the walls, carry, come down at the hand
        const u = clamp01((p - t.deal.t0) / t.deal.dur);
        const m = hop(u, t.deal.lift, 0.25);
        o.position.lerpVectors(t.final.p, t.deal.to.p, m.h);
        o.position.y += m.y;
        o.quaternion.slerpQuaternions(t.final.q, t.deal.to.q, m.h);
        o.visible = !(t.deal.mine && u >= 1);
        if (t.deal.mine && u >= 1) myTiles++;
        continue;
      }
      if (p < buildStart(t)) {
        // shuffling: lying face down where the simulation put it
        o.position.set(t.sim.x, D / 2, t.sim.z);
        o.quaternion.copy(qLocal.down).premultiply(tmpQ.setFromAxisAngle(Y_AXIS, t.sim.yaw));
        t.lastShuffle = { p: o.position.clone(), q: o.quaternion.clone() };
        continue;
      }
      if (p < PHASES.push[0]) {
        // building: hop out of the pile (over its other tiles) into a line a
        // little outside its final place
        const m = hop(clamp01((p - buildStart(t)) / 0.05), 1.3, 0.2);
        const from = t.lastShuffle || t.pre;
        o.position.lerpVectors(from.p, t.pre.p, m.h);
        o.position.y += m.y;
        o.quaternion.slerpQuaternions(from.q, t.pre.q, m.h);
        continue;
      }
      // pushing the walls in, then (dora) flipping face up
      const u = ease(span(p, PHASES.push));
      o.position.lerpVectors(t.pre.p, t.final.p, u);
      o.quaternion.copy(t.pre.q);
      if (t.isDora && p > PHASES.flip[0]) {
        const f = ease(span(p, PHASES.flip));
        o.position.y = t.final.p.y + Math.sin(f * Math.PI) * 0.8;
        o.quaternion.copy(t.final.q).multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * f));
      }
    }
    for (const d of intro.dice) {
      const u = Math.max(0, Math.min(1, span(p, PHASES.dice)));
      d.m.visible = p >= PHASES.dice[0];
      d.m.position.lerpVectors(d.from, d.to, 1 - (1 - u) ** 2);
      // three bounces, each lower
      d.m.position.y = d.to.y + Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) ** 1.5 * 1.6 + (1 - u) * (d.from.y - d.to.y) * 0.35;
      d.m.quaternion.copy(d.q).multiply(tmpQ.setFromAxisAngle(d.axis, (1 - u) ** 2 * d.turns * Math.PI * 2));
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
  const pickView = (y) => world.setView(y < window.innerHeight * 0.5 ? 'overview' : 'player');
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pickView(e.clientY); });
  window.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') pickView(e.clientY); });

  // Per-setting look of tile backs and the centre panel.
  const LOOKS = {
    aero: { panel: 0x0a4a58 },
    tetsuya: { panel: 0x1a1a1a },
  };
  world.onTheme((name) => {
    const l = LOOKS[name] || LOOKS.aero;
    kit.setLook(name);
    hand.setTheme(name);
    panelMat.color.setHex(l.panel);
    if (lastView) update(...lastView);
  });

  return {
    setTheme: world.setTheme,
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
