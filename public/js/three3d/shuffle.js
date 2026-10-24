// Tile shuffle for the hand intro: a small 2D simulation (no three.js, so it
// can be tested in Node). Tiles lie face down as rectangles that keep their
// momentum and slow down on the felt. Two "hands" wander over the table on
// uneven paths, dragging and shoving the tiles they pass through, and a
// loose eddy turns round a centre that wanders too, so the pile never spins
// as a neat disc. Tiles knock into each other and bounce off (picking up a
// spin), and bounce off the edges of the table. After every step overlapping
// rectangles are pushed apart along their separating axis, so they never
// pass through one another; the push is soft while they swirl (a corner may
// dip into a neighbour for a moment, as real tiles ride over each other) and
// firm once the pile is squeezed. Before the walls are built the area
// closes into a square inside the wall lines and the tiles are squared up.
// The tiles start on a grid within `start` of the middle; `ring` may confine
// them to a ring and `panel` keep a square clear (0: none).

export function createShuffle({ count, hw, hh, ring, square, panel, start = ring[1], gap = 0.05, rand = Math.random }) {
  const ex = hw + gap / 2; // collision half extents (with a little air between tiles)
  const ez = hh + gap / 2;
  // playing area: a ring (rIn..rOut) inside a square of half size `square`,
  // never on the centre panel (square of half size `panel`)
  let [rIn, rOut] = ring;
  let half = square;
  const tiles = [];
  // start on a shuffled grid inside the ring, so nothing overlaps at frame 0
  const cells = [];
  const sx = 2 * ex + 0.12;
  const sz = 2 * ez + 0.12;
  const reach = Math.hypot(ex, ez);
  const from = Math.min(start, rOut);
  for (let z = -from; z <= from; z += sz) {
    for (let x = -from; x <= from; x += sx) {
      const r = Math.hypot(x, z);
      if (r + reach > from || (rIn > 0 && r - reach < rIn)) continue;
      if (Math.abs(x) + reach > half || Math.abs(z) + reach > half) continue;
      if (panel > 0 && Math.abs(x) < panel + sx / 2 && Math.abs(z) < panel + sz / 2) continue;
      cells.push([x, z]);
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (let i = 0; i < count; i++) {
    const [x, z] = cells[i % cells.length];
    // dumped on the table: already sliding a little
    const a = rand() * Math.PI * 2;
    const v = 1.5 + rand() * 3.5;
    tiles.push({
      x, z, yaw: 0, vx: Math.cos(a) * v, vz: Math.sin(a) * v, active: true,
      w: (rand() - 0.5) * 2, // own turning, rad/s
      wob: rand() * Math.PI * 2,
    });
  }
  let time = 0;
  // every shuffle takes its own paths
  const ph = Array.from({ length: 8 }, () => rand() * Math.PI * 2);
  const fq = Array.from({ length: 8 }, () => 0.7 + rand() * 0.9);
  // where hand h is at time t: two uneven loops over most of the table
  const handAt = (h, t) => {
    const o = h * 4;
    const a = Math.min(half - 1.5, 9);
    return [
      a * (0.62 * Math.sin(fq[o] * t + ph[o]) + 0.38 * Math.sin(fq[o + 1] * 2.3 * t + ph[o + 1])),
      a * (0.62 * Math.cos(fq[o + 2] * 1.1 * t + ph[o + 2]) + 0.38 * Math.sin(fq[o + 3] * 1.9 * t + ph[o + 3])),
    ];
  };
  const kick = (t, s) => {
    const a = rand() * Math.PI * 2;
    t.vx += Math.cos(a) * s;
    t.vz += Math.sin(a) * s;
    t.w += (rand() - 0.5) * s * 0.9;
  };

  const axes = (t) => {
    const c = Math.cos(t.yaw);
    const s = Math.sin(t.yaw);
    return [c, -s, s, c]; // local x axis (ux, uz), local z axis (vx, vz)
  };
  // reach of a rectangle along a unit direction
  const support = (ax, nx, nz) => ex * Math.abs(ax[0] * nx + ax[1] * nz) + ez * Math.abs(ax[2] * nx + ax[3] * nz);

  // minimum translation pushing b out of a: [x, z, depth], or null
  function separate(a, ax, b, bx) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 4 * reach * reach) return null;
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    for (const [px, pz] of [[ax[0], ax[1]], [ax[2], ax[3]], [bx[0], bx[1]], [bx[2], bx[3]]]) {
      const d = dx * px + dz * pz;
      const ov = support(ax, px, pz) + support(bx, px, pz) - Math.abs(d);
      if (ov <= 0) return null;
      if (ov < best) {
        best = ov;
        nx = d < 0 ? -px : px;
        nz = d < 0 ? -pz : pz;
      }
    }
    return [nx * best, nz * best, best];
  }

  // the centre panel, a square of half size `panel`
  function separatePanel(t, ax) {
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    for (const [px, pz] of [[1, 0], [0, 1], [ax[0], ax[1]], [ax[2], ax[3]]]) {
      const d = t.x * px + t.z * pz;
      const ov = panel * (Math.abs(px) + Math.abs(pz)) + support(ax, px, pz) - Math.abs(d);
      if (ov <= 0) return null;
      if (ov < best) {
        best = ov;
        nx = d < 0 ? -px : px;
        nz = d < 0 ? -pz : pz;
      }
    }
    return [nx * best, nz * best];
  }

  // keeps a tile in the area; against the table's edge it bounces back
  const BOUNCE = 0.55;
  function confine(t, ax) {
    const r = Math.hypot(t.x, t.z) || 1e-6;
    const nx = t.x / r;
    const nz = t.z / r;
    const e = support(ax, nx, nz);
    const target = Math.min(Math.max(r, rIn + e), rOut - e);
    if (target !== r) {
      t.x = nx * target;
      t.z = nz * target;
    }
    const fx = support(ax, 1, 0);
    const fz = support(ax, 0, 1);
    if (Math.abs(t.x) > half - fx) {
      t.x = Math.sign(t.x) * (half - fx);
      if (t.vx * t.x > 0) {
        t.w += t.vz * 0.25 * Math.sign(t.x);
        t.vx *= -BOUNCE;
      }
    }
    if (Math.abs(t.z) > half - fz) {
      t.z = Math.sign(t.z) * (half - fz);
      if (t.vz * t.z > 0) {
        t.w -= t.vx * 0.25 * Math.sign(t.z);
        t.vz *= -BOUNCE;
      }
    }
    const m = panel > 0 && separatePanel(t, ax);
    if (m) {
      t.x += m[0];
      t.z += m[1];
    }
  }

  // Advance by dt seconds. `stir` (0..1) scales the swirl; `align` (0..1)
  // squares the tiles up, so a tighter pile still fits.
  function step(dt, stir = 1, align = 0) {
    // small steps keep the pushes small (slow frames take several)
    dt = Math.min(dt, 1 / 15);
    const n = Math.ceil(dt * 50);
    for (let i = 0; i < n; i++) substep(dt / n, stir, align);
  }
  function substep(dt, stir, align) {
    time += dt;
    const live = tiles.filter((t) => t.active);
    // the stirring picks up during the first moments and calms down to square up
    const ramp = Math.min(1, time / 0.1) * stir;
    const hands = [0, 1].map((h) => {
      const [x, z] = handAt(h, time);
      const [px, pz] = handAt(h, time - 0.02);
      return { x, z, vx: (x - px) / 0.02, vz: (z - pz) / 0.02 };
    });
    // the eddy: round a wandering centre, in no fixed rhythm
    const cx = Math.sin(time * 0.8 + ph[0]) * 2.6;
    const cz = Math.cos(time * 1.1 + ph[1]) * 2.2;
    const eddy = (2.1 + 0.8 * Math.sin(time * 1.6 + ph[2])) * ramp;
    const felt = Math.exp(-dt * (1.3 + align * 8)); // friction of the felt
    const R = 3.2; // reach of a hand
    for (const t of live) {
      t.vx *= felt;
      t.vz *= felt;
      t.w *= Math.exp(-dt * (1.2 + align * 8));
      for (const hd of hands) {
        const dx = t.x - hd.x;
        const dz = t.z - hd.z;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const s = (1 - d / R) * ramp;
        // carried along with the hand, shoved aside and turned
        t.vx += ((hd.vx - t.vx) * 9 + (dx / (d || 1)) * 6 - dz * 4) * s * dt;
        t.vz += ((hd.vz - t.vz) * 9 + (dz / (d || 1)) * 6 + dx * 4) * s * dt;
        t.w += (rand() - 0.5) * 30 * s * dt;
      }
      const ex2 = t.x - cx;
      const ez2 = t.z - cz;
      t.vx += -ez2 * eddy * dt * 1.4;
      t.vz += ex2 * eddy * dt * 1.4;
      // the hands keep gathering the pile back to the middle, harder the
      // further a tile has gone
      const far = Math.hypot(t.x, t.z) / half;
      const pull = (0.9 + 2.6 * far * far) * ramp;
      t.vx -= t.x * pull * dt;
      t.vz -= t.z * pull * dt;
      // now and then a tile gets knocked by a finger
      if (rand() < dt * 2.2 * ramp) kick(t, 5 + rand() * 6);
      t.px = t.x;
      t.pz = t.z;
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.yaw += t.w * dt;
      if (align) {
        const q = Math.PI / 2;
        t.yaw += (Math.round(t.yaw / q) * q - t.yaw) * Math.min(1, align * dt * 8);
      }
    }
    // soft while swirling, firm when squaring up
    const firm = 0.35 + 0.65 * align;
    for (let it = 0; it < (align ? 10 : 4); it++) {
      const ax = live.map(axes);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          const m = separate(a, ax[i], b, ax[j]);
          if (!m) continue;
          a.x -= (m[0] / 2) * firm;
          a.z -= (m[1] / 2) * firm;
          b.x += (m[0] / 2) * firm;
          b.z += (m[1] / 2) * firm;
          if (it > 0) continue;
          // a knock: they bounce apart along the contact and start to turn
          const nx = m[0] / m[2];
          const nz = m[1] / m[2];
          const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (vn >= 0) continue;
          const jn = (-(1 + BOUNCE) * vn) / 2;
          a.vx -= jn * nx;
          a.vz -= jn * nz;
          b.vx += jn * nx;
          b.vz += jn * nz;
          const tw = ((b.vx - a.vx) * -nz + (b.vz - a.vz) * nx) * 0.35;
          a.w -= tw;
          b.w += tw;
        }
      }
      live.forEach((t, i) => confine(t, ax[i]));
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
    // reshape the area: ring radii and the square's half size
    setArea({ ring: r = [rIn, rOut], square: s = half }) {
      [rIn, rOut] = r;
      half = s;
    },
  };
}
