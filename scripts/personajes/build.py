"""Builds the game's characters (public/models/personajes/*.glb) from the
three source models in fuentes/: static low-poly figures made of loose
parts. Every part is hung on one joint of a small skeleton (rigid skinning,
as on a PS1), so the game can sit them at the table and move them by code
(public/js/three3d/characters.js). Three more characters are put together
from the parts of those three, with new clothes, hair and colours.

    python3 scripts/personajes/build.py            # writes the .glb files
    python3 scripts/personajes/build.py --huesos   # also *_huesos.glb: one colour per joint
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from lib import JOINTS, Part, box, load, recolor, recolor_where, tile_box, tube, write

HERE = Path(__file__).parent
OUT = HERE.parent.parent / 'public' / 'models' / 'personajes'

# Where each source model's body is cut, in metres over the floor:
# head: everything from here up is the head; shoulder: an arm's piece never
# reaches above it; elbow, wrist, knee, ankle: the joints; waist: the pelvis
# and belt end here; arm: how far from the middle an arm's pieces start
CUTS = {
    'viejo': dict(head=1.40, shoulder=1.33, elbow=1.02, wrist=0.80, waist=1.035, knee=0.465, ankle=0.081, arm=0.10),
    'pelo_blanco': dict(head=1.50, shoulder=1.41, elbow=1.16, wrist=0.90, waist=1.12, knee=0.495, ankle=0.083, arm=0.10),
    'terno_blanco': dict(head=1.50, shoulder=1.41, elbow=1.125, wrist=0.84, waist=1.13, knee=0.508, ankle=0.086, arm=0.115),
}


def classify(parts, cut):
    """Names the joint of every part that has none yet."""
    for p in parts:
        if p.bone is not None:
            continue
        mn, mx, c = p.mn, p.mx, p.c
        side = 'L' if mn[0] > -0.012 else 'R' if mx[0] < 0.012 else ''
        inner = min(abs(mn[0]), abs(mx[0]))
        if mn[1] >= cut['head'] - 1e-3:
            p.bone = 'head'
        elif side and inner >= cut['arm'] and mx[1] <= cut['shoulder'] and not (c[1] > cut['elbow'] and mx[0] - mn[0] < 0.05):
            p.bone = ('arm' if c[1] > cut['elbow'] else 'fore' if c[1] > cut['wrist'] else 'hand') + side
        elif side and mx[1] <= cut['waist'] - 0.1:
            p.bone = ('thigh' if c[1] > cut['knee'] else 'shin' if c[1] > cut['ankle'] else 'foot') + side
        else:
            p.bone = 'hips' if mx[1] <= cut['waist'] else 'spine'
    return parts


def of(parts, bone):
    return [p for p in parts if isinstance(p.bone, str) and p.bone == bone]


def biggest(parts, bone):
    return max(of(parts, bone), key=lambda p: np.prod(p.mx - p.mn))


def ring(p, top):
    """Centre of a limb piece's upper or lower end."""
    y = p.pos[:, 1]
    m = y > y.max() - 0.03 if top else y < y.min() + 0.03
    return p.pos[m].mean(0)


def skeleton(parts, cut):
    """Joint and tip positions, read off the parts."""
    j, tips = {}, {}
    pelvis = biggest(parts, 'hips')
    zc = pelvis.c[2]
    for s in 'LR':
        arm, fore, hand = (biggest(parts, b + s) for b in ('arm', 'fore', 'hand'))
        j['arm' + s] = ring(arm, True) - (0, 0.03, 0)
        j['fore' + s] = (ring(arm, False) + ring(fore, True)) / 2
        j['hand' + s] = ring(fore, False)
        tips[f'hand{s}Tip'] = ring(hand, False)
        thigh, shin, foot = (biggest(parts, b + s) for b in ('thigh', 'shin', 'foot'))
        j['thigh' + s] = np.array([thigh.c[0], thigh.mx[1] - 0.05, thigh.c[2]])
        j['shin' + s] = np.array([shin.c[0], shin.mx[1] - 0.012, shin.c[2]])
        j['foot' + s] = np.array([shin.c[0], foot.mx[1], shin.c[2]])
        tips[f'foot{s}Tip'] = np.array([foot.c[0], 0.0, foot.mx[2]])
    j['hips'] = np.array([0, j['thighL'][1] + 0.05, zc])
    j['spine'] = np.array([0, cut['waist'] - 0.02, zc])
    neck = min((p for p in of(parts, 'spine') if abs(p.c[0]) < 0.02 and p.mx[0] - p.mn[0] < 0.12), key=lambda p: -p.mx[1])
    j['head'] = np.array([0, cut['head'], neck.c[2]])
    tips['headTop'] = np.array([0, max(p.mx[1] for p in of(parts, 'head')), neck.c[2]])
    return j, tips


