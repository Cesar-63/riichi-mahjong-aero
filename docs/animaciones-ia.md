# Animaciones con IA a partir de la mesa 3D: evaluación

Evaluación de octubre de 2026 de una técnica para hacer videos con IA que
no "se notan": **no se le pide a la IA que invente el video desde cero**. Se
arma la escena en 3D con piezas simples (bloques, assets low-poly), con la
cámara, las posiciones y los tiempos exactos, y la IA solo le pone la piel
encima (video a video). La idea es usarla para presentar el juego, para
tutoriales y para piezas que acompañen el juego.

> **Estado:** paso 1 de la [hoja de ruta](#7-hoja-de-ruta) hecho:
> `npm run lab:capture` graba cualquier escena del laboratorio en video, cuadro a
> cuadro, en tres pasadas: `color` (el juego tal cual), `arcilla` y
> `profundidad` (las guías para la IA). Falta probar las guías en un
> servicio de video (paso 2), que necesita una cuenta.

## 1. La técnica

No se pudieron abrir los dos videos originales (Instagram y Reddit no se
pueden abrir desde el entorno donde se hizo esta evaluación). Lo que sigue
se reconstruyó con búsquedas. El método que describen es el mismo que hoy
se llama *previz* o *blockout to video*:

1. **Armar la escena en 3D con piezas sin detalle.** Cubos, cajas,
   personajes low-poly. Lo arma una persona o una IA que maneja el programa
   3D (por ejemplo, Claude con [Blender MCP](https://claudelog.com/claude-code-mcps/blender-mcp),
   que ejecuta Python dentro de Blender, o three.js por código, como este
   juego).
2. **Animar y renderizar.** Movimientos, cámara y tiempos salen del 3D, así
   que son físicamente coherentes: nada se deforma ni cambia de forma entre
   cuadros, que es lo que más delata a un video hecho solo con IA.
3. **Video a video.** El render (gris, de arcilla, o un mapa de
   profundidad) entra como guía a un modelo de video junto con un texto o
   una imagen de estilo, y el modelo lo "viste": materiales, luz, piel,
   humo, grano de cámara. El movimiento y el encuadre quedan los del 3D.

Por qué se ve natural: la IA no decide *qué* pasa ni *dónde*, solo *cómo se
ve*. Las piezas toscas no le imponen un estilo, así que el estilo lo pone el
texto (un salón de mahjong de los 80 con humo, por ejemplo).

Herramientas que aparecieron (sin probar todavía; la mayor parte de lo que
se encontró es material de los propios proveedores):

| | Qué acepta como guía | Notas |
| --- | --- | --- |
| **Seedance 2.x** (ByteDance, en Dreamina/CapCut) | Video de referencia (hasta ~15 s según una guía) + texto | Sus páginas muestran justo el flujo [blockout de Blender → video](https://dreamina.capcut.com/es-es/seedance/seedance-2-5-3d-blockout-to-video); la versión exacta (2.0 o 2.5) no está clara. |
| **Wan 2.1 / 2.2 VACE** en ComfyUI (abierto) | Video de control: profundidad, pose, o el video mismo, más una imagen de estilo y máscaras | Corre en una PC propia; las guías piden ≥ 12 GB de VRAM. Las [guías de VACE](https://comfyui.org/en/mastering-video-to-video-translation-wan2-1) suelen sacar la profundidad con DepthAnything; nosotros ya la tenemos exacta. |
| Runway, Kling, Luma y otros servicios | Video a video con texto | Por probar; cambian rápido. |

## 2. Por qué encaja con este juego

**El juego ya es el "blockout".** Lo que en el flujo de arriba hay que armar
a mano, aquí ya existe y es exacto:

- **Fichas estilo PS2**: cajas casi rectas con el bisel pintado. Son
  justamente el tipo de pieza simple que el flujo pide.
- **El laboratorio** (`/lab.html`) reproduce manos guionadas con el motor
  real (`npm run lab:scenarios`): riichi, ron, tsumo, tres kan, empate,
  inicio de mano con el revuelto. Las jugadas son legales y los puntos
  correctos, algo que ningún modelo de video consigue solo.
- **Reloj virtual**: la página controla el tiempo de todas las animaciones,
  así que una escena se puede grabar cuadro a cuadro y sale igual cada vez,
  en cualquier máquina y a cualquier fps.
- **Cámaras preparadas** (mesa completa, tu mano, cada rival, esquinas) y
  cámara libre.
- Las escenas duran de 4,7 a 12,1 s, la misma escala que los clips que
  aceptan los modelos de video (5–15 s).

**El gran riesgo son las caras de las fichas.** Un modelo de video no sabe
que 🀄 es el chun ni que la mano tiene que seguir siendo la misma de un
cuadro al otro: si se le da libertad, inventa símbolos. Por eso:

- En los planos donde hay que **leer** las fichas (tutoriales, la mano
  ganadora), se usa la pasada `color`, que ya es el juego, o se pasa la IA
  con poca fuerza y con una **máscara** sobre las fichas (VACE la acepta).
- La IA rinde más en planos donde las fichas no se leen: el salón, la luz,
  el humo, manos de personas, rivales, transiciones, planos generales.
- Los avisos grandes (¡Riichi!, ¡Ron!) no van en las guías y se ponen
  después, desde la toma `color`, para que la IA no deforme las letras.

## 3. Assets low-poly y derechos

La intuición es buena, con un matiz: **un asset low-poly también tiene
autor y licencia**. Lo que lo hace seguro no es lo tosco, sino la licencia:

- **Lo que sale del código del juego es nuestro** (fichas, mesa, sillas,
  palitos; three.js es MIT). Las fichas en `public/tiles/` son CC0.
- **Bibliotecas CC0** (sin pedir permiso ni citar): Kenney y Quaternius
  (personajes low-poly, varios ya animados), Poly Haven (texturas y HDRI).
  Poly Pizza mezcla licencias: hay que mirar cada modelo.
- **Mixamo** (animaciones de personajes) se puede usar en videos y en el
  juego, pero sus archivos no se pueden redistribuir sueltos: no se suben al
  repositorio (que es público).
- Lo que genera un servicio de IA depende de sus términos de uso: hay que
  leerlos antes de usar los clips en algo comercial. Como el juego es sin
  fines de lucro, el riesgo es bajo, pero conviene anotar en cada clip con
  qué se hizo.

Lo tosco sí ayuda en otra cosa: **no arrastra estilo**. Una caja gris no
choca con nada; el sombreado y el ambiente se los pone la guía de estilo.

## 4. Usos, de más a menos prometedor

1. **Tráiler y presentación.** Planos del laboratorio (revuelto e inicio de
   mano, riichi, ron, los tres kan) vestidos por la IA como un salón real:
   humo en el cono de la lámpara, paño gastado, manos que mueven las fichas.
   Planos cortos montados con los avisos del juego encima.
2. **Retratos de los rivales.** Hoy los marcos muestran siluetas en
   penumbra ("Aún no hay retratos"). Un personaje low-poly CC0 sentado a la
   mesa, siempre en la misma pose y con la misma luz, vestido por la IA, da
   retratos con un estilo uniforme, y también versiones cortas animadas
   (respirar, fumar, reaccionar a un ron).
3. **Tutoriales.** Aquí manda la exactitud: escenas nuevas en el
   laboratorio (chi y pon, furiten, esperas, riichi) grabadas en `color`,
   con texto encima. La IA solo para la entrada y las transiciones.
4. **Escenas dentro del juego** (cut-ins de yakuman, final de partida). Un
   video pregrabado no sabe qué mano ganó, así que solo sirve para momentos
   genéricos o con la mano real compuesta encima. Pesa más y se ve igual
   cada vez: dejarlo para el final.

## 5. Lo que se hizo: `npm run lab:capture`

`scripts/lab-capture.mjs` abre `lab.html?captura` en Chromium (Playwright),
pausa el reloj del laboratorio y avanza un cuadro a la vez (1/fps), con una
captura de pantalla por cuadro. Después ffmpeg arma el `.mp4`.

```
npm run lab:capture -- --lista
npm run lab:capture -- --escena riichi-ron --camara "Mesa completa" \
  --pasadas color,arcilla,profundidad --fps 24 --ancho 1280 --alto 720
```

| Pasada | Qué es | Para qué |
| --- | --- | --- |
| `color` | El juego tal cual, con los avisos | Tutoriales; la toma de donde salen los avisos y las fichas legibles |
| `arcilla` | Todo de un barro mate, sin texturas ni avisos; quedan las formas, la luz de la lámpara y las sombras | El "blockout" que se le da a la IA como video de referencia |
| `profundidad` | Blanco cerca de la cámara, negro lejos; tu mano de frente en blanco | Control de profundidad (VACE y similares), exacto en vez de estimado |

Detalles:

- Lo transparente (sombras de contacto, carteles de dora, la penumbra
  detrás de tu mano) no aparece en las guías.
- El rango de la profundidad sigue a la cámara (de un poco antes de lo que
  mira hasta bastante más allá), así la mesa siempre ocupa casi toda la
  escala de grises.
- Opciones: `--sin-mano`, `--sin-avisos`, `--desde`/`--hasta` (ms) para
  grabar una parte y `--cuadros` para conservar los PNG.
- Avanzar cuadro a cuadro en pausa ahora también mueve los avisos de
  llamada (antes quedaban congelados con el botón **Cuadro ▸**).
- **Velocidad**: en el entorno de prueba, sin GPU (WebGL por software),
  cada cuadro tarda de 3,5 s (profundidad, 1280×720) a 9 s (color,
  960×540): un clip de 8 s a 12 fps en las tres pasadas lleva una media
  hora. Con GPU debería ser mucho más rápido (sin medir).

## 6. Riesgos

- **Fichas inventadas** (ver [§2](#2-por-qué-encaja-con-este-juego)): la
  regla es no dejar que la IA toque fichas que haya que leer.
- **Coherencia entre planos**: cada clip lo genera la IA por separado.
  Usar siempre la misma imagen de estilo y el mismo texto, y planos cortos.
- **Percepción**: parte de la comunidad rechaza lo hecho con IA. Que el
  juego en sí no dependa de ello y decir con qué se hicieron los videos.
- **Costo**: los servicios cobran por segundo generado; VACE local es
  gratis pero pide una GPU grande.

## 7. Hoja de ruta

1. ✅ **Grabar las guías** desde el laboratorio (`npm run lab:capture`).
2. **Probar 2 o 3 clips** (riichi-ron en mesa completa, el revuelto
   desde arriba, tu tsumo de cerca) en Seedance y en Wan VACE, con la
   misma imagen de estilo. Comparar: ¿se mantienen las fichas?, ¿hace falta
   máscara?, ¿cuál guía funciona mejor, arcilla o profundidad?
3. **Cámaras en movimiento** para el tráiler: trayectorias de cámara con
   puntos clave (travelling, giro alrededor de la mesa) en el laboratorio y
   en la captura.
4. **Personajes a la mesa**: cargar personajes low-poly CC0 (glTF) en la
   escena del laboratorio, sentados en las sillas, con animaciones simples
   (robar, descartar, reaccionar). Base para retratos y planos del tráiler.
5. **Escenas para tutoriales** en `scripts/lab-scenarios.mjs` (chi, pon,
   furiten, esperas, riichi), grabadas en `color`.
6. Solo si lo anterior funciona: cut-ins dentro del juego.
