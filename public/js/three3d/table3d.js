// 3D table renderer (prototype). Consumes the same server view as the 2.5D
// board. Every tile is an object with a stable key (tile id, wall slot, or
// hidden-hand index) that eases towards a target transform each frame, so
// draws, discards and calls animate by themselves. The player's own hand is
// not part of the scene: like Tenhou's 3D view it is an overlay facing the
// screen (see renderHud in main.js).
import { createWorld } from './world.js';
import {
  tileType, isAka, suitOf, numOf, imageName, deadSlot, HONOR_KANJI, SUIT_KANJI, WIND_KANJI,
} from '../shared/tiles.js';
import { tileset } from '../render.js';

const W = 1; // tile width
const H = 4 / 3; // tile height (face long side)
const D = 0.78; // tile thickness
const S = 1 / 4.1; // world units per 2.5D board unit
const fx = (x) => (x - 50) * S; // 2.5D board coords -> seat-local world coords
const fz = (y) => (y - 50) * S;
const STACKS = 17;
const SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export function createTable3D(container) {
  const world = createWorld(container);
  const { THREE, scene, camera, renderer, RoundedBoxGeometry } = world;

  // ---------------------------------------------------------------- assets
  const bodyGeo = new RoundedBoxGeometry(W, H, D * 0.62, 4, 0.12);
  const backGeo = new RoundedBoxGeometry(W, H, D * 0.42, 4, 0.12);
  const faceGeo = new THREE.PlaneGeometry(W * 0.86, H * 0.86);
  const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf7f1df, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const aqua = new THREE.MeshPhysicalMaterial({ color: 0x1d97e6, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.5, sheenColor: new THREE.Color(0x9ff2ff) });
  const IVORY = ivory.color.clone();
  const faceTextures = new Map();

  function faceTexture(id) {
    const key = imageName(id);
    if (faceTextures.has(key)) return faceTextures.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ctx = canvas.getContext('2d');
    if (tileset.mode === 'img') {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        tex.needsUpdate = true;
      };
      img.src = `${tileset.dir}${key}.${tileset.ext}`;
    } else {
      const t = tileType(id);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 120px serif';
      const red = isAka(id) || (t < 9) || t === 33;
      ctx.fillStyle = red ? '#c0261e' : t < 18 ? '#1d4ea3' : t < 27 || t === 32 ? '#1d7a3a' : '#111';
      if (t >= 27) ctx.fillText(HONOR_KANJI[t - 27], 96, 128);
      else {
        ctx.fillText(String(numOf(t)), 96, 88);
        ctx.font = 'bold 80px serif';
        ctx.fillText(SUIT_KANJI[suitOf(t)], 96, 190);
      }
    }
    faceTextures.set(key, tex);
    return tex;
  }

  // A tile is a group: ivory body + coloured back + face decal. Materials
  // are per tile so it can be dimmed or highlighted on its own.
  function makeTile(id) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, ivory.clone());
    body.position.z = D * 0.19;
    const back = new THREE.Mesh(backGeo, aqua);
    back.position.z = -D * 0.28;
    for (const m of [body, back]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (id !== null) {
      const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: faceTexture(id), transparent: true, roughness: 0.4 }));
      face.position.z = D * 0.5 + 0.004;
      g.add(face);
      g.userData.face = face;
    }
    g.userData.body = body;
    g.userData.id = id;
    return g;
  }

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
        o.obj.traverse((m) => { if (m.material && m.material !== aqua) m.material.dispose?.(); });
        objects.delete(key);
      }
    }
  }

  const tmp = new THREE.Vector3();
  world.onTick((dt) => {
    const k = 1 - Math.exp(-dt * 11);
    for (const o of objects.values()) {
      const t = o.target;
      tmp.copy(t.p);
      o.obj.position.lerp(tmp, k);
      o.obj.quaternion.slerp(t.q, k);
    }
    placeCallouts();
  });

  // --------------------------------------------------------------- layout
  function slotPose(v, slot, rel) {
    const w = v.wall;
    const c = (w.breakStack + (slot >> 1)) % (4 * STACKS);
    const seat = (4 - Math.floor(c / STACKS)) % 4;
    const j = STACKS - 1 - (c % STACKS);
    const top = (slot & 1) === 0;
    return place(rel(seat), fx(12) + j * W + W / 2, top ? D * 1.5 : D * 0.5, fz(82) + H / 2, 'down');
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
      // opponents' hands (the player's own hand is the screen overlay)
      if (r !== 0) {
        for (let i = 0; i < p.handCount; i++) put(`h${abs}:${i}`, null, place(r, fx(12) + i * W + W / 2, H / 2, fz(95), 'stand'));
        if (p.hasDrawn) {
          put(`h${abs}:d`, null, place(r, fx(12) + p.handCount * W + W / 2 + 0.35, H / 2, fz(95), 'stand'));
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
        if (!objects.has(key) && r === 0) {
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
          mx -= 0.06;
        }
        mx -= 0.35;
      });
    });

    sync(desired, spawns);

    // highlights: tsumogiri tiles dimmer, the latest discard glowing
    for (const ob of objects.values()) {
      const { body, face } = ob.obj.userData;
      const f = ob.flags;
      const tint = f.tg ? 0.82 : 1;
      body.material.color.copy(IVORY).multiplyScalar(tint);
      if (face) face.material.color.setScalar(tint);
      const glow = f.last ? 0x2bd8ff : 0x000000;
      body.material.emissive.setHex(glow);
      body.material.emissiveIntensity = glow ? 0.55 : 0;
    }
    drawCenter(v, rel);
  }

  // ---------------------------------------------------------- center panel
  const centerCanvas = document.createElement('canvas');
  centerCanvas.width = centerCanvas.height = 1024;
  const centerTex = new THREE.CanvasTexture(centerCanvas);
  centerTex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new RoundedBoxGeometry(6.6, 0.3, 6.6, 4, 0.25),
    new THREE.MeshPhysicalMaterial({ color: 0x06404f, transparent: true, opacity: 0.72, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.4 }),
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
      if (p.riichi) {
        c.fillStyle = '#fff';
        c.fillRect(-120, 250, 240, 18);
        c.fillStyle = '#e01b2b';
        c.beginPath();
        c.arc(0, 259, 11, 0, Math.PI * 2);
        c.fill();
      }
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

  return {
    update(v, ui) {
      relOf = (abs) => (abs - v.seat + 4) % 4;
      update(v, ui);
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