def scaled(parts, k):
    for p in parts:
        p.pos *= k
    return parts


def cuts_scaled(cut, k):
    return {a: (b if a == 'arm' else b * k) for a, b in cut.items()}


def page2(atlas):
    """A second 4x4 page of tiles to the right of the atlas."""
    wide = Image.new('RGB', (512, 256), (128, 128, 128))
    wide.paste(atlas, (0, 0))
    return wide


def borrow(part):
    """Moves a part's texture to the same tile of page 2."""
    part.uv[:, 0] += 1.0
    return part


def paint(atlas, tile, page, fn):
    b = tile_box(*tile, page)
    im = atlas.crop(b)
    fn(ImageDraw.Draw(im), im)
    atlas.paste(im, b[:2])


def shade(d, color, dark=0.78):
    """A tile of cloth: the colour, a little darker towards the edges."""
    r, g, bl = color
    for x in range(64):
        k = 1 - (1 - dark) * abs(x - 31.5) / 31.5 * 0.6
        d.line([(x, 0), (x, 63)], fill=(int(r * k), int(g * k), int(bl * k)))


# --------------------------------------------------------- the characters
def straight_arms(parts, donor, shoulder, length, wear, thin=1.0):
    """Swaps a model's arms for the donor's (hanging straight, with hands).
    shoulder: where the left one hangs from; length scales it; wear: what
    each piece ('arm', 'fore', 'cuff', 'hand', 'thumb') does with its
    texture, a tile of the model's own atlas or a function of the piece and
    the elbow's place (a piece left out of wear is dropped)."""
    parts = [p for p in parts if not (isinstance(p.bone, str) and p.bone[:-1] in ('arm', 'fore', 'hand'))]
    arm = biggest(donor, 'armL')
    top = ring(arm, True)
    elbow = (ring(arm, False) - top) * length + shoulder
    for bone in ('armL', 'foreL', 'handL'):
        for p in of(donor, bone):
            q = p.copy()
            kind = bone[:-1]
            if bone == 'foreL' and q.mx[1] - q.mn[1] < 0.07:
                kind = 'cuff'
            if bone == 'handL' and q.ntris == 12:
                kind = 'thumb'
            if kind not in wear:
                continue
            q.pos = (q.pos - top) * length + shoulder
            q.scale(thin, 1, thin)
            if isinstance(wear[kind], tuple):
                q.retile(wear[kind])
            else:
                wear[kind](q, elbow)
            parts += [q, q.mirror()]
    return parts


def rolled_cuff(tile):
    """The donor's shirt cuff, worn as a sleeve rolled up to the elbow."""
    def wear(q, elbow):
        q.retile(tile)
        q.move(*(elbow - q.c + (0.012, 0.02, 0)))
        q.scale(1.2, 1.5, 1.2)
    return wear


def on_page2(tile=None):
    def wear(q, elbow):
        if tile:
            q.retile(tile)
        borrow(q)
    return wear


def hair_lock(mn, mx, tile, taper=0.5, tilt=0.0):
    """A lock of hair hanging from the head."""
    p = box(mn, mx, tile, taper)
    if tilt:
        p.rotate('x', tilt, about=((mn[0] + mx[0]) / 2, mx[1], (mn[2] + mx[2]) / 2))
    p.bone = 'head'
    return p


