// Animation speeds, timings and lighting of the 3D table, gathered in one
// place so the animation lab (lab.html) can change them while it plays. The
// game reads them where they are used, so a change shows at once; the values
// here are the ones the game ships with.
export const TUNING = {
  motion: { speed: 48, fast: 96, mine: 150, stick: 0.6, call: 96, callSlide: 18, callPause: 70 },
  hand: { drawSpeed: 156, moveSpeed: 78, selectLift: 0.38 },
  win: { callMs: 900, placeMs: 150, placeGap: 18, fallAt: 1500, tileMs: 45, dropMs: 240, flyMs: 240, flyGap: 60, holdMs: 1800 },
  draw: { startMs: 900, tileMs: 40, holdMs: 3000 },
  dice: { landed: 0.6, pickUp: 0.7 },
  drawer: { speed: 7 },
  light: { exposure: 0.95, lamp: 820, hemi: 0.26, ambient: 0.08, environment: 0.35, handAmbient: 0.55, handKey: 1.7 },
};

// What each value is, for the lab's panel: [label, min, max, step]
export const TUNING_INFO = {
  motion: {
    _: 'Movimiento de fichas (unidades = anchos de ficha por segundo)',
    speed: ['Velocidad normal (llamadas, dora, manos)', 5, 200, 1],
    fast: ['Robos y descartes de rivales', 5, 300, 1],
    mine: ['Tu descarte', 5, 400, 1],
    stick: ['Palito de riichi (× velocidad normal)', 0.1, 3, 0.05],
    call: ['Llamadas: fichas yendo a juntarse', 5, 300, 1],
    callSlide: ['Llamada deslizándose por el borde hasta la esquina', 1, 60, 0.5],
    callPause: ['Pausa de la llamada en el borde antes de deslizarse (ms)', 0, 1000, 10],
  },
  hand: {
    _: 'Tu mano (en anchos de ficha)',
    drawSpeed: ['Ficha robada llegando a la mano', 10, 400, 1],
    moveSpeed: ['Mano reacomodándose', 10, 300, 1],
    selectLift: ['Altura de la ficha levantada', 0, 1.2, 0.02],
  },
  win: {
    _: 'Victoria (ms)',
    callMs: ['Aviso antes de mostrar la mano', 0, 3000, 10],
    placeMs: ['Tu mano apoyándose (cada ficha)', 0, 1000, 10],
    placeGap: ['Entre fichas al apoyar tu mano', 0, 200, 1],
    fallAt: ['Comienzo de la caída', 0, 4000, 10],
    tileMs: ['Entre fichas al caer', 0, 300, 1],
    dropMs: ['Duración de la caída de una ficha', 20, 1500, 10],
    flyMs: ['Vuelo de cada dora', 20, 1500, 10],
    flyGap: ['Entre dora', 0, 500, 5],
    holdMs: ['Pausa antes de la hoja de resultado', 0, 6000, 50],
  },
  draw: {
    _: 'Empate (ms)',
    startMs: ['Comienzo de la caída', 0, 4000, 10],
    tileMs: ['Entre fichas al caer', 0, 300, 1],
    holdMs: ['Pausa antes de la hoja de resultado', 0, 6000, 50],
  },
  dice: {
    _: 'Dados (fracción de su parte del inicio de mano)',
    landed: ['Fin del lanzamiento', 0.1, 0.95, 0.01],
    pickUp: ['Se levantan para ordenarse', 0.1, 0.99, 0.01],
  },
  drawer: {
    _: 'Cajón de puntos',
    speed: ['Velocidad al abrir y cerrar', 1, 40, 0.5],
  },
  light: {
    _: 'Luz',
    exposure: ['Exposición general', 0.3, 2, 0.01],
    lamp: ['Lámpara', 0, 3000, 10],
    hemi: ['Luz de relleno', 0, 1.5, 0.01],
    ambient: ['Luz ambiente', 0, 1, 0.01],
    environment: ['Reflejos del entorno', 0, 2, 0.01],
    handAmbient: ['Tu mano: ambiente', 0, 2, 0.01],
    handKey: ['Tu mano: luz principal', 0, 4, 0.01],
  },
};

export const TUNING_DEFAULTS = JSON.parse(JSON.stringify(TUNING));
