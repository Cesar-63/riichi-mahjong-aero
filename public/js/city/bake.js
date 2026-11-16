// The town's geometry and its baked light, as plain numbers (no three.js:
// the tests run this in node, and a build script could too). A zone of the
// map is a list of boxes; each face is cut into a grid fine enough for a
// gradient, and every vertex gets a colour computed once from the zone's
// "bake lights" plus a fake ambient occlusion (darker near the floor, in
// corners and around furniture). At run time nothing is lit: the material
// shows texture × vertex colour.
//
// Colours are worked out as they are shown (no gamma), like on a PS2.

export const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const BAKE = { ao: 0.5, aoRadius: 0.7, wrap: 0.3, floor: 0.3 };

// The lights of a zone: the ones listed, and one for each neon sign and
// glow that asks for it (so a sign lights its wall with its own colour).
export function zoneLights(zone) {
  const out = (zone.lights || []).map((l) => ({ at: l.at, color: hexToRgb(l.color), intensity: l.intensity ?? 1, radius: l.radius ?? 5 }));
  for (const n of [...(zone.neons || []), ...(zone.glows || [])]) {
    if (!n.light) continue;
    const nrm = n.normal || [0, 0, 0];
    out.push({
      at: [n.at[0] + nrm[0] * 0.5, n.at[1] + nrm[1] * 0.5, n.at[2] + nrm[2] * 0.5],
      color: hexToRgb(n.color), intensity: n.light.intensity ?? 1, radius: n.light.radius ?? 5,
    });
  }
  return out;
}

// What darkens the surfaces near it: the walls, floor and ceiling of a
// room (an "inside" box) and the body of everything else big enough.
function occluders(zone) {
  const out = [];
  for (const b of zone.boxes || []) {
    if (b.emissive || b.ao === false) continue;
    if (b.inside) out.push({ box: b, inside: true, skip: new Set(b.skip || []) });
    else if (Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) >= 0.04) out.push({ box: b });
  }
  return out;
}
const FACES = [
  { id: 'x+', axis: 0, sign: 1 }, { id: 'x-', axis: 0, sign: -1 },
  { id: 'y+', axis: 1, sign: 1 }, { id: 'y-', axis: 1, sign: -1 },
  { id: 'z+', axis: 2, sign: 1 }, { id: 'z-', axis: 2, sign: -1 },
];