def emit_michihime(base, src, emit):
    """Michihime: a cat girl in a festive shrine maiden's outfit. A coral
    kimono whose sleeves carry the pattern, a red bow, a dark hakama to the
    knee, white stockings and tall okobo sandals; a dark auburn bob with cat
    ears and golden bells on red ribbons. Shiro's head, neck and legs; the
    donor's arms; everything else made here."""
    k = 0.88
    atlas = page2(src['pelo_blanco'][1].copy())
    auburn = (92, 44, 38)
    coral = (238, 128, 108)
    coral_dark = (206, 92, 80)
    garnet = (120, 24, 40)
    red = (200, 34, 44)
    cream = (246, 230, 196)
    white = (246, 244, 240)
    gold = (222, 168, 64)
    mauve = (196, 132, 160)
    hakama = (58, 34, 44)
    lacquer = (34, 24, 24)
    sage = (126, 156, 120)
    slate = (96, 104, 120)
    for t in ((3, 0), (2, 3)):
        recolor(atlas, tile_box(*t), auburn, gain=0.6)
    # eyebrows auburn, eyes amber, a little blush
    recolor_where(atlas, (0, 0, 128, 44), lambda a: (a[..., 2] > a[..., 0] + 6), (96, 50, 40))
    recolor_where(atlas, (0, 44, 128, 128), lambda a: (a[..., 2] > a[..., 0] + 6) & (a.sum(-1) < 520), (170, 96, 36))
    face = atlas.crop((0, 0, 128, 128)).convert('RGBA')
    blush = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(blush)
    d.ellipse([22, 62, 44, 74], fill=(240, 120, 110, 60))
    d.ellipse([84, 62, 106, 74], fill=(240, 120, 110, 60))
    atlas.paste(Image.alpha_composite(face, blush).convert('RGB'), (0, 0))

    def lace(d, y, color=white, holes=None, down=True):
        """A scalloped lace edge along y, with little holes."""
        for x in range(0, 64, 8):
            d.ellipse([x - 1, y - 4, x + 8, y + 4], fill=color)
            if holes:
                d.point([(x + 3, y + (1 if down else -1))], fill=holes)

    def kimono(d, im):  # the torso; the middle of the tile is the front
        shade(d, coral)
        d.polygon([(18, 0), (32, 34), (46, 0)], fill=white)  # under-collar
        d.line([(18, 0), (34, 38)], fill=garnet, width=3)  # crossed collar, left over right
        d.line([(46, 0), (30, 30)], fill=garnet, width=3)
        d.line([(24, 0), (36, 30)], fill=coral_dark, width=2)

    def sleeve(d, im):  # the arm: plain coral, lace at the wrist
        shade(d, coral)
        d.rectangle([0, 54, 63, 63], fill=white)
        lace(d, 54, white, (210, 210, 206), down=False)

    def patterned(d, im):  # the forearm's sleeve: the pattern grows downward
        shade(d, coral)
        for y in range(18, 64, 9):
            d.arc([-6, y - 4, 22, y + 4], 0, 180, fill=cream)
            d.arc([20, y - 4, 48, y + 4], 180, 360, fill=cream)
            d.arc([42, y - 4, 70, y + 4], 0, 180, fill=cream)
        for x in range(0, 64, 12):
            d.chord([x - 2, 30, x + 12, 42], 180, 360, fill=coral_dark)
        for (x, y, c) in ((14, 44, red), (40, 50, sage), (26, 56, slate), (52, 38, red)):
            d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=c)
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=cream)
            for a in range(0, 360, 60):
                v = np.radians(a)
                d.point([(x + 4 * np.cos(v), y + 4 * np.sin(v))], fill=cream)
        d.rectangle([0, 61, 63, 63], fill=white)

    def pleats(d, im):
        shade(d, hakama, 0.9)
        for x in range(0, 64, 8):
            d.line([(x, 0), (x, 63)], fill=(36, 20, 28))
            d.line([(x + 1, 0), (x + 1, 63)], fill=(84, 52, 64))

    def stocking(d, im):
        shade(d, white, 0.92)
        lace(d, 3, white, (214, 214, 210))

    def bow(d, im):
        shade(d, red, 0.85)
        for (x, y) in ((10, 10), (34, 20), (54, 8), (20, 40), (46, 46), (8, 56)):
            for dx, dy in ((0, -3), (3, 0), (0, 3), (-3, 0)):
                d.ellipse([x + dx - 2, y + dy - 2, x + dx + 2, y + dy + 2], fill=white)

    def apron(d, im):
        shade(d, red, 0.85)
        d.rectangle([0, 46, 63, 63], fill=white)
        lace(d, 46, white)
        for x in (8, 24, 40, 56):
            d.polygon([(x - 4, 52), (x, 58), (x + 4, 52), (x + 2, 50), (x, 52), (x - 2, 50)], fill=(236, 140, 170))

    def ribbon(d, im):
        shade(d, red, 0.9)
        d.rectangle([0, 0, 5, 63], fill=white)
        d.rectangle([58, 0, 63, 63], fill=white)

    def okobo(d, im):
        shade(d, lacquer, 0.9)
        d.rectangle([0, 0, 63, 10], fill=red)  # the hanao over the instep

    def ear(d, im):
        shade(d, auburn, 0.9)
        d.rectangle([0, 0, 63, 14], fill=(40, 22, 20))  # dark tips

    def choker(d, im):
        shade(d, mauve, 0.9)
        lace(d, 60, white)

    def obi(d, im):
        shade(d, (176, 40, 60), 0.9)
        for (x, y) in ((8, 12), (28, 30), (48, 14), (16, 50), (44, 52)):
            d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(236, 120, 150))
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(250, 210, 220))

    tiles = {(0, 0): kimono, (1, 0): sleeve, (2, 0): pleats, (3, 0): stocking,
             (0, 1): bow, (1, 1): apron, (3, 1): ribbon,
             (0, 2): okobo, (1, 2): ear, (2, 2): choker, (3, 2): patterned,
             (0, 3): obi}
    for tile, fn in tiles.items():
        paint(atlas, tile, 1, fn)
    paint(atlas, (1, 3), 1, lambda d, im: shade(d, cream, 0.95))  # inside the ears
    paint(atlas, (2, 3), 1, lambda d, im: shade(d, gold, 0.8))  # the bells
    # her hand with red nails: the skin tile, the fingertips painted
    atlas.paste(atlas.crop(tile_box(2, 1)), tile_box(3, 3, 1)[:2])
    paint(atlas, (3, 3), 1, lambda d, im: d.rectangle([0, 52, 63, 63], fill=(176, 20, 32)))

    parts = []
    for p in base['pelo_blanco']:
        b = p.bone
        neck = b == 'spine' and abs(p.c[0]) < 0.02 and p.ntris == 24 and p.mx[1] > 1.5
        if b == 'head':
            if p.ntris == 24 and p.mn[1] > 1.68:
                continue  # the quiff
            parts.append(p.copy())
        elif neck:
            parts.append(p.copy().scale(0.86, 1, 0.86))
        elif b == 'hips' and p.ntris == 30:
            parts.append(borrow(p.copy().flat((2, 0))).scale(0.9, 1, 0.9))
        elif b[:-1] == 'thigh':
            parts.append(borrow(p.copy().retile((2, 0))).scale(0.9, 1, 0.9))
        elif b[:-1] == 'shin':
            parts.append(borrow(p.copy().retile((3, 0))).scale(0.84, 1, 0.84))
        elif b[:-1] == 'foot':
            parts.append(borrow(p.copy().retile((0, 2))).scale(0.86, 1, 0.84))
    for p in parts:
        if isinstance(p.bone, str) and p.bone[:-1] in ('thigh', 'shin', 'foot'):
            p.pos[:, 0] *= 0.9  # legs a little closer together
    parts = straight_arms(parts, base['viejo'], np.array([0.15, 1.40, -0.002]), 1.03,
                          {'arm': on_page2((1, 0)), 'fore': on_page2((3, 2)), 'cuff': on_page2((1, 0)),
                           'hand': on_page2((3, 3)), 'thumb': (2, 0)}, thin=0.82)

    def spine(p, bone='spine'):
        p.bone = bone
        return borrow(p)

    # the kimono's body, its obi and the bow in front
    parts.append(spine(tube([(1.44, 0, 0, 0.07, 0.056), (1.40, 0, 0, 0.152, 0.08), (1.31, 0, 0.014, 0.138, 0.102),
                             (1.20, 0, 0.004, 0.122, 0.084), (1.10, 0, 0, 0.12, 0.08)], (0, 0), sides=8, turn=np.pi)))
    parts.append(spine(tube([(1.15, 0, 0.002, 0.128, 0.09), (1.07, 0, 0.002, 0.132, 0.094)], (0, 3), sides=8, caps=(False, False))))
    parts += [spine(box((-0.095, 1.08, 0.085), (-0.012, 1.16, 0.115), (0, 1))).rotate('z', -10, about=(-0.012, 1.12, 0.1)),
              spine(box((0.012, 1.08, 0.085), (0.095, 1.16, 0.115), (0, 1))).rotate('z', 10, about=(0.012, 1.12, 0.1)),
              spine(box((-0.022, 1.09, 0.09), (0.022, 1.15, 0.122), (0, 1)))]
    # the hakama, to the knee: the hem follows the knees when she sits
    skirt = tube([(1.08, 0, 0, 0.13, 0.092), (0.90, 0, 0.004, 0.18, 0.13), (0.56, 0, 0.012, 0.22, 0.17)], (2, 0), sides=10, caps=(False, False))
    skirt.bone = [('thighL' if v[0] > 0 else 'thighR') if (v[1] < 0.85 and v[2] > 0.03) else 'hips' for v in skirt.pos]
    parts.append(borrow(skirt))
    # the apron-like red panel under the bow
    apr = box((-0.06, 0.86, 0.135), (0.06, 1.08, 0.15), (1, 1))
    apr.bone = [('thighL' if v[0] > 0 else 'thighR') if v[1] < 0.95 else 'hips' for v in apr.pos]
    parts.append(borrow(apr))
    # the choker
    parts.append(spine(tube([(1.505, 0, -0.004, 0.056, 0.05), (1.465, 0, -0.004, 0.06, 0.054)], (2, 2), sides=8, caps=(False, False))))

    # the hair: a short bob with a straight fringe and an ahoge
    hair = [
        hair_lock((-0.112, 1.55, -0.13), (0.112, 1.745, -0.06), (2, 3), 0.85),  # the back
        hair_lock((-0.126, 1.54, -0.08), (-0.092, 1.72, 0.06), (2, 3), 0.85),  # the sides, to the jaw
        hair_lock((0.092, 1.54, -0.08), (0.126, 1.72, 0.06), (2, 3), 0.85),
        hair_lock((-0.104, 1.665, 0.07), (0.104, 1.765, 0.13), (2, 3), 1.0),  # straight fringe
        box((-0.105, 1.70, -0.115), (0.105, 1.78, 0.115), (3, 0)),  # crown
        hair_lock((-0.005, 1.77, 0.0), (0.005, 1.82, 0.03), (2, 3), 0.3, -40),  # ahoge
    ]
    hair[4].bone = 'head'
    parts += hair
    for side in (1, -1):
        # cat ears: dark-tipped outside, cream inside
        ear_out = tube([(1.75, 0.072 * side, -0.012, 0.05, 0.022), (1.835, 0.082 * side, -0.012, 0.004, 0.004)], (1, 2), sides=4, turn=np.pi / 4)
        ear_in = tube([(1.76, 0.074 * side, 0.004, 0.026, 0.005), (1.815, 0.08 * side, 0.004, 0.002, 0.002)], (1, 3), sides=4, turn=np.pi / 4)
        for e in (ear_out, ear_in):
            e.rotate('z', -14 * side, about=(0.07 * side, 1.76, 0))
            e.bone = 'head'
            parts.append(borrow(e))
        # golden bells on red ribbons, at the sides of the head
        bell = box((0.13 * side - 0.02, 1.60, -0.02), (0.13 * side + 0.02, 1.64, 0.02), (2, 3))
        tail = box((0.13 * side - 0.012, 1.46, -0.004), (0.13 * side + 0.012, 1.62, 0.004), (3, 1), 0.8)
        for e in (bell, tail):
            e.bone = 'head'
            parts.append(borrow(e))

    parts = scaled(parts, k)
    # tall okobo: the body stands on platforms
    plat = 0.05
    for p in parts:
        p.move(0, plat, 0)
    for side in 'LR':
        foot = [p for p in parts if p.bone == 'foot' + side]
        mn = np.min([p.mn for p in foot], 0)
        mx = np.max([p.mx for p in foot], 0)
        sole = box((mn[0], 0.0, mn[2]), (mx[0], plat + 0.004, mx[2]), (0, 2))
        sole.bone = 'foot' + side
        parts.append(borrow(sole))
    cut = cuts_scaled(CUTS['pelo_blanco'], k)
    cut = {a: (b if a == 'arm' else b + plat) for a, b in cut.items()}
    emit('michihime', parts, atlas, cut)


