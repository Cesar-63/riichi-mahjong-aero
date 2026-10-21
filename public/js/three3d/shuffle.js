// Tile shuffle for the hand intro: a small 2D simulation (no three.js, so it
// can be tested in Node). Tiles lie face down as rectangles on the table and
// are stirred by two "hands" circling around; after every step overlapping
// rectangles are pushed apart along their separating axis, and every tile
// is kept inside the playing area and off the centre panel, so tiles slide
// against each other instead of passing through one another.

export function createShuffle({ count, hw, hh, outer, panel, gap = 0.05, rand = Math.random }) {
  const ex = hw + gap / 2; // collision half extents (with a little air between tiles)
  const ez = hh + gap / 2;
  const tiles = [];
  // start on a shuffled grid inside the area, so nothing overlaps at frame 0
  const cells = [];
  const sx = 2 * ex + 0.08;
  const sz = 2 * ez + 0.08;
  for (let z = -outer + sz / 2; z <= outer - sz / 2; z += sz) {
    for (let x = -outer + sx / 2; x <= outer - sx / 2; x += sx) {
      if (Math.abs(x) < panel + sx / 2 && Math.abs(z) < panel + sz / 2) continue;
      cells.push([x, z]);
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (let i = 0; i < count; i++) {
    const [x, z] = cells[i % cells.length];
    tiles.push({ x, z, yaw: (rand() - 0.5) * 0.1, vx: 0, vz: 0, spin: 0, active: true });
  }
  const phase = rand() * Math.PI * 2;
  let time = 0;

  // velocity of the stirring at (x, z): two hands sweeping circles
  function field(x, z) {
    // the whole pile turns, changing direction now and then ...
    const w = 0.75 * Math.sin(time * 1.1 + phase);
    let vx = -z * w;
    let vz = x * w;
    let curl = w;
    // ... while two hands stir small circles in it
    for (let h = 0; h < 2; h++) {
      const a = phase + h * Math.PI + time * 0.9 * (h ? -1 : 1);
      const R = 6.4 + Math.sin(time * 1.3 + h) * 1.4;
      const dx = x - Math.cos(a) * R;
      const dz = z - Math.sin(a) * R;
      const f = Math.exp(-(dx * dx + dz * dz) / 6) * 1.6 * (h ? -1 : 1);
      vx += -dz * f;
      vz += dx * f;
      curl += f * 0.8;
    }
    return [vx, vz, curl];
  }

  const axes = (t) => {
    const c = Math.cos(t.yaw);
    const s = Math.sin(t.yaw);
    return [c, -s, s, c]; // local x axis (ux, uz), local z axis (vx, vz)
  };
  // minimum translation pushing b out of a, or null
  function separate(a, ax, b, bx) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const reach = 2 * Math.hypot(ex, ez);
    if (dx * dx + dz * dz > reach * reach) return null;
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    const list = [ax[0], ax[1], ax[2], ax[3], bx[0], bx[1], bx[2], bx[3]];
    for (let k = 0; k < 8; k += 2) {
      const px = list[k];
      const pz = list[k + 1];
      const ra = ex * Math.abs(ax[0] * px + ax[1] * pz) + ez * Math.abs(ax[2] * px + ax[3] * pz);
      const rb = ex * Math.abs(bx[0] * px + bx[1] * pz) + ez * Math.abs(bx[2] * px + bx[3] * pz);
      const d = dx * px + dz * pz;
      const ov = ra + rb - Math.abs(d);
      if (ov <= 0) return null;
      if (ov < best) {
        best = ov;
        nx = d < 0 ? -px : px;
        nz = d < 0 ? -pz : pz;
      }
    }
    return [nx * best, nz * best, best];
  }
  const PANEL_AX = [1, 0, 0, 1];
  function confine(t, ax) {
    // footprint half sizes along world x / z
    const fx = ex * Math.abs(ax[0]) + ez * Math.abs(ax[2]);
    const fz = ex * Math.abs(ax[1]) + ez * Math.abs(ax[3]);
    t.x = Math.max(-outer + fx, Math.min(outer - fx, t.x));
    t.z = Math.max(-outer + fz, Math.min(outer - fz, t.z));
    const m = separatePanel(t, ax);
    if (m) {
      t.x += m[0];
      t.z += m[1];
    }
  }
  // the centre panel: a square of half size `panel`
  function separatePanel(t, ax) {
    const dx = t.x;
    const dz = t.z;
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    const list = [PANEL_AX[0], PANEL_AX[1], PANEL_AX[2], PANEL_AX[3], ax[0], ax[1], ax[2], ax[3]];
    for (let k = 0; k < 8; k += 2) {
      const px = list[k];
      const pz = list[k + 1];
      const ra = panel * (Math.abs(px) + Math.abs(pz));
      const rb = ex * Math.abs(ax[0] * px + ax[1] * pz) + ez * Math.abs(ax[2] * px + ax[3] * pz);
      const d = dx * px + dz * pz;
      const ov = ra + rb - Math.abs(d);
      if (ov <= 0) return null;
      if (ov < best) {
        best = ov;
        nx = d < 0 ? -px : px;
        nz = d < 0 ? -pz : pz;
      }
    }
    return [nx * best, nz * best];
  }

  // Advance by dt seconds. `stir` (0..1) scales the hands' strength; `align`
  // (0..1) squares the tiles up, so a tighter pile still fits.
  function step(dt, stir = 1, align = 0) {
    // small steps keep the pushes small (slow frames take two)
    dt = Math.min(dt, 1 / 15);
    const n = Math.ceil(dt * 50);
    for (let i = 0; i < n; i++) substep(dt / n, stir, align);
  }
  function substep(dt, stir, align) {
    time += dt;
    const live = tiles.filter((t) => t.active);
    const k = Math.min(1, dt * 5);
    for (const t of live) {
      const [fx, fz, curl] = field(t.x, t.z);
      t.vx += (fx * stir - t.vx) * k;
      t.vz += (fz * stir - t.vz) * k;
      t.spin += (curl * stir - t.spin) * k;
      t.px = t.x;
      t.pz = t.z;
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.yaw += t.spin * dt;
      if (align) {
        const q = Math.PI / 2;
        t.yaw += (Math.round(t.yaw / q) * q - t.yaw) * Math.min(1, align * dt * 8);
      }
    }
    for (let it = 0; it < (align ? 10 : 8); it++) {
      const ax = live.map(axes);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const m = separate(live[i], ax[i], live[j], ax[j]);
          if (!m) continue;
          live[i].x -= m[0] / 2;
          live[i].z -= m[1] / 2;
          live[j].x += m[0] / 2;
          live[j].z += m[1] / 2;
        }
      }
      live.forEach((t, i) => confine(t, ax[i]));
    }
    // velocities follow what the constraints allowed (no bouncing back)
    for (const t of live) {
      t.vx = (t.x - t.px) / dt;
      t.vz = (t.z - t.pz) / dt;
    }
  }

  // Largest penetration between any two live tiles (test helper).
  function maxOverlap() {
    const live = tiles.filter((t) => t.active);
    const ax = live.map(axes);
    let worst = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const m = separate(live[i], ax[i], live[j], ax[j]);
        if (m) worst = Math.max(worst, m[2] - gap);
      }
    }
    return worst;
  }

  return {
    tiles,
    step,
    maxOverlap,
    // shrink or grow the square the pile must stay in
    setOuter(v) {
      outer = v;
    },
  };
}
