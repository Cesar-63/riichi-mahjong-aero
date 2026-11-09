"""Small glTF and mesh toolkit for build.py: reads the source models (static
meshes made of loose parts, one 256x256 atlas of 64 px tiles each), edits
them part by part and writes skinned .glb files. Needs numpy and Pillow."""
import io
import json
import struct

import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

# Joints, in skin order; each one's parent. The character faces +z, its left
# side is +x. Tips are plain nodes that give the last bones a direction.
JOINTS = ['hips', 'spine', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
          'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = {'hips': None, 'spine': 'hips', 'head': 'spine', 'armL': 'spine', 'foreL': 'armL', 'handL': 'foreL',
          'armR': 'spine', 'foreR': 'armR', 'handR': 'foreR', 'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL',
          'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
TIPS = {'headTop': 'head', 'handLTip': 'handL', 'handRTip': 'handR', 'footLTip': 'footL', 'footRTip': 'footR'}


class Part:
    """A loose piece of a model: its own vertices and triangles."""

    def __init__(self, pos, uv, tris, bone=None, name=''):
        self.pos = np.asarray(pos, np.float64)
        self.uv = np.asarray(uv, np.float64)
        self.tris = np.asarray(tris, np.int64)
        self.bone = bone  # a joint name, or one per vertex
        self.name = name

    mn = property(lambda s: s.pos.min(0))
    mx = property(lambda s: s.pos.max(0))
    c = property(lambda s: (s.pos.min(0) + s.pos.max(0)) / 2)
    ntris = property(lambda s: len(s.tris))

    def copy(self):
        b = self.bone if self.bone is None or isinstance(self.bone, str) else list(self.bone)
        return Part(self.pos.copy(), self.uv.copy(), self.tris.copy(), b, self.name)

    def move(self, dx=0, dy=0, dz=0):
        self.pos += (dx, dy, dz)
        return self

    def scale(self, sx=1, sy=1, sz=1, about=None):
        o = self.c if about is None else np.asarray(about, np.float64)
        self.pos = (self.pos - o) * (sx, sy, sz) + o
        return self

    def rotate(self, axis, deg, about=None):
        o = self.c if about is None else np.asarray(about, np.float64)
        self.pos = (self.pos - o) @ rot(axis, deg).T + o
        return self

    def mirror(self):
        """The same piece on the other side of the body."""
        p = self.copy()
        p.pos[:, 0] *= -1
        p.tris = p.tris[:, ::-1]
        if isinstance(p.bone, str) and p.bone[-1] in 'LR':
            p.bone = p.bone[:-1] + ('R' if p.bone[-1] == 'L' else 'L')
        return p

    def tile(self):
        """(column, row) of the atlas tile its texture sits in."""
        u, v = (self.uv.min(0) + self.uv.max(0)) / 2
        return int(u * 4), int(v * 4)

    def retile(self, to, frm=None):
        """Moves its texture to another tile of the atlas (same place in it)."""
        frm = frm or self.tile()
        self.uv += ((to[0] - frm[0]) / 4, (to[1] - frm[1]) / 4)
        return self

    def flat(self, to, at=(0.5, 0.5)):
        """One colour: every vertex on the same point of a tile."""
        self.uv[:] = ((to[0] + at[0]) / 4, (to[1] + at[1]) / 4)
        return self


def rot(axis, deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]),
            'y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            'z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def load(path):
    """-> (parts, atlas image). Parts are the mesh's connected pieces."""
    d = open(path, 'rb').read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n])
    o = 20 + n
    b = d[o + 8:o + 8 + struct.unpack('<I', d[o:o + 4])[0]]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(b, CT[a['componentType']], a['count'] * NC[a['type']], off).reshape(a['count'], NC[a['type']])

    p = j['meshes'][0]['primitives'][0]
    idx = acc(p['indices']).reshape(-1, 3).astype(np.int64)
    pos = acc(p['attributes']['POSITION']).astype(np.float64)
    uv = acc(p['attributes']['TEXCOORD_0']).astype(np.float64)
    bv = j['bufferViews'][j['images'][0]['bufferView']]
    atlas = Image.open(io.BytesIO(b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')
    # connected pieces, welding vertices that share a position
    weld = {}
    w = np.array([weld.setdefault(tuple(v), len(weld)) for v in np.round(pos, 4)])
    par = list(range(len(weld)))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    for t in idx:
        a, b_, c = (find(w[k]) for k in t)
        par[b_] = a
        par[find(c)] = a
    lab = np.array([find(x) for x in w])
    parts = []
    for l in np.unique(lab):
        vi = np.nonzero(lab == l)[0]
        back = {v: k for k, v in enumerate(vi)}
        tris = [[back[k] for k in t] for t in idx if lab[t[0]] == l]
        parts.append(Part(pos[vi], uv[vi], tris))
    return parts, atlas


# ---------------------------------------------------------------- shapes
def tube(rings, tile, sides=8, caps=(True, True), turn=0.0, vspan=(0.02, 0.98), uspan=(0.02, 0.98)):
    """A lofted tube along y: rings of (y, cx, cz, rx, rz), bottom to top or
    top to bottom. The tile wraps once around it."""
    pos, uv, tris = [], [], []
    ang = [turn + 2 * np.pi * k / sides for k in range(sides + 1)]
    for r, (y, cx, cz, rx, rz) in enumerate(rings):
        v = vspan[0] + (vspan[1] - vspan[0]) * r / (len(rings) - 1)
        for k, a in enumerate(ang):
            pos.append((cx + np.sin(a) * rx, y, cz + np.cos(a) * rz))
            uv.append(((tile[0] + uspan[0] + (uspan[1] - uspan[0]) * k / sides) / 4, (tile[1] + v) / 4))
    n = sides + 1
    down = rings[0][0] > rings[-1][0]  # rings given top to bottom
    for r in range(len(rings) - 1):
        for k in range(sides):
            a, b, c, d = r * n + k, r * n + k + 1, (r + 1) * n + k, (r + 1) * n + k + 1
            tris += [(a, c, b), (b, c, d)] if down else [(a, b, c), (b, d, c)]
    for end, on in ((0, caps[0]), (len(rings) - 1, caps[1])):
        if not on:
            continue
        # the cap has its own vertices: the tile seen flat, from above
        y, cx, cz, rx, rz = rings[end]
        base = len(pos)
        for k, a in enumerate(ang):
            pos.append(pos[end * n + k])
            uv.append(((tile[0] + 0.5 + np.sin(a) * 0.46) / 4, (tile[1] + 0.5 - np.cos(a) * 0.46) / 4))
        ci = len(pos)
        pos.append((cx, y, cz))
        uv.append(((tile[0] + 0.5) / 4, (tile[1] + 0.5) / 4))
        for k in range(sides):
            a, b = base + k, base + k + 1
            first = (end == 0)
            tris.append((ci, a, b) if first == down else (ci, b, a))
    return Part(pos, uv, tris)


def box(mn, mx, tile, taper=1.0):
    """A box from mn to mx; taper narrows its lower end (a lock of hair)."""
    (x0, y0, z0), (x1, y1, z1) = mn, mx
    cx, cz, rx, rz = (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2
    k = np.sqrt(2)
    return tube([(y1, cx, cz, rx * k, rz * k), (y0, cx, cz, rx * k * taper, rz * k * taper)], tile, sides=4, turn=np.pi / 4)


# ------------------------------------------------------------------ atlas
def tile_box(c, r, page=0):
    return (page * 256 + c * 64, r * 64, page * 256 + c * 64 + 64, r * 64 + 64)


def recolor(img, box_, color, keep=0.0, gain=1.0):
    """Repaints a tile in another colour, keeping its shading: each pixel's
    brightness relative to the tile's median scales the new colour."""
    a = np.asarray(img.crop(box_), np.float64)
    lum = a @ (0.299, 0.587, 0.114)
    ref = max(np.median(lum), 1)
    rel = np.clip((lum / ref - 1) * gain + 1, 0, 2.2)[..., None]
    out = np.clip(np.asarray(color, np.float64) * rel, 0, 255)
    out = out * (1 - keep) + a * keep
    img.paste(Image.fromarray(out.astype(np.uint8)), box_[:2])


def recolor_where(img, box_, test, color):
    """Repaints only the pixels of a tile that pass test(rgb array)."""
    a = np.asarray(img.crop(box_), np.float64)
    m = test(a)
    a[m] = np.asarray(color, np.float64)
    img.paste(Image.fromarray(a.astype(np.uint8)), box_[:2])


# ----------------------------------------------------------------- output
def write(path, parts, atlas, joints, tips):
    """A skinned .glb: one mesh, one material, every vertex on one joint."""
    pos, uv, nrm, jidx, tris, seen = [], [], [], [], [], {}
    for p in parts:
        bones = [p.bone] * len(p.pos) if isinstance(p.bone, str) else p.bone
        # flat shading: a vertex is shared only by triangles facing the same way
        for t in p.tris:
            a, b, c = p.pos[t]
            n = np.cross(b - a, c - a)
            ln = np.linalg.norm(n)
            if ln < 1e-12:
                continue
            n = n / ln
            tri = []
            for k in t:
                key = (*np.round(p.pos[k], 5), *np.round(p.uv[k], 5), *np.round(n, 3), bones[k])
                if key not in seen:
                    seen[key] = len(pos)
                    pos.append(p.pos[k])
                    uv.append(p.uv[k])
                    nrm.append(n)
                    jidx.append(JOINTS.index(bones[k]))
                tri.append(seen[key])
            tris.append(tri)
    pos = np.array(pos, np.float32)
    uv = np.array(uv, np.float32)
    uv[:, 0] *= 256 / atlas.width  # wider atlases: extra pages to the right
    nrm = np.array(nrm, np.float32)
    j4 = np.zeros((len(pos), 4), np.uint8)
    j4[:, 0] = jidx
    w4 = np.zeros((len(pos), 4), np.uint8)
    w4[:, 0] = 255
    idx = np.array(tris, np.uint16)
    ibm = np.zeros((len(JOINTS), 16), np.float32)
    for i, name in enumerate(JOINTS):
        m = np.eye(4, dtype=np.float32)
        m[:3, 3] = -np.asarray(joints[name])
        ibm[i] = m.T.reshape(16)
    png = io.BytesIO()
    atlas.save(png, 'PNG', optimize=True)
    blobs, views, accs = [], [], []

    def add(data, target=None):
        off = sum(len(x) for x in blobs)
        raw = data if isinstance(data, bytes) else data.tobytes()
        blobs.append(raw + b'\0' * (-len(raw) % 4))
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def accessor(arr, typ, comp, target=None, bounds=False):
        a = {'bufferView': add(arr, target), 'componentType': comp, 'count': len(arr), 'type': typ}
        if typ == 'VEC4' and comp == 5121 and arr is w4:
            a['normalized'] = True
        if bounds:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1

    prim = {'attributes': {'POSITION': accessor(pos, 'VEC3', 5126, 34962, True), 'NORMAL': accessor(nrm, 'VEC3', 5126, 34962),
                           'TEXCOORD_0': accessor(uv, 'VEC2', 5126, 34962), 'JOINTS_0': accessor(j4, 'VEC4', 5121, 34962),
                           'WEIGHTS_0': accessor(w4, 'VEC4', 5121, 34962)},
            'indices': accessor(idx.reshape(-1), 'SCALAR', 5123, 34963), 'material': 0}
    ibm_acc = accessor(ibm, 'MAT4', 5126)
    img_view = add(png.getvalue())
    # nodes: 0 root, 1 mesh, then joints, then tips
    nodes = [{'name': 'personaje', 'children': [1, 2]}, {'name': 'malla', 'mesh': 0, 'skin': 0}]
    names = JOINTS + list(TIPS)
    where = {**joints, **tips}
    for name in names:
        parent = PARENT.get(name, TIPS.get(name))
        t = np.asarray(where[name], np.float64) - (np.asarray(where[parent]) if parent else 0)
        nodes.append({'name': name, 'translation': [round(float(x), 5) for x in t]})
    for i, name in enumerate(names):
        parent = PARENT.get(name, TIPS.get(name))
        if parent:
            nodes[2 + names.index(parent)].setdefault('children', []).append(2 + i)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'riichi-mahjong-aero scripts/personajes/build.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
        'meshes': [{'name': 'personaje', 'primitives': [prim]}],
        'skins': [{'joints': [2 + i for i in range(len(JOINTS))], 'skeleton': 2, 'inverseBindMatrices': ibm_acc}],
        'materials': [{'name': 'atlas', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'roughnessFactor': 1, 'metallicFactor': 0}}],
        'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'magFilter': 9728, 'minFilter': 9729}],
        'images': [{'bufferView': img_view, 'mimeType': 'image/png'}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': sum(len(x) for x in blobs)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binb = b''.join(blobs)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binb), 0x004E4942) + binb)
    return len(tris)