def build_all(debug=False):
    src = {n: load(HERE / 'fuentes' / f'{n}_retro.glb') for n in CUTS}
    base = {n: classify([p.copy() for p in src[n][0]], CUTS[n]) for n in CUTS}
    made = {}

    def emit(name, parts, atlas, cut):
        parts = classify(parts, cut)
        joints, tips = skeleton(parts, cut)
        n = write(OUT / f'{name}.glb', parts, atlas, joints, tips)
        made[name] = (n, max(p.mx[1] for p in parts))
        if debug:
            flat = Image.new('RGB', (256, 256))
            d = ImageDraw.Draw(flat)
            for i in range(len(JOINTS)):
                h = (i * 97) % 360
                d.rectangle([i % 4 * 64, i // 4 * 64, i % 4 * 64 + 63, i // 4 * 64 + 63], fill=f'hsl({h},80%,{40 + i % 3 * 15}%)')
            dbg = []
            for p in parts:
                bones = [p.bone] * len(p.pos) if isinstance(p.bone, str) else p.bone
                q = p.copy()
                q.uv = np.array([((JOINTS.index(b) % 4 + 0.5) / 4, (JOINTS.index(b) // 4 + 0.5) / 4) for b in bones])
                dbg.append(q)
            write(OUT / f'{name}_huesos.glb', dbg, flat, joints, tips)

    # --- Genzo: the old man of the source model, as he is
    emit('genzo', [p.copy() for p in base['viejo']], src['viejo'][1].copy(), CUTS['viejo'])

    # --- Ryuji: the white suit, as he is
    emit('ryuji', [p.copy() for p in base['terno_blanco']], src['terno_blanco'][1].copy(), CUTS['terno_blanco'])

    # --- Shiro: the white-haired one. The source model stands with his
    # hands in his pockets; to play he gets arms that hang free, with the
    # sleeves rolled up as before
    def shiro_body():
        parts = [p.copy() for p in base['pelo_blanco']]
        # the bulges of the hands in the pockets
        parts = [p for p in parts if not (p.ntris == 80 and abs(p.c[0]) > 0.05 and p.mx[1] < 1.05)]
        # and the forearms going into them (classify takes them for the body)
        parts = [p for p in parts if not (p.ntris == 20 and p.tile() == (2, 1) and p.mx[1] < 1.2)]
        return straight_arms(parts, base['viejo'], np.array([0.178, 1.40, -0.002]), 1.07,
                             {'arm': (1, 2), 'fore': (2, 0), 'cuff': rolled_cuff((3, 2)), 'hand': (2, 1), 'thumb': (2, 0)})

    emit('shiro', shiro_body(), src['pelo_blanco'][1].copy(), CUTS['pelo_blanco'])

    # --- Kaito: like Shiro, in an open green shirt over a black T-shirt and
    # jeans, black hair worn a little longer at the back
    atlas = src['pelo_blanco'][1].copy()
    for t in ((1, 2), (2, 2), (3, 2), (0, 3)):
        recolor(atlas, tile_box(*t), (74, 128, 82))
    for t in ((1, 3), (3, 3)):
        recolor(atlas, tile_box(*t), (64, 92, 142), gain=1.3)
    for t in ((3, 0), (2, 3)):
        recolor(atlas, tile_box(*t), (44, 42, 52), gain=0.5)
    # eyebrows and eyes: dark
    recolor_where(atlas, (0, 0, 128, 128), lambda a: (a[..., 2] > a[..., 0] + 6) & (a.sum(-1) < 640), (46, 36, 34))
    parts = shiro_body()
    parts += [
        hair_lock((-0.036, 1.435, -0.128), (0.036, 1.63, -0.07), (2, 3), 0.45, -6),
        hair_lock((-0.088, 1.47, -0.118), (-0.03, 1.63, -0.062), (2, 3), 0.4, -4),
        hair_lock((0.03, 1.47, -0.118), (0.088, 1.63, -0.062), (2, 3), 0.4, -4),
        hair_lock((-0.108, 1.52, -0.09), (-0.078, 1.64, -0.03), (2, 3), 0.4),
        hair_lock((0.078, 1.52, -0.09), (0.108, 1.64, -0.03), (2, 3), 0.4),
    ]
    emit('kaito', parts, atlas, CUTS['pelo_blanco'])

    # --- Tatsuo: an old gentleman. Ryuji's suit in black over a red shirt,
    # with gold details; Genzo's head without the cigarette, grey hair
    # combed back
    k = 0.94
    atlas = page2(src['terno_blanco'][1].copy())
    atlas.paste(src['viejo'][1], (256, 0))
    for t in ((0, 2), (1, 2), (3, 3)):
        recolor(atlas, tile_box(*t), (38, 38, 44), gain=0.8)
    recolor(atlas, tile_box(0, 3), (58, 58, 66), gain=0.8)  # lapels, a shade lighter
    recolor(atlas, tile_box(2, 2), (168, 30, 38))  # the shirt
    recolor_where(atlas, tile_box(2, 2), lambda a: a.min(-1) > 150, (226, 184, 72))  # its buttons
    recolor(atlas, tile_box(3, 2), (214, 172, 66), gain=1.4)  # the tie
    gold = (226, 184, 72)
    paint(atlas, (1, 2), 0, lambda d, im: d.rectangle([0, 56, 63, 58], fill=gold))  # sleeve ends
    paint(atlas, (0, 3), 0, lambda d, im: (d.rectangle([0, 0, 1, 63], fill=gold), d.rectangle([62, 0, 63, 63], fill=gold)))
    paint(atlas, (2, 2), 0, lambda d, im: d.rectangle([0, 0, 63, 2], fill=gold))  # collar edge
    for t in ((3, 0), (2, 3)):
        recolor(atlas, tile_box(*t, 1), (176, 176, 184), gain=0.07)
    # grey eyebrows
    recolor_where(atlas, (256 + 14, 16, 256 + 114, 40), lambda a: a.sum(-1) < 200, (132, 132, 138))
    parts = []
    for p in base['terno_blanco']:
        if p.bone == 'head':
            continue
        q = p.copy()
        skin = q.tile() in ((2, 0), (2, 1))
        if q.ntris == 14:  # the pocket square
            q.flat((1, 3))
        if skin:
            borrow(q)  # Genzo's skin
        if q.bone[:-1] == 'shin':
            q.retile((3, 3))  # plain trousers (the model reuses the sleeve there)
        parts.append(q)
    for p in base['viejo']:
        if p.bone != 'head' or p.tile() == (0, 3) or (p.ntris == 4 and p.tile() == (2, 3)):
            continue  # not the cigarette, not the tufts of hair on top
        parts.append(borrow(p.copy()).move(0, 0.095, -0.018))
    # cut short: a thin cap close to the skull
    slick = tube([(1.602, 0, 0.004, 0.098, 0.114), (1.644, 0, -0.004, 0.09, 0.104), (1.662, 0, -0.014, 0.058, 0.07)], (3, 0), sides=8, caps=(False, True))
    slick.pos[slick.pos[:, 2] < -0.02, 1] -= 0.02  # lower at the back
    slick.bone = 'head'
    parts += [borrow(slick).move(0, 0.095, -0.018),
              borrow(hair_lock((-0.084, 1.545, -0.088), (0.084, 1.62, -0.052), (3, 0), 0.8)).move(0, 0.095, -0.018)]
    emit('tatsuo', scaled(parts, k), atlas, cuts_scaled(CUTS['terno_blanco'], k))

    # --- Momo: a student in a sailor uniform, long pink hair. Shiro's head,
    # neck and legs; a torso, a skirt and hair made here
    k = 0.89
    atlas = page2(src['pelo_blanco'][1].copy())
    pink = (236, 128, 172)
    navy = (40, 48, 92)
    for t in ((3, 0), (2, 3)):
        recolor(atlas, tile_box(*t), pink, gain=0.5)
    recolor_where(atlas, (0, 0, 128, 44), lambda a: (a[..., 2] > a[..., 0] + 6), (196, 104, 146))  # eyebrows
    recolor_where(atlas, (0, 44, 128, 128), lambda a: (a[..., 2] > a[..., 0] + 6) & (a.sum(-1) < 520), (150, 70, 120))  # eyes
    face = atlas.crop((0, 0, 128, 128)).convert('RGBA')
    blush = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(blush)
    d.ellipse([22, 62, 44, 74], fill=(240, 130, 140, 70))
    d.ellipse([84, 62, 106, 74], fill=(240, 130, 140, 70))
    atlas.paste(Image.alpha_composite(face, blush).convert('RGB'), (0, 0))

    def blouse(d, im):  # wraps the torso: the middle of the tile is the front
        shade(d, (236, 236, 232))
        d.rectangle([0, 0, 63, 7], fill=navy)  # the collar, across the back
        d.polygon([(14, 0), (50, 0), (32, 30)], fill=navy)  # and down to a point in front
        d.polygon([(22, 0), (42, 0), (32, 20)], fill=(236, 200, 186))  # neckline
        d.line([(14, 4), (30, 28)], fill=(236, 236, 232))
        d.line([(50, 4), (34, 28)], fill=(236, 236, 232))
        d.polygon([(32, 28), (25, 40), (32, 36), (39, 40)], fill=(196, 40, 52))  # ribbon
        d.rectangle([0, 58, 63, 63], fill=navy)

    def sleeve(d, im):
        shade(d, (236, 236, 232))
        d.rectangle([0, 52, 63, 63], fill=navy)
        d.line([(0, 55), (63, 55)], fill=(236, 236, 232))

    def pleats(d, im):
        shade(d, navy, 0.9)
        for x in range(0, 64, 8):
            d.line([(x, 0), (x, 63)], fill=(24, 30, 62))
            d.line([(x + 1, 0), (x + 1, 63)], fill=(58, 68, 120))

    def sock(d, im):
        shade(d, (238, 238, 236))
        d.rectangle([0, 0, 63, 3], fill=navy)
        d.rectangle([0, 6, 63, 7], fill=navy)

    for tile, fn in (((0, 0), blouse), ((1, 0), sleeve), ((2, 0), pleats), ((3, 0), sock)):
        paint(atlas, tile, 1, fn)
    paint(atlas, (0, 1), 1, lambda d, im: shade(d, navy))
    paint(atlas, (1, 1), 1, lambda d, im: shade(d, (196, 40, 52)))
    parts = []
    for p in base['pelo_blanco']:
        b = p.bone
        neck = b == 'spine' and abs(p.c[0]) < 0.02 and p.ntris == 24 and p.mx[1] > 1.5
        if b == 'head':
            if p.ntris == 24 and p.mn[1] > 1.68:
                continue  # the quiff
            parts.append(p.copy())
        elif neck:
            parts.append(p.copy().scale(0.86, 1, 0.86))
        elif b == 'hips' and p.ntris == 30:
            parts.append(borrow(p.copy().flat((0, 1))).scale(0.9, 1, 0.9))
        elif b[:-1] == 'thigh':
            parts.append(p.copy().retile((2, 0)).scale(0.9, 1, 0.9))
        elif b[:-1] == 'shin':
            parts.append(borrow(p.copy().retile((3, 0))).scale(0.86, 1, 0.86))
        elif b[:-1] == 'foot':
            parts.append(p.copy().scale(0.88, 1, 0.86))
    for p in parts:
        if isinstance(p.bone, str) and p.bone[:-1] in ('thigh', 'shin', 'foot'):
            p.pos[:, 0] *= 0.9  # legs a little closer together
    parts = straight_arms(parts, base['viejo'], np.array([0.15, 1.40, -0.002]), 1.03,
                          {'arm': on_page2((1, 0)), 'fore': on_page2((1, 0)), 'hand': (2, 1), 'thumb': (2, 0)}, thin=0.82)
    torso = tube([(1.44, 0, 0, 0.07, 0.055), (1.40, 0, 0, 0.152, 0.078), (1.31, 0, 0.016, 0.136, 0.102),
                  (1.22, 0, 0.004, 0.118, 0.08), (1.10, 0, 0, 0.108, 0.072), (1.06, 0, 0, 0.126, 0.082)], (0, 0), sides=8, turn=np.pi)
    torso.bone = 'spine'
    skirt = tube([(1.085, 0, 0, 0.122, 0.086), (0.94, 0, 0.004, 0.172, 0.124), (0.70, 0, 0.012, 0.212, 0.168)], (2, 0), sides=10, caps=(False, False))
    # the hem follows the knees when she sits; the back hangs from the hips
    skirt.bone = [('thighL' if v[0] > 0 else 'thighR') if (v[1] < 0.8 and v[2] > 0.03) else 'hips' for v in skirt.pos]
    parts += [borrow(torso), borrow(skirt)]
    hair = [
        hair_lock((-0.104, 1.14, -0.142), (0.104, 1.74, -0.078), (2, 3), 0.8, 2),  # down the back
        hair_lock((-0.118, 1.30, -0.10), (-0.07, 1.72, -0.03), (2, 3), 0.5),
        hair_lock((0.07, 1.30, -0.10), (0.118, 1.72, -0.03), (2, 3), 0.5),
        hair_lock((-0.122, 1.47, 0.0), (-0.094, 1.70, 0.05), (2, 3), 0.4),  # in front of the ears
        hair_lock((0.094, 1.47, 0.0), (0.122, 1.70, 0.05), (2, 3), 0.4),
        hair_lock((-0.10, 1.672, 0.07), (-0.03, 1.765, 0.128), (2, 3), 0.55, 8),  # fringe
        hair_lock((-0.036, 1.682, 0.078), (0.036, 1.768, 0.134), (2, 3), 0.5, 8),
        hair_lock((0.03, 1.672, 0.07), (0.10, 1.765, 0.128), (2, 3), 0.55, 8),
        box((-0.10, 1.70, -0.11), (0.10, 1.775, 0.11), (3, 0)),  # crown
    ]
    hair[-1].bone = 'head'
    clip = borrow(box((0.098, 1.66, 0.045), (0.128, 1.69, 0.085), (1, 1)))
    clip.bone = 'head'
    parts += hair + [clip]
    emit('momo', scaled(parts, k), atlas, cuts_scaled(CUTS['pelo_blanco'], k))

    emit_michihime(base, src, emit)

    for name in made:
        print(f'{name}: {made[name][0]} triángulos, {made[name][1]:.2f} m')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    build_all('--huesos' in sys.argv)
