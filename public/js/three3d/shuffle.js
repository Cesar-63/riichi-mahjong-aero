// Tile shuffle for the hand intro: a small 2D simulation (no three.js, so it
// can be tested in Node). Tiles lie face down as rectangles in a disc that
// spins, each at its own pace, drifting in and out and turning, while two
// "hands" stir eddies through it; after every step overlapping rectangles
// are pushed apart along their separating axis, so tiles jostle and slide
// against each other instead of passing through one another. The push is
// soft while they swirl (a corner may dip into a neighbour for a moment, as
// real tiles ride over each other) and firm once the pile is squeezed.
// Before the walls are built the disc opens into a square that stays inside
// the wall lines and the tiles are squared up. `ring` may have an inner
// radius (a hole in the middle) and `panel` a square to keep clear (0: none).

export function createShuffle({ count, hw, hh, ring, square, panel, gap = 0.05, rand = Math.random }) {
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
  for (let z = -rOut; z <= rOut; z += sz) {
    for (let x = -rOut; x <= rOut; x += sx) {
      const r = Math.hypot(x, z);
      if (r + reach > rOut || (rIn > 0 && r - reach < rIn)) continue;
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
    tiles.push({
      x, z, yaw: 0, vx: 0, vz: 0, active: true,
      home: Math.hypot(x, z), // radius it drifts around
      pace: 0.75 + rand() * 0.5, // relative angular speed
      spin: (rand() - 0.5) * 2.8, // own turning, rad/s
      wob: rand() * Math.PI * 2,
      jf: 3 + rand() * 4, // wobble frequency
    });
  }
  let time = 0;
  const phase = rand() * Math.PI * 2;

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
    t.x = Math.max(-half + fx, Math.min(half - fx, t.x));
    t.z = Math.max(-half + fz, Math.min(half - fz, t.z));
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
    // the spin picks up speed during the first moments
    const ramp = Math.min(1, time / 0.3) * stir;
    const omega = 1.9 * ramp;
    // two hands circling the other way, each dragging an eddy through the pile
    const hands = [0, 1].map((h) => {
      const a = phase + h * Math.PI - time * 2.1;
      const R = 5.2 + Math.sin(time * 1.7 + h * 2) * 2.4;
      return [Math.cos(a) * R, Math.sin(a) * R];
    });
    const k = Math.min(1, dt * 9);
    for (const t of live) {
      const r = Math.hypot(t.x, t.z) || 1e-6;
      // round the table at its own pace, drifting in and out
      const w = omega * t.pace * (1 + 0.35 * Math.sin(time * 2.3 + t.wob));
      const drift = (t.home + Math.sin(time * 2.7 + t.wob) * 1.6 - r) * 2.4 * ramp;
      let fx = -t.z * w + (t.x / r) * drift;
      let fz = t.x * w + (t.z / r) * drift;
      for (const [hx, hz] of hands) {
        const dx = t.x - hx;
        const dz = t.z - hz;
        const f = Math.exp(-(dx * dx + dz * dz) / 5) * 3.4 * ramp;
        fx += -dz * f;
        fz += dx * f;
      }
      // and a nervous wobble of its own
      fx += Math.sin(time * t.jf + t.wob) * 2.4 * ramp;
      fz += Math.cos(time * t.jf * 1.3 + t.wob) * 2.4 * ramp;
      t.vx += (fx - t.vx) * k;
      t.vz += (fz - t.vz) * k;
      t.px = t.x;
      t.pz = t.z;
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.yaw += (t.spin * stir + w * 0.6) * dt;
      if (align) {
        const q = Math.PI / 2;
        t.yaw += (Math.round(t.yaw / q) * q - t.yaw) * Math.min(1, align * dt * 8);
      }
    }
    // soft while swirling, firm when squaring up
    const firm = 0.35 + 0.65 * align;
    for (let it = 0; it < (align ? 10 : 3); it++) {
      const ax = live.map(axes);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const m = separate(live[i], ax[i], live[j], ax[j]);
          if (!m) continue;
          live[i].x -= (m[0] / 2) * firm;
          live[i].z -= (m[1] / 2) * firm;
          live[j].x += (m[0] / 2) * firm;
          live[j].z += (m[1] / 2) * firm;
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
    // reshape the area: ring radii and the square's half size
    setArea({ ring: r = [rIn, rOut], square: s = half }) {
      [rIn, rOut] = r;
      half = s;
    },
  };
}
