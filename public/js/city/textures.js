// The town's textures, drawn by code as placeholders: small (64 to 128 px),
// repeated and filtered bilinearly, as on a PS2. Each one is a function of
// its name, so swapping one for a painted image later is a change here
// only (see public/city/README.md).
import * as THREE from '../../vendor/three/three.module.min.js';

// a small repeatable source of chance, so a texture is the same every time
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
// a flat colour with grain: every pixel a little lighter or darker
function grain(ctx, w, h, [r, g, b], amount, rnd) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const k = (rnd() - 0.5) * 2 * amount;
    img.data[i * 4] = r + k;
    img.data[i * 4 + 1] = g + k;
    img.data[i * 4 + 2] = b + k;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const line = (ctx, x0, y0, x1, y1, style, width = 1) => {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

// name → (ctx, size, rnd). Light enough that the vertex colours (the baked
// light) do the darkening.
const PAINT = {
  white: [4, (ctx, s) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s); }],
  plaster: [64, (ctx, s, r) => {
    grain(ctx, s, s, [196, 188, 172], 9, r);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(90,80,60,${0.05 + r() * 0.06})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 4 + r() * 10, 3 + r() * 6, r() * 3, 0, 7);
      ctx.fill();
    }
  }],
  tatami: [64, (ctx, s, r) => {
    grain(ctx, s, s, [168, 170, 112], 10, r);
    for (let y = 0; y < s; y += 2) line(ctx, 0, y + 0.5, s, y + 0.5, 'rgba(90,96,50,0.18)');
    ctx.fillStyle = '#3d4a30';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, 0, 2, s);
  }],
  wood: [64, (ctx, s, r) => {
    grain(ctx, s, s, [150, 108, 70], 8, r);
    for (let i = 0; i < 26; i++) {
      const y = r() * s;
      line(ctx, 0, y, s, y + (r() - 0.5) * 3, `rgba(70,40,20,${0.1 + r() * 0.2})`);
    }
  }],
  woodDark: [64, (ctx, s, r) => {
    grain(ctx, s, s, [96, 70, 50], 7, r);
    for (let i = 0; i < 22; i++) {
      const y = r() * s;
      line(ctx, 0, y, s, y + (r() - 0.5) * 3, `rgba(30,18,10,${0.15 + r() * 0.25})`);
    }
  }],
  boards: [128, (ctx, s, r) => {
    grain(ctx, s, s, [140, 110, 80], 8, r);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = `rgba(40,25,10,${r() * 0.18})`;
      ctx.fillRect(x, 0, 16, s);
      line(ctx, x + 0.5, 0, x + 0.5, s, 'rgba(25,15,8,0.7)');
      for (let i = 0; i < 4; i++) {
        const y = r() * s;
        line(ctx, x + 2, y, x + 14, y + 1, 'rgba(60,35,18,0.25)');
      }
    }
    for (let i = 0; i < 6; i++) {
      const y = Math.floor(r() * s);
      const x = Math.floor(r() * 8) * 16;
      line(ctx, x, y + 0.5, x + 16, y + 0.5, 'rgba(25,15,8,0.6)');
    }
  }],
  fabric: [64, (ctx, s, r) => {
    grain(ctx, s, s, [226, 224, 220], 8, r);
    for (let i = 0; i < s; i += 4) {
      line(ctx, 0, i + 0.5, s, i + 0.5, 'rgba(0,0,0,0.07)');
      line(ctx, i + 0.5, 0, i + 0.5, s, 'rgba(0,0,0,0.05)');
    }
  }],
  felt: [64, (ctx, s, r) => {
    grain(ctx, s, s, [58, 128, 84], 10, r);
  }],
  metal: [64, (ctx, s, r) => {
    grain(ctx, s, s, [200, 204, 210], 5, r);
    for (let i = 0; i < 14; i++) {
      const y = r() * s;
      line(ctx, 0, y, s, y, `rgba(${r() > 0.5 ? '255,255,255' : '40,40,50'},0.15)`);
    }
  }],
  concrete: [64, (ctx, s, r) => {
    grain(ctx, s, s, [170, 170, 168], 9, r);
    line(ctx, 0, 0.5, s, 0.5, 'rgba(50,50,55,0.6)');
    line(ctx, 0.5, 0, 0.5, s, 'rgba(50,50,55,0.6)');
    line(ctx, 0, 1.5, s, 1.5, 'rgba(255,255,255,0.12)');
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(60,60,60,${0.05 + r() * 0.07})`;
      ctx.fillRect(r() * s, r() * s, 6 + r() * 14, 10 + r() * 30);
    }
  }],
  door: [64, (ctx, s, r) => {
    // (64 × 128: a door is twice as tall as wide)
    grain(ctx, s, s * 2, [150, 112, 78], 7, r);
    ctx.strokeStyle = 'rgba(40,24,12,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2.5, 2.5, s - 5, s * 2 - 5);
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 12, s - 20, 46);
    ctx.strokeRect(10, 70, s - 20, 46);
    ctx.fillStyle = '#d8c070';
    ctx.fillRect(s - 12, 62, 5, 5);
  }, 2],
  window: [64, (ctx, s) => {
    // daylight seen from indoors: the glass at full brightness, the frame dark
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b8b8b8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#16161c';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, s - 3, s, 3);
    ctx.fillRect(0, 0, 3, s);
    ctx.fillRect(s - 3, 0, 3, s);
    ctx.fillRect(s / 2 - 1, 0, 2, s);
    ctx.fillRect(0, s / 2 - 1, s, 2);
  }],
  // a window seen from the street at noon: dark glass behind a wooden grid
  windowDark: [64, (ctx, s, r) => {
    grain(ctx, s, s, [52, 58, 78], 6, r);
    ctx.fillStyle = 'rgba(150,170,210,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.55);
    ctx.lineTo(s * 0.55, 0);
    ctx.lineTo(s * 0.8, 0);
    ctx.lineTo(0, s * 0.8);
    ctx.fill();
    ctx.fillStyle = '#6a5a48';
    for (let i = 0; i <= 3; i++) {
      ctx.fillRect(Math.min(s - 3, (i * s) / 3 - 1), 0, 3, s);
      ctx.fillRect(0, Math.min(s - 3, (i * s) / 3 - 1), s, 3);
    }
  }],
  // overlapping boards, the walls of every shack in the street
  clapboard: [128, (ctx, s, r) => {
    grain(ctx, s, s, [198, 196, 188], 7, r);
    for (let y = 0; y < s; y += 16) {
      const g = ctx.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, 16);
      for (let i = 0; i < 3; i++) {
        const x = r() * s;
        line(ctx, x, y + 1, x, y + 15, 'rgba(40,36,30,0.4)');
      }
      for (let i = 0; i < 5; i++) {
        const yy = y + 2 + r() * 11;
        const x = r() * s;
        line(ctx, x, yy, x + 10 + r() * 30, yy, 'rgba(60,52,44,0.18)');
      }
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(50,60,40,${0.05 + r() * 0.07})`;
      ctx.fillRect(r() * s, r() * s, 8 + r() * 18, 20 + r() * 50);
    }
  }],
  dirt: [128, (ctx, s, r) => {
    grain(ctx, s, s, [190, 186, 160], 9, r);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '120,128,96' : '150,140,120'},${0.08 + r() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 8 + r() * 22, 4 + r() * 10, r() * 3, 0, 7);
      ctx.fill();
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(240,236,220,0.5)' : 'rgba(70,66,56,0.5)';
      ctx.fillRect(r() * s, r() * s, 1 + (r() > 0.8), 1);
    }
  }],
  // damp plaster: the olive walls of every room
  plasterOld: [128, (ctx, s, r) => {
    grain(ctx, s, s, [196, 198, 150], 7, r);
    for (let i = 0; i < 12; i++) {
      const x = r() * s;
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(80,96,50,0)');
      g.addColorStop(0.5 + r() * 0.4, `rgba(80,96,50,${0.12 + r() * 0.14})`);
      g.addColorStop(1, 'rgba(80,96,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 4 + r() * 16, s);
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(60,70,40,${0.06 + r() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 6 + r() * 16, 5 + r() * 12, r() * 3, 0, 7);
      ctx.fill();
    }
  }],
  // plaster fallen off in places, the bricks showing
  plasterCracked: [128, (ctx, s, r) => {
    grain(ctx, s, s, [200, 198, 170], 7, r);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(90,100,70,${0.07 + r() * 0.08})`;
      ctx.fillRect(r() * s, r() * s, 10 + r() * 30, 20 + r() * 50);
    }
    const patch = (cx, cy, rx, ry) => {
      ctx.save();
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const q = 0.7 + r() * 0.5;
        ctx.lineTo(cx + Math.cos(a) * rx * q, cy + Math.sin(a) * ry * q);
      }
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#4c4a48';
      ctx.fillRect(0, 0, s, s);
      for (let row = 0; row < s / 12; row++) {
        for (let col = -1; col < s / 24; col++) {
          const k = 120 + r() * 30;
          ctx.fillStyle = `rgb(${k},${k * 0.98},${k * 0.94})`;
          ctx.fillRect(col * 24 + (row % 2 ? 12 : 0) + 1, row * 12 + 1, 22, 10);
        }
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(40,40,36,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    patch(34, 96, 26, 24);
    patch(100, 30, 20, 16);
    let x = 60;
    let y = 0;
    for (let i = 0; i < 12; i++) {
      const nx = x + (r() - 0.5) * 14;
      const ny = y + 6 + r() * 8;
      line(ctx, x, y, nx, ny, 'rgba(50,50,44,0.5)');
      x = nx;
      y = ny;
    }
  }],
  // old floor tiles, the grout dark with dirt
  tiles: [64, (ctx, s, r) => {
    grain(ctx, s, s, [176, 186, 170], 7, r);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = `rgba(${(i + j) % 2 ? '60,80,70' : '220,220,200'},${0.06 + r() * 0.1})`;
        ctx.fillRect(i * 32, j * 32, 32, 32);
      }
    }
    for (const k of [0, 32]) {
      line(ctx, k + 0.5, 0, k + 0.5, s, 'rgba(40,46,40,0.7)');
      line(ctx, 0, k + 0.5, s, k + 0.5, 'rgba(40,46,40,0.7)');
    }
    line(ctx, 10, 40, 26, 58, 'rgba(40,46,40,0.4)');
  }],
  // tar paper and boards: roofs and eaves
  roof: [64, (ctx, s, r) => {
    grain(ctx, s, s, [112, 108, 116], 9, r);
    for (let x = 0; x < s; x += 16) line(ctx, x + 0.5, 0, x + 0.5, s, 'rgba(20,20,26,0.5)');
  }],
  // a door with a pane of dark glass
  doorGlass: [64, (ctx, s, r) => {
    grain(ctx, s, s * 2, [150, 112, 84], 7, r);
    for (let i = 0; i < 20; i++) {
      const x = r() * s;
      line(ctx, x, 0, x + (r() - 0.5) * 3, s * 2, `rgba(50,30,18,${0.1 + r() * 0.15})`);
    }
    ctx.strokeStyle = 'rgba(40,24,12,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2.5, 2.5, s - 5, s * 2 - 5);
    ctx.fillStyle = '#2a3244';
    ctx.fillRect(14, 20, s - 28, 34);
    ctx.fillStyle = 'rgba(140,160,200,0.25)';
    ctx.fillRect(14, 20, s - 28, 9);
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 20, s - 28, 34);
    ctx.fillStyle = '#b0a060';
    ctx.fillRect(s - 12, 70, 5, 6);
  }, 2],
  // a notice written with a brush, pinned to the wall
  notice: [64, (ctx, s, r) => {
    grain(ctx, s, s, [226, 222, 204], 5, r);
    ctx.strokeStyle = 'rgba(30,28,26,0.75)';
    ctx.lineCap = 'round';
    for (let col = 0; col < 7; col++) {
      const x = s - 8 - col * 8;
      let y = 6 + r() * 4;
      const end = s - 8 - r() * (col > 4 ? 26 : 8);
      while (y < end) {
        const h = 2 + r() * 4;
        ctx.lineWidth = 1 + r() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x + (r() - 0.5) * 3, y);
        ctx.quadraticCurveTo(x + (r() - 0.5) * 6, y + h / 2, x + (r() - 0.5) * 3, y + h);
        ctx.stroke();
        y += h + 1.5;
      }
    }
    ctx.fillStyle = 'rgba(120,120,90,0.12)';
    ctx.fillRect(0, s - 12, s, 12);
  }],
};

const cache = new Map();
// The texture of that name (the same object every time)
export function texture(name) {
  if (cache.has(name)) return cache.get(name);
  const [size, paint, tall = 1] = PAINT[name] || PAINT.white;
  const [c, ctx] = canvas(size, size * tall);
  paint(ctx, size, rng(hash(name)));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(name, t);
  return t;
}

// A soft round spot, white in the middle: the halo of a bare bulb (drawn
// additively) and, in black, the shadow under someone's feet.
export function spotTexture(kind) {
  const key = `spot:${kind}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'shadow') {
    g.addColorStop(0, 'rgba(0,0,0,0.7)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#8a8a8a');
    g.addColorStop(0.6, '#2a2a2a');
    g.addColorStop(1, '#000000');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  cache.set(key, t);
  return t;
}

// All the painted signs of a zone on one 256 px texture (one draw call for
// the lot): boards lettered by hand, kanji and Spanish together. Returns
// the texture and the uv of each sign's four corners. A sign:
// { text, sub, size: [w, h], bg, fg, accent, vertical, arrow }.
const CELL = [128, 64];
export function signAtlas(signs) {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  const font = '"Shippori Mincho B1", "Zen Kaku Gothic New", "Noto Serif JP", serif';
  const rects = signs.map((sign, i) => {
    const rnd = rng(hash(sign.text + i));
    const x = (i % 2) * CELL[0];
    const y = Math.floor(i / 2) * CELL[1];
    const fg = sign.fg || '#2a2420';
    const accent = sign.accent || '#a83020';
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL[0], CELL[1]);
    ctx.clip();
    // the cell is stretched over the sign: draw as if it had its shape. A
    // tall sign lies on its side in the cell, to keep its letters sharp.
    const [w, h] = sign.size;
    const tall = h > w;
    const H = tall ? CELL[0] : CELL[1];
    const W = H * (w / h);
    if (tall) {
      ctx.translate(x, y + CELL[1]);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(CELL[1] / W, 1);
    } else {
      ctx.translate(x, y);
      ctx.scale(CELL[0] / W, 1);
    }
    // the board: paint worn by sun and rain
    ctx.fillStyle = sign.bg || '#d8cfb0';
    ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,240' : '60,50,40'},${0.04 + rnd() * 0.07})`;
      ctx.fillRect(rnd() * W, rnd() * H, 4 + rnd() * W * 0.4, 1 + rnd() * 5);
    }
    ctx.strokeStyle = 'rgba(30,24,20,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    if (sign.vertical) {
      // one character under another, then the arrow and the small line
      const chars = [...sign.text];
      const foot = (sign.arrow ? H * 0.2 : 0) + (sign.sub ? H * 0.13 : 0);
      const step = (H - 6 - foot) / chars.length;
      const size = Math.min(step * 0.95, W * 0.8);
      ctx.font = `800 ${size}px ${font}`;
      chars.forEach((ch, k) => ctx.fillText(ch, W / 2, 4 + step * (k + 0.5)));
      let at = H - foot;
      if (sign.arrow) {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(W / 2 - W * 0.09, at);
        ctx.lineTo(W / 2 + W * 0.09, at);
        ctx.lineTo(W / 2 + W * 0.09, at + H * 0.08);
        ctx.lineTo(W / 2 + W * 0.22, at + H * 0.08);
        ctx.lineTo(W / 2, at + H * 0.18);
        ctx.lineTo(W / 2 - W * 0.22, at + H * 0.08);
        ctx.lineTo(W / 2 - W * 0.09, at + H * 0.08);
        ctx.fill();
        at += H * 0.2;
      }
      if (sign.sub) {
        ctx.fillStyle = accent;
        ctx.font = `800 ${H * 0.1}px ${font}`;
        const fit = Math.min(1, (W - 4) / ctx.measureText(sign.sub).width);
        ctx.font = `800 ${H * 0.1 * fit}px ${font}`;
        ctx.fillText(sign.sub, W / 2, at + H * 0.05);
      }
    } else {
      const main = sign.sub ? H * 0.5 : H * 0.62;
      ctx.font = `800 ${main}px ${font}`;
      const fit = Math.min(1, (W - 12) / ctx.measureText(sign.text).width);
      ctx.font = `800 ${main * fit}px ${font}`;
      ctx.fillText(sign.text, W / 2, sign.sub ? H * 0.38 : H * 0.52);
      if (sign.sub) {
        ctx.fillStyle = accent;
        ctx.font = `800 ${H * 0.24}px ${font}`;
        const f2 = Math.min(1, (W - 10) / ctx.measureText(sign.sub).width);
        ctx.font = `800 ${H * 0.24 * f2}px ${font}`;
        ctx.fillText(sign.sub, W / 2, H * 0.78);
      }
    }
    ctx.restore();
    // the uv of its four corners: bottom left, bottom right, top right, top left
    const [u0, v0, u1, v1] = [x / 256, 1 - (y + CELL[1]) / 256, (x + CELL[0]) / 256, 1 - y / 256];
    return tall ? [[u1, v0], [u1, v1], [u0, v1], [u0, v0]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: t, rects };
}
