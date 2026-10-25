# Un cerebro para los bots: investigación de materiales

Investigación de octubre de 2026 sobre tres proyectos que podrían darles
inteligencia a los bots: **Mortal**, **akochan** y **mjai-reviewer**. Se
clonaron y leyeron los tres repositorios. akochan se compiló y se midió aquí.
También se revisaron los pesos de Mortal publicados por la comunidad en
Hugging Face.

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

**Recomendación:** (1) guardar el registro de cada mano en formato **mjai**,
la base de todo lo demás; (2) escribir un **bot heurístico propio** en JS para
el nivel "normal", sin dependencias ni problemas de licencia; (3) usar los
pesos comunitarios **Mortal-S42** (Apache-2.0) para el nivel "difícil". El paso
3 exige una decisión de licencia: el codificador de Mortal es AGPL. Ver
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
2. **Bot "normal" heurístico, propio, en JS** (sin licencias ni
   dependencias, corre en Vercel en milisegundos):
   - descartar maximizando ukeire (fichas útiles) tras minimizar el shanten;
     `hand.js` ya tiene la descomposición;
   - ganar siempre que pueda (ron o tsumo), con la regla anti-agarasu en la
     última mano;
   - riichi cuando está en tenpai cerrado con espera razonable; kan solo si no
     estropea la mano;
   - llamar solo si da yaku (yakuhai, tanyao, honitsu…) y no empeora el
     shanten;
   - **defensa (betaori)** ante un riichi rival: genbutsu, suji, kabe y
     fichas de honor ya vistas.

   Quedaría muy por encima del bot actual, y sirve también de respaldo si el
   bot difícil falla o se demora.
3. **Bot "difícil" con Mortal-S42:**
   1. Prototipo fuera de línea: libriichi y los pesos en Python, jugando
      contra nuestro bot heurístico mediante nuestro registro mjai, para
      validar eventos y acciones.
   2. Elegir el despliegue (A, B o C). Mi recomendación es **B**
      (libriichi → WASM, ONNX y todo en Vercel). Si se prefiere no tocar
      código AGPL, **A**.
   3. Arreglo de tonpuusen (`is_all_last` en Este 4) y medir la fuerza
      contra el bot normal.
4. **Revisión de partida** al estilo mjai-reviewer, con el bot difícil como
   juez. Opcional, para después.

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