// How much light is left (0 to 1) at point p of a surface facing n, next
// to everything else in the zone
function occlusion(p, n, own, occ, opts) {
  let ao = 1;
  const R = opts.aoRadius;
  for (const o of occ) {
    const b = o.box;
    let d;
    if (o.inside) {
      // the nearest wall of the room that this surface meets at a corner
      d = Infinity;
      for (const f of FACES) {
        if (o.skip.has(f.id) || Math.abs(n[f.axis]) > 0.9) continue;
        const dist = f.sign > 0 ? b.max[f.axis] - p[f.axis] : p[f.axis] - b.min[f.axis];
        if (dist >= -1e-6 && dist < d) d = dist;
      }
    } else {
      if (b === own) continue;
      const c = [0, 1, 2].map((i) => Math.max(b.min[i], Math.min(b.max[i], p[i])));
      const v = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
      d = Math.hypot(v[0], v[1], v[2]);
      // behind the surface: it cannot shade it
      if (d > 1e-6 && (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / d < -0.05) continue;
    }
    if (d < R) ao *= 1 - opts.ao * (1 - smooth(d / R));
  }
  return Math.max(opts.floor, ao);
}

// The baked colour of a vertex: ambient plus every light that reaches it,
// times the occlusion. tint is the surface's own colour.
export function bakeVertex(p, n, tint, zone, lights, occ, own, opts = BAKE) {
  const amb = hexToRgb(zone.ambient || '#202020');
  let r = amb[0];
  let g = amb[1];
  let b = amb[2];
  for (const l of lights) {
    const v = [l.at[0] - p[0], l.at[1] - p[1], l.at[2] - p[2]];
    const d = Math.hypot(v[0], v[1], v[2]);
    if (d >= l.radius) continue;
    const fall = (1 - d / l.radius) ** 2;
    const facing = d < 1e-6 ? 1 : Math.max(0, ((v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / d) * (1 - opts.wrap) + opts.wrap);
    const k = l.intensity * fall * facing;
    r += l.color[0] * k;
    g += l.color[1] * k;
    b += l.color[2] * k;
  }
  const ao = occlusion(p, n, own, occ, opts);
  return [Math.min(1, r * ao) * tint[0], Math.min(1, g * ao) * tint[1], Math.min(1, b * ao) * tint[2]];
}

// The light on someone standing at (x, y, z): the same lights, with no
// surface to face. The characters are tinted with it as they walk.
export function tintAt(zone, x, y, z, lights = zoneLights(zone)) {
  const c = hexToRgb(zone.ambient || '#202020').map((v) => v * 1.6 + 0.1);
  for (const l of lights) {
    const d = Math.hypot(l.at[0] - x, l.at[1] - y, l.at[2] - z);
    if (d >= l.radius) continue;
    const k = l.intensity * (1 - d / l.radius) ** 2 * 0.8;
    for (let i = 0; i < 3; i++) c[i] += l.color[i] * k;
  }
  return c.map((v) => Math.min(1, v));
}

// The static geometry of a zone, already baked and merged: one set of
// arrays per texture (one draw call each). Returns a Map: texture name →
// { positions, uvs, colors, indices }.
export function buildZone(zone, opts = BAKE) {
  const lights = zoneLights(zone);
  const occ = occluders(zone);
  const groups = new Map();
  const group = (tex) => {
    if (!groups.has(tex)) groups.set(tex, { positions: [], uvs: [], colors: [], indices: [] });
    return groups.get(tex);
  };
  for (const box of zone.boxes || []) {
    if (box.visible === false) continue;
    const tint = hexToRgb(box.color || '#ffffff');
    const skip = new Set(box.skip || []);
    const cell = box.subdiv || zone.subdiv || 0.6;
    const uvScale = box.uv || 2;
    for (const f of FACES) {
      if (skip.has(f.id)) continue;
      // nobody sees the underside of what stands on the ground
      if (!box.inside && f.id === 'y-' && box.min[1] <= 0.001) continue;
      const g = group((box.faceTex && box.faceTex[f.id]) || box.tex || 'white');
      const a = f.axis;
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const out = box.inside ? -f.sign : f.sign; // a room is seen from inside
      const n = [0, 0, 0];
      n[a] = out;
      const at = f.sign > 0 ? box.max[a] : box.min[a];
      const nu = Math.max(1, Math.ceil((box.max[u] - box.min[u]) / cell));
      const nv = Math.max(1, Math.ceil((box.max[v] - box.min[v]) / cell));
      const base = g.positions.length / 3;
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const p = [0, 0, 0];
          p[a] = at;
          p[u] = box.min[u] + ((box.max[u] - box.min[u]) * i) / nu;
          p[v] = box.min[v] + ((box.max[v] - box.min[v]) * j) / nv;
          g.positions.push(p[0], p[1], p[2]);
          // textures run along the ground on floors and upright on walls;
          // "fit" stretches one copy over the whole face (a door, a window)
          if (box.fit) g.uvs.push(a === 2 ? i / nu : j / nv, a === 2 ? j / nv : i / nu);
          else if (a === 1) g.uvs.push(p[0] / uvScale, p[2] / uvScale);
          else g.uvs.push((a === 0 ? p[2] : p[0]) / uvScale, p[1] / uvScale);
          const c = box.emissive ? tint : bakeVertex(p, n, tint, zone, lights, occ, box, opts);
          g.colors.push(c[0], c[1], c[2]);
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const p0 = base + j * (nu + 1) + i;
          const p1 = p0 + 1;
          const p2 = p0 + nu + 1;
          const p3 = p2 + 1;
          // counter-clockwise seen from where the face looks
          if (out > 0) g.indices.push(p0, p1, p3, p0, p3, p2);
          else g.indices.push(p0, p3, p1, p0, p2, p3);
        }
      }
    }
  }
  return groups;
}
