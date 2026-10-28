# Un cerebro para los bots: investigación de materiales

Investigación de octubre de 2026 sobre tres proyectos que podrían darles
inteligencia a los bots: **Mortal**, **akochan** y **mjai-reviewer**. Se
clonaron y leyeron los tres repositorios. akochan se compiló y se midió aquí.
También se revisaron los pesos de Mortal publicados por la comunidad en
Hugging Face. Una búsqueda ampliada en Hugging Face y GitHub encontró más
opciones, entre ellas **majiang-ai**, una IA en JavaScript con licencia MIT:
ver [§6](#6-búsqueda-ampliada-más-opciones).

> **Estado (octubre de 2026):** los pasos 1 y 2 de la
> [hoja de ruta](#5-hoja-de-ruta-propuesta) están hechos. El motor guarda el
> registro mjai de cada mano, validado con `validate_logs` de Mortal, y los
> bots juegan con majiang-ai. En 12 partidas entre bots (4.291 decisiones):
> ninguna respuesta ilegal, ~39 ms por decisión de media y ~1 s en el peor
> caso; 22,4 % de manos ganadas, 15,3 % de ron repartido, 21,8 % de riichi.
>
> **Paso 3 hecho (opción B, todo dentro de la función):** bots difíciles con
> Mortal y los pesos Mortal-S42, mezclables con los normales en la misma mesa.
> libriichi va compilado a WASM sin su capa de Python, y la red en ONNX con
> onnxruntime-web. Verificado: misma acción que PyTorch en 3.000 posiciones y
> misma acción que el libriichi original en 23.198 posiciones, y de punta a
> punta lo mismo que el bot oficial de Mortal en 1.867 decisiones. Unos 70 ms
> por decisión. En 512 partidas duplicadas (1 difícil contra 3 normales) el
> puesto medio del difícil fue 2,31 ± 0,11: más fuerte que el normal. El ajuste
> de tonpuusen previsto en el plan (mostrar el Este como Sur) se probó en otras
> 512 y lo empeoró, así que se quitó. El juego pasó a AGPL-3.0. Detalles en [mortal/README.md](../mortal/README.md).

## Resumen

| | Mortal | akochan | mjai-reviewer |
| --- | --- | --- | --- |
| Qué es | IA por aprendizaje por refuerzo profundo (red neuronal) | IA "clásica": cálculo de valor esperado con estimadores estadísticos | Herramienta que revisa partidas usando Mortal o akochan |
| Fuerza | La más fuerte de las tres (le gana a akochan) | Fuerte, pero por debajo de Mortal | No juega |
| Lenguaje | Rust (motor y codificación) + Python/PyTorch (red) | C++ con Boost y OpenMP | Rust |
| ¿Trae lo necesario para jugar? | El código sí; **los pesos oficiales no se publican** | Sí: el código y los parámetros vienen en el repo | No: necesita un motor |
| Velocidad por decisión | ~0,3 GMAC por inferencia, del orden de 10–100 ms en CPU (estimado) | **~1,5 s** (medido aquí, 4 núcleos) | — |
| Licencia | Código AGPL-3.0 | Propia y restrictiva: uso no comercial, prohibido redistribuir versiones modificadas | Apache-2.0 |
| Utilidad para nosotros | **El cerebro del nivel "difícil"** | Rival de entrenamiento o referencia fuera de línea, e ideas | Protocolo mjai, conversor de registros y la idea de "revisar mi partida" |

**Recomendación** (actualizada tras la búsqueda ampliada):

1. Guardar el registro de cada mano en formato **mjai**, la base de todo lo
   demás.
2. Para el nivel "normal", **adaptar majiang-ai** (JS, MIT, ~40 ms por
   decisión, medido aquí) en lugar de escribir heurísticas desde cero.
3. Para el nivel "difícil", **Mortal**: pesos Mortal-S42 (Apache-2.0, v4) o
   mortal3-b40c192 (AGPL, v3, ya en ONNX y con un codificador más corto). Esto
   exige una decisión de licencia, porque el codificador de Mortal es AGPL. Ver
   [Decisiones pendientes](#decisiones-pendientes).

## Punto de partida

`server/engine/bot.js` (17 líneas) siempre tira la ficha que acaba de robar,
hace pon o chi cuando puede y nunca declara ron, tsumo, riichi ni kan. El bot
corre dentro de la función de Vercel (`api/game.js`, `maxDuration: 10`).
Cada acción carga el estado desde Redis, y `TIMING.botMs` (600 ms) es el
tiempo de "pensar".

Dos datos que importan para integrar cualquier IA:

- **Las fichas ya están en el mismo orden que usa Mortal**: el tipo 0–33
  (`tileType(id) = id >> 2`) sigue el orden m, p, s, E S W N, haku hatsu chun,
  igual que libriichi. Los 5 rojos de Mortal son las acciones 34/35/36. Para
  nosotros son los ids 16, 52 y 88.
- **El motor no guarda la historia completa de la mano**: `s.events` solo
  conserva los últimos 12 eventos. Mortal y akochan necesitan *todos* los
  eventos de la mano en orden (tsumo, dahai con tsumogiri, llamadas, riichi,
  dora…). Hay que agregar un registro mjai por mano.

---

## 1. Mortal (Equim-chan/Mortal)

### Qué es

Una IA de riichi para 4 jugadores **con reglas de ranked de Tenhou**, las
mismas que imita este juego. Se entrena con aprendizaje por refuerzo: primero
**fuera de línea**, con partidas de jugadores fuertes de Tenhou (CQL, *conservative Q-learning*),
y luego en línea jugando contra sí misma. Fue un proyecto activo hasta 2025;
el último commit es de septiembre de 2025.

Componentes:

- **`libriichi/`** (Rust, ~14k líneas): estado del jugador, shanten, cálculo
  de agari y puntos, el emulador de partidas (*arena*), lectura de registros
  mjai y la **codificación de la observación** que alimenta la red.
- **`mortal/`** (Python, ~2k líneas): la red en PyTorch (`model.py`), el motor
  de inferencia (`engine.py`) y el entrenamiento (`train.py`).
- `mortal.py <id>`: un bot mjai por stdin/stdout. Lee eventos JSON y responde
  con la acción.

### Cómo "piensa"

- **Entrada:** un tensor de **1012 × 34** (versión 4 del modelo). 34 es el
  número de tipos de ficha y 1012 los canales: mano propia, descartes de
  cada jugador (con tsumogiri y riichi), llamadas, dora, puntos, ronda,
  honba, acciones posibles… La versión 4 incluye además **tablas de
  valor esperado "en solitario"**: para cada descarte, la probabilidad de
  tenpai, de ganar y el valor esperado turno por turno. Es un port del
  calculador de [nekobean/mahjong-cpp](https://github.com/nekobean/mahjong-cpp)
  (GPL-3.0) que vive en `libriichi/src/algo/sp/`.
- **Red:** ResNet 1D de 40 bloques × 192 canales, con atención por canal
  (CBAM) y activación Mish. Termina en una cabeza **dueling DQN**: un valor
  más una ventaja por acción. Son ~10,8 millones de parámetros, 43,7 MB en
  float32.
- **Salida:** 46 valores Q, uno por acción, con una máscara de acciones
  legales. Del 0 al 33 es descartar ese tipo, del 34 al 36 descartar un 5
  rojo, luego 37 riichi, 38–40 chi (bajo, medio, alto), 41 pon, 42 kan,
  43 agari (ron o tsumo), 44 ryuukyoku (kyuushu) y 45 pasar. Si hay varias
  opciones de kan, se hace una segunda pasada para elegir cuál.
- **Objetivo:** maximizar los puntos de posición de la partida
  (`[90, 45, 0, -135]`, los de Tenhou), no los puntos de la mano.
- Una regla fija (*agari guard*) evita ganar en la última mano si ganar te
  deja 4º (la "agarasu").
- No busca jugadas a futuro como las IA de ajedrez: decide "por intuición"
  en una sola pasada de la red, así que es rápida.

### Fuerza

El repo publica 13.152 partidas duplicadas de 1 akochan contra 3 Mortal. Mortal
termina con **+1,9 pt de media y akochan con −5,7**, y el porcentaje de manos
en que reparte ron baja de 13,0 % a 11,3 %. Según el FAQ de mjai-reviewer,
Tenhou rechazó darle una cuenta oficial de IA, así que no tiene un rango
oficial. La comunidad lo considera de nivel humano alto.

### El problema de los pesos

**Equim no publica los pesos entrenados.** Desde agosto de 2022 su postura es
"no tengo planes de publicar el modelo", y ofrece el servicio en línea
[mjai.ekyu.moe](https://mjai.ekyu.moe). Sin pesos, el código no juega.
Entrenar desde cero exige GPU y del orden de millones de partidas de Tenhou,
cuyos términos impiden redistribuirlas.

Pesos de la comunidad en Hugging Face (revisados en octubre de 2026):

| Modelo | Licencia de los pesos | Detalle |
| --- | --- | --- |
| [**haor/Mortal-S42**](https://huggingface.co/haor/Mortal-S42) | **Apache-2.0** | Mortal v4 de 192 × 40 bloques, 10,8 M parámetros, `s42-inference.pth` de 43,7 MB (solo los tensores para inferir). Entrenado con ~1,1 M partidas de Tenhou Houou (2020–2025) más Mahjong Soul de rango alto. En 2.000 hanchan está al nivel de dos checkpoints comunitarios anteriores (diferencias sin significación). El `runtime/` que incluye sigue siendo AGPL. |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | AGPL-3.0 | Mortal v4 con 582.500 pasos, usado por Akagi. El `.pth` de ~130 MB incluye el estado de entrenamiento. Dice tener permiso de redistribución, pero no publica una evaluación de fuerza a gran escala. |
| [Twu31/TanyaoDojo](https://huggingface.co/Twu31/TanyaoDojo) | MIT | Otra pila desde cero (JAX/Flax), **más débil que Mortal** según sus propias mediciones. Los pesos son `.pkl` (pickle), que puede ejecutar código al cargarlo: no es buena opción. |

**Mortal-S42 es el candidato natural:** pesos con licencia permisiva,
arquitectura estándar y documentación honesta sobre cómo se evaluó.

### Encaje con nuestras reglas

| Regla | Mortal | Nosotros | Impacto |
| --- | --- | --- | --- |
| 4 jugadores, akadora ×3, kuitan, pao, doble ron, nagashi, kyuushu… | Tenhou ranked | Tenhou ranked | Igual |
| Duración | **Hanchan** (Este + Sur) | **Tonpuusen** + Sur a muerte súbita | **Importante**: libriichi solo marca "última mano" (`is_all_last`) en Sur 4. En nuestro Este 4 la IA no sabría que es la última mano y jugaría la posición como si quedara medio partido. Hay que forzar `is_all_last` en Este 4 (y en el Sur de muerte súbita) y probar cómo responde la red, porque es una combinación que no vio en el entrenamiento. |
| Puntos de posición | Entrenada con distintos pt, evaluada con `[90,45,0,-135]` | Uma +20/+10/−10/−20 y oka | Menor: sus preferencias de riesgo serán algo más "de Houou" que las de nuestro uma |
| Modo por equipos | No existe | 2 contra 2 con puntos individuales | Juega para sí misma; aceptable |

### Cómo integrarlo (opciones)

La red sola es fácil de llevar a cualquier sitio: Conv1d, BatchNorm, Mish y
Linear son operaciones estándar que se exportan a **ONNX** sin problema y
corren con `onnxruntime-web` (WASM, en Node o en el navegador). Lo difícil es
**el codificador**: convertir la historia de la mano en el tensor de
1012 × 34 *exactamente* como en el entrenamiento. Son ~5–6 mil líneas de Rust
entre `state/`, `obs_repr.rs`, `agent_helper.rs`, `algo/sp/`, `agari.rs` y
`shanten.rs`. Un solo canal mal codificado degrada la IA sin que se note a
simple vista.

| Opción | Cómo | A favor | En contra |
| --- | --- | --- | --- |
| **A. Servicio aparte** | `mortal.py` o libriichi + PyTorch en un servidor pequeño (Fly, Render, un VPS) que habla mjai. La función de Vercel le envía los eventos. | El codificador es el original y fiable. Lo más rápido para tenerlo jugando. | Infraestructura extra con su costo y latencia. Mortal sigue siendo AGPL, pero sin modificarlo basta con enlazar su fuente. |
| **B. libriichi → WASM** | Compilar libriichi a `wasm32` quitando PyO3 (gatear `#[pyclass]`/`#[pymethods]` con `cfg_attr`) y correr la red con onnxruntime-web, todo dentro de la función de Vercel. | Fidelidad total del codificador. Sin servidor extra. | Hay que tocar el código de Mortal (obra derivada AGPL). Bundle de ~44 MB de pesos más el WASM; con cuantización int8 son ~11 MB. Medir el arranque en frío. |
| **C. Portar el codificador a JS** | Reescribir el codificador en JS sobre nuestro motor y usar ONNX. | Una sola base de código en JS. | Lo más laborioso y frágil. También es obra derivada AGPL, porque se traduce su código. |

Con B o C, publicar el juego con ese código implica que **el repo entero pase
a AGPL-3.0**. El repo ya es público y no tiene archivo de licencia, así que
para un proyecto comunitario sin fines de lucro probablemente da igual, pero es
una decisión tuya.

---

## 2. akochan (critter-mj/akochan)

### Qué es

Una IA "clásica" (C++, ~19k líneas, 2019–2022) que **calcula el valor
esperado** de cada jugada con decenas de estimadores estadísticos.
Esos estimadores son modelos lineales o logísticos cuyos parámetros vienen en
`params/` (709 archivos, 3 MB): probabilidad de que un rival esté en tenpai,
de repartirle ron con cada ficha (`houjuu_prob`), de ganar, de llegar a
ryuukyoku, puntos esperados por mano, etcétera. Combina todo eso con la
probabilidad de cada posición final para maximizar los puntos de posición
(`jun_pt`).

- Se configura con `tactics.json` (pt de posición, si hace kan, etcétera).
- Habla mjai en modo `pipe` (stdin/stdout) o como cliente TCP.
- **Su gran ventaja frente a Mortal es que es explicable**: puede mostrar la
  probabilidad de repartir ron con cada ficha y el valor esperado de cada
  descarte.

### Medido aquí

Se compiló en este contenedor (g++ 13, Boost 1.83, OpenMP) y se jugó una
partida de 4 akochan: **342 s para 5 manos y unas 230 decisiones, ~1,5 s por
decisión** con 4 núcleos. Además pesa: `libai.so` ocupa 17 MB y `system.exe`
11 MB, ambos nativos. **No sirve para una función serverless** con 10 s
de límite por invocación, y menos si piensan varios bots seguidos. El FAQ de
mjai-reviewer reconoce que "no es bueno con los kan" y que tiene problemas
numéricos en situaciones extremas.

### Licencia

Tiene términos propios en japonés (`LICENSE`, Shift-JIS). En resumen:

- Libre para investigación privada. Sus salidas (registros, evaluaciones) se
  pueden publicar sin fines de lucro, citando que se usó akochan.
- **Redistribuir con modificaciones de la parte de IA (`ai_src`) está
  prohibido** salvo permiso del autor. Sin modificar, se puede redistribuir sin
  fines de lucro, con crédito y conservando los términos.
- El uso comercial requiere permiso.

No se puede portar ni adaptar. Sí se puede **usar tal cual, fuera de
línea**, como rival de referencia para medir nuestros bots (el arena de
Mortal ya lo envuelve en `agent/akochan.rs`). También sirve como fuente de
*ideas*: qué estimar y cómo combinarlo, sin copiar código.

---

## 3. mjai-reviewer (Equim-chan/mjai-reviewer)

### Qué es

Una herramienta en Rust (Apache-2.0) que **revisa una partida** jugada por
humanos. Reproduce la partida, le pregunta al motor (Mortal o akochan) qué
habría hecho en cada decisión y genera un informe HTML que marca dónde
coincidiste y dónde no, con la probabilidad de cada opción. Es la base de
[mjai.ekyu.moe](https://mjai.ekyu.moe). No trae IA propia.

### Qué nos sirve

- **`convlog/`** (Apache-2.0): un conversor de registros de Tenhou
  (`tenhou.net/6`) a **mjai**. Es una buena referencia del formato mjai
  "real" (nombres de fichas `1m…9m`, `5mr`, `E S W N P F C`, los campos de
  cada evento) para escribir nuestro exportador.
- **La idea de "revisar mi partida"**: al terminar, mostrar al jugador en
  qué jugadas la IA habría hecho otra cosa. Necesita un motor (el bot
  difícil) y el registro mjai. El informe usa una "nota" sencilla:
  `100 × (media de (Q_jugada − Q_min)/(Q_max − Q_min))²`.
- Su FAQ advierte que los valores Q de Mortal **no** son probabilidades de
  ganar ni puntos esperados. Para mostrarlos hay que pasarlos por una
  softmax con temperatura.

---

## 4. La pieza común: el protocolo mjai

Los tres hablan **mjai**, un flujo de eventos JSON, uno por línea:

```
{"type":"start_kyoku","bakaze":"E","dora_marker":"3p","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],"tehais":[[...13 fichas...],...]}
{"type":"tsumo","actor":0,"pai":"5mr"}
{"type":"dahai","actor":0,"pai":"N","tsumogiri":false}
{"type":"pon","actor":2,"target":0,"pai":"N","consumed":["N","N"]}
{"type":"reach","actor":1}  {"type":"reach_accepted","actor":1}
{"type":"hora","actor":1,"target":0,"deltas":[...]}  {"type":"end_kyoku"}
```

Las fichas que el jugador no ve se envían como `"?"`. El bot responde con la
misma forma (`dahai`, `pon`, `reach`, `hora`, `none`…).

**Exportar mjai desde nuestro motor nos sirve para todo:**

1. Alimentar a Mortal (cualquier opción) o a akochan.
2. Hacer pruebas fuera de línea: reproducir partidas y comparar decisiones.
3. Más adelante, la revisión de partidas.

Supone guardar en `s.k` la lista completa de eventos de la mano actual, sin
el tope de 12 de `s.events`. Son unos 100–150 eventos de unos 60 bytes, menos
de 10 KB más en Redis.

---

## 5. Hoja de ruta propuesta

1. **Registro mjai por mano** (pequeño, sin riesgos). El motor emite eventos
   mjai además de los suyos y los guarda por mano. Una prueba compara el
   registro con una partida simulada.
2. **Bot "normal" con majiang-ai** (MIT, JS, corre en Vercel en decenas de
   ms; ver [§6.1](#61-majiang-ai-kobalab-la-mejor-opción-para-el-nivel-normal)):
   - un adaptador que traduce nuestros eventos al protocolo de
     `Majiang.Player` (`qipai`, `zimo`, `dapai`, `fulou`, `gang`…) y sus
     respuestas a nuestras acciones. Notación: `m1…m9`, `m0` = 5 rojo,
     `z1…z7`;
   - reglas de majiang-core ajustadas a las nuestras: `場数: 1` (tonpuusen),
     sin doble yakuman, `ノーテン宣言あり`… El uma por defecto ya coincide
     (+20/+10/−10/−20);
   - una capa propia encima para lo que majiang-ai no mira: los puntos y la
     posición (regla anti-agarasu en la última mano, no arriesgar yendo 1º en
     Este 4).

   Si el adaptador resulta incómodo, el plan B es escribir las heurísticas
   desde cero (ukeire, riichi, betaori con genbutsu, suji y kabe) usando
   majiang-ai solo como referencia.
3. **Bot "difícil" con Mortal:**
   1. Elegir los pesos (ver [§6.2](#62-más-pesos-de-mortal-en-hugging-face)):
      S42 (v4, Apache) o mortal3 (v3, AGPL, ya en ONNX; su codificador no
      necesita el calculador de valor esperado de la v4).
   2. Prototipo fuera de línea: libriichi y los pesos en Python, jugando
      contra el bot normal mediante nuestro registro mjai, para validar
      eventos y acciones.
   3. Elegir el despliegue (A, B o C). Mi recomendación es **B**
      (libriichi → WASM, ONNX y todo en Vercel). Si se prefiere no tocar
      código AGPL, **A**. senegrom/mahjong demuestra que el patrón
      "heurístico + red ONNX en el navegador con respaldo" funciona
      ([§6.3](#63-otros-proyectos-relevantes)).
   4. Arreglo de tonpuusen (`is_all_last` en Este 4) y medir la fuerza
      contra el bot normal. Si hace falta, ajustar la red con partidas de
      tonpuusen de los datasets públicos ([§6.4](#64-datasets-de-partidas)).
4. **Revisión de partida** al estilo mjai-reviewer, con el bot difícil como
   juez. Opcional, para después.
5. **Extras opcionales:** "personalidades" para los bots con los pesos de
   estilo (más o menos llamadas o riichi) de `jjeyxb/mia-mortal-style`.

## 6. Búsqueda ampliada: más opciones

Se buscó en Hugging Face (modelos y datasets con `mahjong`, `riichi`,
`mortal`, `mjai`, `tenhou`) y en GitHub. Lo más útil está abajo; lo descartado,
en [§6.5](#65-descartados).

### 6.1 majiang-ai (kobalab): la mejor opción para el nivel "normal"

- [kobalab/majiang-ai](https://github.com/kobalab/majiang-ai) y su motor
  [kobalab/majiang-core](https://github.com/kobalab/majiang-core): son la IA y
  el motor del juego web japonés **電脳麻将** (Denno Majan). Licencia **MIT**,
  **JavaScript puro**, publicados en npm (`@kobalab/majiang-ai` 1.3.0,
  septiembre de 2026) y mantenidos activamente.
- Es una IA sin red neuronal y pequeña: 1.089 líneas más ~3.000 del motor.
  Para cada descarte calcula un "valor" de la mano (fichas útiles, puntos
  probables, mejoras posibles) y lo pondera con el **peligro de cada ficha**
  según lo visto en la mesa (`suanpai.js`: genbutsu, suji, fichas
  agotadas). Ese mismo cálculo decide llamadas, riichi y kan. Trae 26
  versiones anteriores de la IA (`legacy/`) y herramientas de partidas
  duplicadas para comparar versiones.
- **Medido aquí:** 20 hanchan entre 4 majiang-ai tardaron 400 s, **~40 ms por
  decisión** en un hilo de Node. En autojuego: 20,6 % de manos ganadas, 12,3 %
  de ron repartido, 22,5 % de riichi, 32,4 % de llamadas y 19,6 % de
  ryuukyoku. Son perfiles parecidos a los de akochan en las tablas de Mortal
  (19,5 % / 13,0 % / 21,5 % / 33,0 %). El autojuego no mide fuerza, pero
  descarta comportamientos absurdos.
- **Reglas configurables** y muy cercanas a las nuestras: akadora 1 por palo,
  kuitan, tonpuusen con `場数: 1`, extensión a muerte súbita, nagashi mangan,
  pao, uma +20/+10/−10/−20 por defecto.
- **Lo que le falta:** no mira los puntos ni la posición (no tiene tácticas de
  última mano) y su motor es otro, así que hace falta un adaptador. Ninguna de
  las dos cosas es grave.

### 6.2 Más pesos de Mortal en Hugging Face

| Modelo | Versión y licencia | Lo interesante |
| --- | --- | --- |
| [hhim8826/mortal3-b40c192](https://huggingface.co/hhim8826/mortal3-b40c192) | v3, AGPL-3.0 | **Ya exportado a ONNX** (`mortal.onnx`, 45 MB, verificado contra PyTorch sin una sola acción distinta). Entrenado con 191 mil partidas de Houou; es el mejor de 6 checkpoints de su línea, sin comparación contra modelos externos. Su observación v3 (934 × 34) **no usa** las tablas de valor esperado de la v4 (`algo/sp/`, ~1.400 líneas), así que hay menos que portar. Trae **`tenpai.onnx`** (4 MB): estima si cada rival está en tenpai y sus esperas. Contra un riichi, entre fichas no suji, separa un 0,13 % de riesgo frente a un 17,2 %; las reglas clásicas solo llegan a 6,2 % frente a 9,0 %. Es un "detector de peligro" excelente, pero también requiere el codificador v3. |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | v4, AGPL-3.0 | Entrenado con Houou hanchan 2025–2026. Su dataset incluye partidas de tonpuusen (no usadas para entrenar). 125 MB con el estado de entrenamiento. |
| [jjeyxb/mia-mortal-style](https://huggingface.co/jjeyxb/mia-mortal-style) | v4, AGPL-3.0 | Cuatro **estilos** ajustados desde 298k: llama mucho o poco, hace mucho o poco riichi. Las diferencias de estilo son claras (16–20 σ) y **la fuerza no cambia**. Servirían para dar "personalidades" a los bots. |
| [haor/Mortal-S42](https://huggingface.co/haor/Mortal-S42) (y su copia banxiaweiliang/Mortal-S42) | v4, **pesos Apache-2.0** | Ya descrito arriba. La única con pesos de licencia permisiva. |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | v4, AGPL-3.0 | Ya descrito arriba. |
| [zangjiucheng/riichippo](https://huggingface.co/zangjiucheng/riichippo) | Apache-2.0 | Otra pila (RiichiEnv, CQL + PPO), de 28 MB. No publica una comparación de fuerza contra referencias conocidas. |

**Licencia de los pesos:** todos menos S42 y riichippo son AGPL. Con S42, solo
el codificador es AGPL. En cualquier opción que meta el codificador en nuestro
repo, el repo pasa a AGPL igualmente.

### 6.3 Otros proyectos relevantes

- [senegrom/mahjong](https://github.com/senegrom/mahjong) (AGPL-3.0,
  actualizado en octubre de 2026): **un juego de riichi en el navegador
  parecido al nuestro**. Su motor en Rust se compila a WASM y tiene rivales
  "Beginner" y "Club" (heurísticos) y "Trained" (una red ONNX de 117 MB que
  corre en el navegador con onnxruntime-web, cacheada para jugar sin
  conexión). Si la red falla, cae a "Club". Usa reglas **EMA** (no Tenhou),
  así que su red no nos sirve, pero confirma el patrón de arquitectura. Tiene
  documentación detallada sobre memoria y descarga
  (`docs/ONNX_RUNTIME.md`).
- [Jimboom7/AlphaJong](https://github.com/Jimboom7/AlphaJong) (GPL-3.0, JS,
  2024): una IA heurística en JS que simula turnos, pensada como script para
  jugar solo en Mahjong Soul (dice llegar a rango Master). Su licencia y su
  propósito son peores que los de majiang-ai, pero sirve como referencia de
  constantes de defensa y llamadas.
- [gimite/mjai-manue](https://github.com/gimite/mjai-manue) (BSD, 2015): la
  IA de referencia del creador de mjai. Su fórmula es sencilla y explicable:
  `expPt = (1 − P_ron_repartido) × P_ganar × puntos_medios − P_ron_repartido ×
  6265`. La probabilidad de ganar sale de Monte Carlo y la de repartir ron de
  un árbol de decisión entrenado con Tenhou.
- [EndlessCheng/mahjong-helper](https://github.com/EndlessCheng/mahjong-helper)
  (MIT, Go) y
  [MahjongRepository/tenhou-python-bot](https://github.com/MahjongRepository/tenhou-python-bot)
  (MIT, Python): análisis de eficiencia y defensa, y un bot heurístico
  completo. Son referencias por si se escriben heurísticas propias.
- [smly/RiichiEnv](https://github.com/smly/RiichiEnv) (Apache-2.0): un
  entorno de entrenamiento en Rust y Python, compatible con mjai y Mortal.
  Útil si algún día entrenamos.
- [NikkeTryHard/tenhou-to-mjai](https://github.com/NikkeTryHard/tenhou-to-mjai)
  (Apache-2.0): un conversor de registros de Tenhou y Mahjong Soul a mjai.
- [twu3202/TanyaoDojo](https://github.com/twu3202/TanyaoDojo) (MIT): una pila
  de entrenamiento completa. Su ficha documenta con mucho rigor cómo medir la
  fuerza (partidas duplicadas, 100 mil partidas para diferencias de 1 pt).

### 6.4 Datasets de partidas

Sirven solo si entrenamos o ajustamos una red, por ejemplo para tonpuusen.

- [hhim8826/tenhou-houou-mjai](https://huggingface.co/datasets/hhim8826/tenhou-houou-mjai):
  **2,12 millones de partidas Houou ya en mjai** (parquet, 6,3 GB), listas
  para el `GameplayLoader` de libriichi. 29.875 son tonpuusen.
- [nikketryhard/tenhou-houou-mjai](https://huggingface.co/datasets/nikketryhard/tenhou-houou-mjai):
  Tenhou Houou 2009–2026 más Mahjong Soul (salas Jade y Throne) 2019–2026 en
  mjai, ~64 GB. Mahjong Soul tiene muchas partidas de tonpuusen.
- [1nfrared218/tenhou-mjai-riichi-training](https://huggingface.co/datasets/1nfrared218/tenhou-mjai-riichi-training):
  partidas ya procesadas, CC BY 4.0.
- **Ojo:** Tenhou tiene sus propios términos sobre el uso de sus registros y
  varios de estos datasets los redistribuyen igualmente (`license: other`).
  Para entrenar en privado el riesgo es bajo; para redistribuir datos,
  revisarlo antes.

### 6.5 Descartados

- **TanyaoDojo** (pesos MIT): más débil que Mortal según sus propias
  mediciones, y en `.pkl` (pickle, inseguro de cargar).
- **MahjongLM** (mitsutani) y **Qwen3-4B-mahjong**: modelos de lenguaje.
  El primero genera registros, no está hecho para jugar y tiene licencia
  "other". El segundo pesa 8 GB y no contempla akadora.
- **IJCAI-2026 (Dannibal)**: para mahjong chino de competición (MCR), otras
  reglas.
- **kanachan**: solo código para entrenar con reglas de Mahjong Soul, sin
  pesos ni archivo de licencia.
- **pjura/mahjong_ai**: un clasificador de descartes con 66 % de acierto;
  no es una IA de juego completa.
- **NAGA, Suphx, LuckyJ**: cerrados.

## Decisiones pendientes

- **Licencia del repo.** Para el bot difícil dentro de nuestro código
  (opciones B o C), el repo tendría que publicarse como AGPL-3.0. La
  alternativa es un servicio aparte (A).
- **Dónde corre el bot difícil:** en la función de Vercel (con más memoria y
  un arranque en frío más lento), en un servicio aparte o en el navegador del
  anfitrión.
- **Niveles de dificultad:** ¿se elige por sala (normal o difícil) o se
  mezclan bots de distinto nivel?

## Fuentes

- Mortal: <https://github.com/Equim-chan/Mortal>, documentación en
  <https://mortal.ekyu.moe>, postura sobre los pesos en
  <https://gist.github.com/Equim-chan/cf3f01735d5d98f1e7be02e94b288c56>
- akochan: <https://github.com/critter-mj/akochan>
- mjai-reviewer: <https://github.com/Equim-chan/mjai-reviewer> (FAQ en
  `faq.md`)
- Pesos comunitarios: <https://huggingface.co/haor/Mortal-S42>,
  <https://huggingface.co/Yuchen1457/mortal-582500>,
  <https://huggingface.co/Twu31/TanyaoDojo>
- Calculador de valor esperado original: <https://github.com/nekobean/mahjong-cpp>
- Búsqueda ampliada: los enlaces de la [§6](#6-búsqueda-ampliada-más-opciones).
  Las licencias y fechas salen de clonar cada repositorio (octubre de 2026) y
  de la API de Hugging Face. Las cifras de majiang-ai y akochan se midieron en
  este entorno; las de los modelos de Hugging Face son las que publican sus
  autores.
