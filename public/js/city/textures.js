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
  wallpaper: [64, (ctx, s, r) => {
    grain(ctx, s, s, [142, 150, 118], 7, r);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(60,70,40,0.22)';
      ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = 'rgba(220,210,160,0.18)';
      ctx.fillRect(x + 9, 0, 1, s);
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
  asphalt: [128, (ctx, s, r) => {
    grain(ctx, s, s, [112, 114, 122], 14, r);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(210,210,220,0.25)' : 'rgba(20,20,26,0.3)';
      ctx.fillRect(r() * s, r() * s, 1, 1);
    }
    // a crack and an old patch
    ctx.fillStyle = 'rgba(40,40,48,0.25)';
    ctx.fillRect(70, 20, 34, 26);
    let x = 10;
    let y = 90;
    for (let i = 0; i < 12; i++) {
      const nx = x + 4 + r() * 6;
      const ny = y + (r() - 0.5) * 8;
      line(ctx, x, y, nx, ny, 'rgba(20,20,26,0.5)');
      x = nx;
      y = ny;
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
  brick: [128, (ctx, s, r) => {
    ctx.fillStyle = '#5a504a';
    ctx.fillRect(0, 0, s, s);
    const bw = 32;
    const bh = 16;
    for (let row = 0; row < s / bh; row++) {
      for (let col = -1; col < s / bw; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0);
        const k = 150 + r() * 40;
        ctx.fillStyle = `rgb(${k},${k * 0.62},${k * 0.5})`;
        ctx.fillRect(x + 1, row * bh + 1, bw - 2, bh - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 1, row * bh + 1, bw - 2, 2);
      }
    }
  }],
  shutter: [64, (ctx, s, r) => {
    grain(ctx, s, s, [150, 154, 158], 6, r);
    for (let y = 0; y < s; y += 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(0, y, s, 2);
      ctx.fillStyle = 'rgba(20,22,28,0.35)';
      ctx.fillRect(0, y + 6, s, 2);
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(110,70,40,0.12)';
      ctx.fillRect(r() * s, r() * s, 3 + r() * 5, 12 + r() * 20);
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
    // lit from inside: the glass at full brightness, the frame dark
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b8b8b8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(6, 40, 20, 18); // something behind the glass
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(36, 34, 14, 26);
    ctx.fillStyle = '#16161c';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, s - 3, s, 3);
    ctx.fillRect(0, 0, 3, s);
    ctx.fillRect(s - 3, 0, 3, s);
    ctx.fillRect(s / 2 - 1, 0, 2, s);
    ctx.fillRect(0, s / 2 - 1, s, 2);
  }],
  vending: [64, (ctx, s, r) => {
    ctx.fillStyle = '#e8f2ff';
    ctx.fillRect(0, 0, s, s);
    const cans = ['#e04040', '#40a0e0', '#f0c030', '#40c070', '#f08030', '#a060e0'];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        ctx.fillStyle = cans[Math.floor(r() * cans.length)];
        ctx.fillRect(5 + col * 9.5, 5 + row * 15, 6, 10);
      }
      ctx.fillStyle = '#8090a8';
      ctx.fillRect(2, 16.5 + row * 15, s - 4, 2);
    }
    ctx.fillStyle = '#28303c';
    ctx.fillRect(0, 50, s, 14);
    ctx.fillStyle = '#ff5050';
    ctx.fillRect(44, 53, 12, 4);
  }],
  paper: [64, (ctx, s, r) => {
    grain(ctx, s, s, [214, 204, 178], 6, r);
    for (let y = 10; y < s - 6; y += 7) line(ctx, 6, y, 6 + 20 + r() * 30, y, 'rgba(40,30,20,0.55)');
    ctx.fillStyle = 'rgba(190,40,30,0.7)';
    ctx.fillRect(s - 16, s - 16, 9, 9);
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

// A soft round spot, white in the middle: the halo of a neon sign or a
// lamp (drawn additively) and, in black, the shadow under someone's feet.
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

// All the neon signs of a zone on one 256 px texture (one draw call for
// the lot). Returns the texture and where each sign is in it: [u0, v0, u1, v1].
const CELL = [128, 64];
export function neonAtlas(signs) {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  const font = '"Zen Kaku Gothic New", "Noto Sans JP", sans-serif';
  const rects = signs.map((sign, i) => {
    const x = (i % 2) * CELL[0];
    const y = Math.floor(i / 2) * CELL[1];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL[0], CELL[1]);
    ctx.clip();
    ctx.fillStyle = '#0c0a10';
    ctx.fillRect(x, y, CELL[0], CELL[1]);
    // the cell is stretched over the sign: draw as if it had its shape
    const [w, h] = sign.size;
    const H = CELL[1];
    const W = H * (w / h);
    ctx.translate(x, y);
    ctx.scale(CELL[0] / W, 1);
    const tube = (draw) => {
      ctx.shadowColor = sign.color;
      ctx.shadowBlur = 7;
      ctx.strokeStyle = ctx.fillStyle = sign.color;
      draw();
      draw();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ctx.fillStyle = 'rgba(255,255,255,0.75)';
      draw();
    };
    ctx.lineWidth = 2;
    tube(() => ctx.strokeRect(4, 4, W - 8, H - 8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const main = sign.sub ? H * 0.5 : H * 0.62;
    ctx.font = `700 ${main}px ${font}`;
    const fit = Math.min(1, (W - 18) / ctx.measureText(sign.text).width);
    ctx.font = `700 ${main * fit}px ${font}`;
    tube(() => ctx.fillText(sign.text, W / 2, sign.sub ? H * 0.4 : H * 0.53));
    if (sign.sub) {
      ctx.font = `700 ${H * 0.2}px ${font}`;
      tube(() => ctx.fillText(sign.sub, W / 2, H * 0.78));
    }
    ctx.restore();
    return [x / 256, 1 - (y + CELL[1]) / 256, (x + CELL[0]) / 256, 1 - y / 256];
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return { texture: t, rects };
}
