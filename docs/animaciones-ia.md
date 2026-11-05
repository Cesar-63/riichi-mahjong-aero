# Animaciones hechas por código con IA: evaluación

Evaluación de octubre y noviembre de 2026 de una forma de hacer videos y
animaciones del juego (presentación, tutoriales, piezas para redes y escenas
dentro del juego) **con IA en el proceso, pero no en los píxeles**: un modelo
de lenguaje maneja un programa 3D que dibuja cada cuadro, con assets y
animaciones de verdad. Complementa la
[visión de diseño](vision-mundo-y-comunidad.md) (bloques A, B y C).

> **Estado:** hecho el paso 1 de la [hoja de ruta](#8-hoja-de-ruta):
> `npm run lab:capture` graba cualquier escena del laboratorio en video,
> cuadro a cuadro. Además del juego tal cual (`color`), graba dos guías
> (`arcilla` y `profundidad`) para el camino opcional de
> [video a video](#6-opcional-video-a-video).

## 1. La técnica

Salió de dos videos: un reel de Instagram y un post de r/isthisAI. El reel
la resume en un diagrama:

```
Texto:   "Usando el programa [x] y las herramientas [y],
          genera una simulación de [z]"
            │
Agente:  Claude / ChatGPT ──▶ Programa (ya hecho, como Blender o
            │                  Unreal, o programado por la misma IA)
            ▼
         Video
```

El modelo de lenguaje hace los cambios que haría un animador: coloca los
assets, dispara sus animaciones, mueve la cámara, escribe los textos. El
programa dibuja cada cuadro.

El post de Reddit muestra un ejemplo: una serie de videos verticales que
explican algoritmos de ordenamiento ("Insertion Sort, como ordenar una mano
de cartas") con personajes chibi en 3D que saltan a su lugar, un panel con el
código y un gráfico de barras. Nadie en los comentarios encontró fallos de
IA, y es lógico: **no hay video generado**. Lo que delata la IA es la
cantidad de videos que sube la cuenta: con la plantilla hecha, cada episodio
nuevo es solo otro guion.

Lo que se aprende de ese ejemplo:

- **Se ve natural porque lo dibuja un motor 3D.** Nada se deforma entre
  cuadros; los movimientos son animaciones de verdad.
- **El volumen sale de la plantilla.** El trabajo está en el programa una
  vez; los episodios son datos.
- **Su punto débil son los assets.** Según los comentarios, los modelos son
  de *Umamusume*, sacados de los archivos del juego: personajes ajenos sin
  permiso. Con assets propios o de licencia libre, la técnica no tiene ese
  problema (ver [§4](#4-assets-y-derechos)).

## 2. Por qué encaja con este juego

**El juego ya tiene el programa.** En el diagrama, la "simulación de [z]"
aquí es el motor del juego, que reparte, juega y puntúa con las reglas
reales, y el programa que la dibuja es la mesa 3D:

- **El laboratorio** (`/lab.html`) reproduce manos guionadas con el motor
  real (`npm run lab:scenarios`): riichi, ron, tsumo, tres kan, empate,
  inicio de mano con el revuelto. Las jugadas son legales y los puntos
  correctos. En el ejemplo de Reddit el visualizador inventa los pasos del
  algoritmo; aquí los da el motor, así que un tutorial no puede tener una
  jugada ilegal ni un puntaje mal calculado.
- **Reloj virtual**: la página controla el tiempo de todas las animaciones,
  así que una escena se graba cuadro a cuadro y sale igual cada vez, en
  cualquier máquina y a cualquier fps.
- **Cámaras preparadas** (mesa completa, tu mano, cada rival, esquinas) y
  cámara libre.
- **El agente ya trabaja dentro del repositorio**: escribir una escena o un
  episodio es editar un archivo, sin pasar por un programa externo.
- **Las fichas salen exactas.** Es lo que ningún modelo de video consigue:
  si se le da libertad, inventa símbolos en las caras.

**Blender y Unreal**, los programas del reel, no hacen falta como base.
Unreal obligaría a rehacer la mesa, las fichas y las animaciones, y no corre
donde trabaja el agente. Blender sirve como complemento para planos de
tráiler con mejor luz (sombras suaves, humo, desenfoque): la escena del
laboratorio se puede exportar a glTF y abrir allá sin rehacer nada. Necesita
una máquina con GPU para renderizar.

## 3. Encaje con la visión de diseño

- **Estilo PS1 (bloque B).** La visión dice que lo que delata a la IA es el
  detalle liso y genérico, y que una estética de restricciones aplicada con
  consistencia se siente de autor. Es la misma conclusión que el ejemplo de
  Reddit: IA en el proceso, no en los píxeles. Los "assets cúbicos" son, en
  la versión de autor, los personajes PS1.
- **Un cuerpo base con un solo rig (bloque B) sirve para el juego y para los
  videos.** Las mismas animaciones (sentarse, robar, descartar, riichi, tirar
  palitos, romper la mano) sirven en la partida, en los tutoriales y en el
  tráiler. Un solo trabajo de personajes, no dos.
- **Cámara de cine (bloque A).** Las cámaras con movimiento para el tráiler
  son las mismas que la visión pide para el inicio de mano, el riichi y el
  ron. El laboratorio es el lugar para crear y afinar la mano rota con
  física, los palitos arrojados y la intro, y la captura las graba.
- **Repeticiones (bloque C).** La visión propone persistir las partidas
  completas (registro mjai más la semilla del muro) para repeticiones,
  cámara libre y modo comentarista. Si los episodios se arman **sobre ese
  mismo sistema** (una partida o una mano guardada, más textos y cámaras),
  una sola pieza sirve para:
  - tutoriales y tráiler (Edición 1),
  - repeticiones, modo comentarista y transmisión (Edición 2),
  - jugadas destacadas de la liga en video vertical, para las redes de
    Mahjong Chile.

  Cumple además la regla de la visión contra la dispersión: cada módulo se
  conecta a la plataforma común.
- **Reglas.** Los tutoriales de la Edición 1 explican las reglas tipo
  Tenhou; los de la liga, las WRC. El formato de episodio no se ata a un set
  de reglas: usa el que tenga el motor.

## 4. Assets y derechos

Un asset low-poly también tiene autor y licencia. Lo que lo hace seguro no
es lo tosco, sino la licencia:

- **Lo que sale del código del juego es propio** (fichas, mesa, sillas,
  palitos; three.js es MIT). Las fichas en `public/tiles/` son CC0.
- **Personajes provisorios CC0**: Kenney y Quaternius tienen personajes
  low-poly con esqueleto y animaciones (quieto, caminar, saludar, saltar) en
  glTF, que three.js reproduce directamente. Sirven para montar el sistema
  de rig y animaciones antes de tener los personajes propios, y como son
  CC0 también se pueden usar en las ediciones cerradas. Poly Pizza mezcla
  licencias: hay que mirar cada modelo.
- **Personajes finales: los del bloque B**, hechos para el juego.
- **Mixamo** (animaciones) se puede usar en videos y en un juego, pero sus
  archivos no se pueden redistribuir sueltos: no van en este repositorio,
  que es público.
- **Homenaje sí, copia no** (como dice la visión): nada sacado de otros
  juegos, que es justo el punto débil del ejemplo de Reddit.

Lo tosco ayuda en otra cosa: **no arrastra estilo**. Una caja simple no
choca con nada; el estilo lo pone la biblia de arte.

## 5. Usos, de más a menos prometedor

1. **Episodios cortos en vertical** para Reels y TikTok, con el formato del
   ejemplo: "Mahjong · Ep. 01: Riichi", la mesa, un panel (la mano, las
   esperas o el furiten marcado, en lugar del panel de código) y textos.
   Primero sin personajes, para validar el formato.
2. **Tráiler y presentación**: planos del laboratorio (revuelto, riichi, ron,
   los tres kan) con cámaras en movimiento y los avisos del juego.
3. **Retratos de los rivales.** Hoy los marcos muestran siluetas en
   penumbra. Con los personajes del bloque B sentados a la mesa, siempre en
   la misma pose y la misma luz, salen retratos uniformes y versiones
   animadas cortas (respirar, fumar, reaccionar a un ron).
4. **Jugadas destacadas de la liga** (Edición 2), cuando existan las
   repeticiones.
5. **Escenas dentro del juego** (cut-ins de yakuman): como se dibujan en
   vivo con la mano real, no hace falta video pregrabado.

## 6. Opcional: video a video

Hay otra técnica que circula con el mismo fin: renderizar la escena en
bloques (gris o profundidad) y dársela a un modelo de video
([Seedance](https://dreamina.capcut.com/es-es/seedance/seedance-2-5-3d-blockout-to-video),
[Wan VACE](https://comfyui.org/en/mastering-video-to-video-translation-wan2-1))
para que la "vista": materiales, luz, piel, humo. El movimiento queda el del
3D y el acabado lo pone la IA.

Aquí queda **solo como opción para algún tráiler**:

- va contra la sensación de hecho a mano que busca la visión;
- inventa símbolos en las fichas si se le da libertad; habría que
  enmascararlas o dejar a la IA solo los planos donde no se leen;
- cada clip sale por separado, así que cuesta mantener la coherencia entre
  planos;
- los servicios cobran por segundo generado, y Wan VACE pide una GPU de
  12 GB o más.

Por si se prueba, la captura ya graba las guías que esos modelos usan.

## 7. Lo que se hizo: `npm run lab:capture`

`scripts/lab-capture.mjs` abre `lab.html?captura` en Chromium (Playwright),
pausa el reloj del laboratorio y avanza un cuadro a la vez (1/fps), con una
captura de pantalla por cuadro. Después ffmpeg arma el `.mp4`.

```
npm run lab:capture -- --lista
npm run lab:capture -- --escena riichi-ron --camara "Mesa completa" \
  --pasadas color --fps 24 --ancho 1080 --alto 1920
```

| Pasada | Qué es | Para qué |
| --- | --- | --- |
| `color` | El juego tal cual, con los avisos | Episodios, tutoriales, tráiler |
| `arcilla` | Todo de un barro mate, sin texturas ni avisos; quedan las formas, la luz de la lámpara y las sombras | Guía para video a video |
| `profundidad` | Blanco cerca de la cámara, negro lejos; tu mano de frente en blanco | Guía de profundidad para video a video, exacta en vez de estimada |

Detalles:

- Lo transparente (sombras de contacto, carteles de dora, la penumbra
  detrás de tu mano) no aparece en las guías.
- El rango de la profundidad sigue a la cámara (de un poco antes de lo que
  mira hasta bastante más allá), así la mesa ocupa casi toda la escala de
  grises.
- Opciones: `--sin-mano`, `--sin-avisos`, `--desde`/`--hasta` (ms) para
  grabar una parte y `--cuadros` para conservar los PNG.
- Avanzar cuadro a cuadro en pausa ahora también mueve los avisos de
  llamada (antes quedaban congelados con el botón **Cuadro ▸**).
- **Velocidad**: en el entorno de prueba, sin GPU (WebGL por software),
  cada cuadro tarda de 3,5 s (profundidad, 1280×720) a 9 s (color,
  960×540): un clip de 8 s a 12 fps en las tres pasadas lleva una media
  hora. Con GPU debería ser mucho más rápido (sin medir).

## 8. Hoja de ruta

1. ✅ **Grabar escenas del laboratorio** en video (`npm run lab:capture`).
2. **Episodio piloto en vertical**: "Ep. 01: Riichi", con un panel de
   tutorial y textos sobre la mesa. Define el formato de episodio: un
   archivo con la mano, los textos, las cámaras y sus tiempos, que el
   agente pueda escribir rápido. *Hecho:* `public/lab/episodios/ep01-riichi.json`
   (ver [§10](#10-el-formato-de-episodio)).
3. **Cámaras en movimiento** con puntos clave (travelling, giro alrededor de
   la mesa): sirven para el tráiler y para la cámara de cine del bloque A.
4. **Escenas desde un registro mjai**, además de las manos armadas en
   `scripts/lab-scenarios.mjs`. Es el puente con las repeticiones del
   bloque C.
5. **Personajes a la mesa**: primero provisorios CC0 para montar el rig y
   las animaciones, después los del bloque B. *Primera prueba hecha:* tres
   hombres PSX de Mesh2Motion (CC0) sentados en el laboratorio, con
   animaciones de respirar y hablar (**Rivales en la mesa**,
   `--rivales`). Ver
   [public/models/personajes/README.md](../public/models/personajes/README.md).
6. Más episodios (chi y pon, furiten, esperas, yaku) y el tráiler.
7. Solo si hace falta, probar video a video en un tráiler.

## 9. Riesgos

- **Assets ajenos**: la regla es licencia libre o hecho para el juego.
- **Percepción**: parte de la comunidad rechaza lo hecho con IA. Con este
  camino cada cuadro sale del motor del juego; aun así, conviene decir cómo
  se hacen los videos.
- **Ritmo de trabajo**: es fácil volverlo un proyecto aparte. Mantenerlo
  atado al laboratorio y, después, a las repeticiones.
- **Código hecho con IA**: la visión asume que el autor es dueño del código
  escrito con Claude. Es razonable como práctica, pero el estatus legal del
  código generado con IA no está del todo resuelto: sumarlo a lo que hay que
  confirmar con alguien que sepa de licencias si la Edición 3 se vende.

## 10. El formato de episodio

Un episodio es un archivo JSON en `public/lab/episodios/` que dirige una
escena del laboratorio. Lo reproduce `public/js/lab-episode.js`, en su
propio tiempo, así que se graba cuadro a cuadro y sale igual cada vez.

| Campo | Qué es |
| --- | --- |
| `escena` | La escena del laboratorio (`scripts/lab-scenarios.mjs`), jugada por el motor real. |
| `duracion`, `ancho`, `alto` | Largo (ms) y tamaño del video (1080×1920, vertical). |
| `personas`, `yo`, `miManoEnLaMesa` | Rivales sentados; tu propio personaje en tu silla; tu mano parada sobre la mesa frente a él. |
| `tomas` | Cámara: desde cada `en` (ms) hasta la toma siguiente, de `desde` a `a` (`pos` y `mira`), suave o `lineal`; `orbita` gira alrededor de lo que mira. Cada toma corta a la siguiente. |
| `lento` | Cámara lenta: entre `en` y `hasta` la mesa avanza a `velocidad` (los textos no). |
| `textos` | Estilos: `titulo`, `narra` (papel arriba), `grande`, `grito` (¡Riichi!, con su `sub` en japonés), `pie` y `cierre`. |
| `avisos` | `false` quita los avisos del juego (¡Riichi!, ¡Tsumo!…), que se ubican junto a cada asiento y una cámara cercana puede dejar fuera de cuadro; el episodio los grita con `grito`. |
| `panel` | Abajo: `fichas` (notación `123m 68s`), `robada`, `espera` (resaltada) y una `nota`. |
| `acciones` | Qué hace quién (0 = tú, 1 = derecha, 2 = enfrente, 3 = izquierda): `talk` o una reacción (`victory`, `yes`, `clapping`, `reject`, `angry`, `confused`, `head-nod`, `idle-foldarms`), con `intensidad`, `ritmo` y `mantener`. |

Todos los tiempos son del episodio: la cámara lenta alarga la escena, así
que lo que pasa en la mesa después de una cámara lenta llega más tarde que
en la escena sola.

Para un episodio nuevo: una escena en `scripts/lab-scenarios.mjs` (la mano
y las jugadas, con pausas para la historia) y un archivo de episodio. Se
mira en `/lab.html?episodio=<id>` y se graba con
`npm run lab:capture -- --episodio <id>`.

