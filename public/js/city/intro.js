// The town's opening scene: a few camera shots over the zones, played when
// the player arrives from the menu, with no drawing in it (the tests run
// this in node). The shots are data (map.json "intro"): each one shows a
// zone with a camera that glides from one place to another, a caption, and
// a cut through black to the next. The last one ends on the zone's own
// camera ("to": "play"), so the walk starts where the scene leaves off.

export const INTRO_FADE = 0.4; // seconds of black at each cut, by default

const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
// slow at both ends, as a camera on a dolly
const ease = (u) => u * u * (3 - 2 * u);

// The camera a shot ends on: its own, or the zone's camera for "play"
export function shotEnd(shot, map) {
  if (shot.to !== 'play') return shot.to;
  const cam = map.zones[shot.zone].camera;
  return { position: cam.position, target: cam.target, fov: cam.fov };
}

export function introLength(intro) {
  return (intro?.shots || []).reduce((t, s) => t + s.duration, 0);
}

// What the scene shows t seconds in: the shot (and its index), the camera
// (position, target, fov), how dark the screen is (0 to 1) and how visible
// the caption is. Null once it is over.
export function introAt(intro, map, t) {
  const shots = intro?.shots || [];
  const fade = intro.fade ?? INTRO_FADE;
  let start = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const lt = t - start;
    start += shot.duration;
    if (t >= start) continue;
    const d = shot.duration;
    const k = ease(Math.min(1, Math.max(0, lt / d)));
    const end = shotEnd(shot, map);
    // a curved path through `via`, if the shot has one
    const position = shot.via
      ? shot.from.position.map((p, j) => (1 - k) * (1 - k) * p + 2 * (1 - k) * k * shot.via[j] + k * k * end.position[j])
      : lerp3(shot.from.position, end.position, k);
    const last = i === shots.length - 1;
    const dark = Math.max(
      lt < fade ? 1 - lt / fade : 0,
      !last && lt > d - fade ? (lt - (d - fade)) / fade : 0,
    );
    // the caption comes in after the cut and leaves before the next one
    const tin = fade + 0.3;
    const tout = d - fade - 0.5;
    const caption = shot.text ? Math.max(0, Math.min(1, (lt - tin) / 0.6, (tout - lt) / 0.6)) : 0;
    return {
      index: i,
      shot,
      camera: { position, target: lerp3(shot.from.target, end.target, k), fov: lerp(shot.from.fov, end.fov, k) },
      dark: Math.min(1, dark),
      caption,
    };
  }
  return null;
}

// The words of a caption, with {name} and {about} of the player's character
export function captionText(text, character) {
  return (text || '').replace(/\{name\}/g, character?.name || '').replace(/\{about\}/g, character?.about || '');
}

// What is wrong with the scene of a map, as sentences (none: nothing)
export function introProblems(map) {
  const intro = map.intro;
  if (!intro) return [];
  const out = [];
  const shots = intro.shots;
  if (!Array.isArray(shots) || !shots.length) return ['la escena de entrada no tiene tomas'];
  const isCam = (c) => c && [c.position, c.target].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) && Number.isFinite(c.fov);
  shots.forEach((s, i) => {
    const what = `toma ${i + 1} de la escena de entrada`;
    const zone = map.zones?.[s.zone];
    if (!zone) return out.push(`${what}: no existe la zona "${s.zone}"`);
    if (!(s.duration > 0)) out.push(`${what}: sin duración`);
    if (!isCam(s.from)) out.push(`${what}: falta la cámara de inicio`);
    if (s.to === 'play') {
      if (zone.camera?.type !== 'fixed') out.push(`${what}: "play" solo sirve en una zona de cámara fija`);
    } else if (!isCam(s.to)) out.push(`${what}: falta la cámara final`);
    if (s.via && !(Array.isArray(s.via) && s.via.length === 3)) out.push(`${what}: "via" no es un punto`);
  });
  const last = shots[shots.length - 1];
  if (last.zone !== map.start?.zone || last.to !== 'play') out.push('la escena de entrada tiene que terminar en la cámara del punto de inicio ("to": "play")');
  return out;
}
