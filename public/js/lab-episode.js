// Episodes: short videos made from a lab scene (public/lab/episodios/*.json,
// docs/animaciones-ia.md). An episode directs the scene: camera shots that
// cut or move, slow motion, texts, a panel with tiles, and what the people
// at the table do. Everything runs on the episode's own time, advanced in
// steps (advance), so a recording is the same every time; slow motion slows
// the table's clock, not the texts.
import { parseIds, tileType } from './shared/tiles.js';
import { tileOfType } from './render.js';

const FADE = 300; // ms in and out for texts and panels
const RAMP = 250; // ms to go in and out of slow motion

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);
const xyz = ([x, y, z]) => ({ x, y, z });
// '123m 68s' → tile images
const tiles = (s) => parseIds(s).map((id) => tileOfType(tileType(id))).join('');
// how visible something on from en to hasta is at time t (fading in and out)
const shown = (o, t) => Math.max(0, Math.min(1, (t - o.en) / FADE, (o.hasta - t) / FADE));

// ep: the episode file; table: the lab's table; people: its characters
// (characters.js); clock: the lab's clock (stepped, paused).
export function createEpisode(ep, { root, table, people, clock }) {
  const end = ep.duracion;
  const shots = ep.tomas.map((s, i) => ({ ...s, hasta: i + 1 < ep.tomas.length ? ep.tomas[i + 1].en : end }));
  const acts = [...(ep.acciones || [])].sort((a, b) => a.en - b.en);
  let t = 0;
  let nextAct = 0;

  // the overlay: dark edges, the texts, the panel and a fade to black
  const box = document.createElement('div');
  box.className = 'ep';
  box.innerHTML = '<div class="ep-vignette"></div><div class="ep-layer"></div><div class="ep-fade"></div>';
  root.append(box);
  const layer = box.querySelector('.ep-layer');
  const fade = box.querySelector('.ep-fade');
  const items = [
    ...(ep.textos || []).map((o) => ({ ...o, kind: o.estilo || 'narra' })),
    ...(ep.panel || []).map((o) => ({ ...o, kind: 'panel' })),
  ].map((o) => {
    const el = document.createElement('div');
    el.className = `ep-${o.kind}`;
    el.innerHTML = html(o);
    el.style.opacity = '0';
    layer.append(el);
    return { o, el };
  });

  function html(o) {
    if (o.kind === 'panel') {
      return `${o.titulo ? `<h2>${esc(o.titulo)}</h2>` : ''}<div class="ep-tiles">${tiles(o.fichas)}${o.robada ? `<span class="ep-drawn">${tiles(o.robada)}</span>` : ''}</div>`
        + (o.espera ? `<p class="ep-wait"><span>${esc(o.esperaTexto || 'Esperas')}</span>${tiles(o.espera)}</p>` : '')
        + (o.nota ? `<p class="ep-note">${esc(o.nota)}</p>` : '');
    }
    if (o.kind === 'titulo' || o.kind === 'cierre') {
      return `<small>${esc(o.serie || '')}</small><h1>${esc(o.texto)}</h1>${o.sub ? `<p>${esc(o.sub)}</p>` : ''}`;
    }
    return `<p>${esc(o.texto).replace(/\n/g, '<br>')}</p>`;
  }

  // table speed at time t (1, or slower inside a slow motion window)
  function speed(at) {
    for (const w of ep.lento || []) {
      if (at < w.en || at > w.hasta) continue;
      const u = Math.min(1, (at - w.en) / RAMP, (w.hasta - at) / RAMP);
      return 1 + (w.velocidad - 1) * u;
    }
    return 1;
  }

  // a shot: from desde to a (if given), eased over the shot; orbita turns
  // the camera that many degrees round what it looks at
  function camera(at) {
    const s = shots.findLast((x) => x.en <= at) || shots[0];
    const u0 = Math.min(1, (at - s.en) / Math.max(1, s.hasta - s.en));
    const u = s.curva === 'lineal' ? u0 : smooth(u0);
    let pos = s.desde.pos;
    let look = s.desde.mira;
    if (s.a) {
      pos = mix(pos, s.a.pos, u);
      look = mix(look, s.a.mira, u);
    }
    if (s.orbita) {
      const a = (s.orbita * Math.PI / 180) * u;
      const dx = pos[0] - look[0];
      const dz = pos[2] - look[2];
      pos = [look[0] + dx * Math.cos(a) - dz * Math.sin(a), pos[1], look[2] + dx * Math.sin(a) + dz * Math.cos(a)];
    }
    return { pos: xyz(pos), target: xyz(look) };
  }

  function show() {
    table.lockView(camera(t));
    for (const { o, el } of items) {
      const v = shown(o, t);
      el.style.opacity = String(v);
      el.style.transform = `translateY(${(1 - v) * 0.6}cqw)`;
    }
    // from and to black
    const f = ep.fundido || 600;
    fade.style.opacity = String(Math.max(0, 1 - t / f, 1 - (end - t) / f));
  }

  show();
  return {
    duration: end,
    get time() {
      return t;
    },
    // ms of episode time: the table moves that much times the speed
    advance(ms) {
      const steps = Math.max(1, Math.round(ms / 10));
      let moved = 0;
      for (let i = 0; i < steps; i++) moved += (ms / steps) * speed(t + (i + 0.5) * (ms / steps));
      clock.step += moved;
      t += ms;
      while (nextAct < acts.length && acts[nextAct].en <= t) {
        const a = acts[nextAct++];
        people.act(a.quien, a.hace, { intensity: a.intensidad ?? 1, pace: a.ritmo ?? 1, hold: !!a.mantener });
      }
      show();
    },
    destroy() {
      box.remove();
    },
  };
}
