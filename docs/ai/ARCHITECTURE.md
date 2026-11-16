# IA propia de riichi: arquitectura propuesta

Diseño de una IA de riichi de 4 jugadores con reglas tipo Tenhou, hecha desde
cero. Toma ideas de Mortal (resumidas en [MORTAL_NOTES.md](MORTAL_NOTES.md)),
pero no su código ni su formato de datos. Este documento es la especificación
desde la que se implementa.

- **Estado:** propuesta para revisar. Todavía no hay código de la IA.
- **Los números de cómputo, tamaño y latencia son estimaciones**, salvo los que
  dicen "medido". Cada estimación dice de dónde sale.
- **Nombre provisional del repo nuevo:** `riichi-aero-ai`.

## Resumen de decisiones

| Tema | Decisión | Mortal |
| --- | --- | --- |
| Motor y codificador | Rust propio, un solo núcleo con salidas a Python, WASM y línea de comandos | Rust (libriichi) |
| Motor de este proyecto (JS) | Se reutiliza como **oráculo de pruebas** y como anfitrión, no como simulador de entrenamiento | — |
| Entrada | ~100 planos por ficha **más** un vector de ~70 datos globales | 1.012 planos; los globales son filas llenas |
| Tronco | Red residual **con pesos compartidos entre palos** | Convolución 1D sobre las 34 fichas |
| Salida | **Política** más cabezas de valor | Solo valores Q |
| Valor | Distribución de puesto final y puntos, **condicionada al uma** | Un escalar con el uma fijo dentro |
| Acciones | 120, **una sola consulta por decisión** | 46, con segunda consulta en riichi y kan |
| Recompensa por mano | Modelo de posición sobre el **estado actual** | GRU sobre la historia de puntajes |
| Formato de partida | Tonpuusen y hanchan, como dato de entrada | Solo hanchan |
| Información oculta | Como **etiquetas auxiliares** (tenpai rival, peligro por ficha) | Entrada "oráculo" opcional |
| Entrenamiento | Imitación → mejora fuera de línea → autojuego | Fuera de línea con CQL → en línea |
| Tamaños | Cuatro, de 0,2 a ~10 millones de parámetros | Uno configurable |
| Repositorio | **Privado y separado** de este | — |

## 1. Objetivos y restricciones

1. **Jugar bien con las reglas de esta plataforma:** tonpuusen con muerte
   súbita en Sur, uma +20/+10/−10/−20 con oka. Mortal juega el Este como si
   fuera el Este de un hanchan, y los dos ajustes que se probaron no lo
   mejoraron ([mortal/README.md](../../mortal/README.md)).
2. **Inferencia barata.** El bot corre dentro de una función de Vercel con
   10 s de límite. Hoy Mortal tarda ~70 ms por decisión y ocupa ~480 MB
   (medido).
3. **Entrenable con una sola GPU** de consumo en días o semanas.
4. **Implementación independiente.** Nada de código de Mortal, ni traducido.
5. **Comparable con otros bots** por un protocolo estándar.

## 2. Qué hay en este proyecto y qué se reutiliza

### Stack actual

- **Cliente:** JavaScript sin paso de compilación, Three.js para la mesa 3D.
- **Servidor:** una función de Vercel (`api/game.js`) que llama a
  `server/handler.js`. Sin estado propio: cada petición carga la sala desde
  Redis (Upstash) o desde memoria en local (`server/store.js`).
- **Comunicación:** HTTP con *polling*. El cliente envía operaciones y recibe
  la vista de su asiento (`Game.view(seat)`), que oculta las manos ajenas.
- **Bots:** corren dentro de la misma función. `server/engine/bot.js` elige el
  cerebro por nivel y cae al anterior si falla.

### Piezas y su uso para la IA

| Pieza | Qué es | Uso para la IA |
| --- | --- | --- |
| `public/js/shared/tiles.js` | Ficha = id 0–135; tipo = id ÷ 4 (0–33, orden m, p, s, vientos, dragones); cincos rojos = ids 16, 52, 88 | **Se adopta la misma convención** en el motor nuevo |
| `server/engine/game.js` | Máquina de estados completa y autoritativa. Estado en JSON, generador aleatorio inyectable | **Oráculo de pruebas diferenciales** del motor Rust. Anfitrión de la integración. Evaluación a pequeña escala |
| `server/engine/hand.js` | Shanten exacto por búsqueda, esperas, descomposición de manos | Oráculo para el shanten por tablas del motor nuevo. Demasiado lento para entrenar |
| `server/engine/score.js` | Yaku, han, fu, yakuman y pagos | Oráculo para el cálculo de puntos |
| `server/engine/mjai.js` | Registro mjai por mano y vista por asiento | **Ya es la interfaz del bot.** Se amplía (ver [§8](#8-interfaz-entre-el-bot-y-el-juego)) |
| `server/engine/bot.js` | Niveles con respaldo | Lugar donde entra el cerebro nuevo |
| `server/engine/majiang-bot.js` | Adaptador de majiang-ai y la regla anti-agarasu | Rival de referencia con licencia MIT |
| `server/engine/mortal/` | Patrón "codificador WASM + red ONNX con onnxruntime-web" | **Se reutiliza el patrón de despliegue**, no el contenido |
| `test/*.test.js` | Partidas aleatorias con semilla, volcado de registros con `MJAI_DUMP` | Generador de casos para el motor nuevo |

**Velocidad del motor JS (medida aquí):** 8,2 hanchan por segundo en un hilo
con bots triviales (tsumogiri, ganar cuando se puede), unas 8.500 decisiones
por segundo contando la construcción de la vista.

### Qué falta

| Falta | Por qué hace falta |
| --- | --- |
| Motor rápido embebible en Python | Codificar cientos de millones de posiciones y simular millones de partidas |
| Codificador de observaciones | No existe uno propio |
| Shanten y aceptación de fichas por tablas | El actual es por búsqueda |
| Registro de la partida completa | Hoy `k.mjai` guarda solo la mano en curso y no se persiste. Faltan `start_game` y `end_game`. Relacionado con el issue de registros guardados |
| Conversor de registros de Tenhou a mjai | Para los datos |
| Arena con muros duplicados y rotación de asientos | Para evaluar. Las pruebas de `mortal/README.md` lo hicieron, pero la herramienta no está en el repo |
| Estadísticas de juego desde registros | Tasas de victoria, ron repartido, riichi, llamadas |
| Reglas configurables | Diferencias con Tenhou: en doble ron aquí cada ganador cobra honba; el pao cubre todo el valor de la mano. Para reproducir registros de Tenhou el motor nuevo debe poder seguir sus reglas exactas |

## 3. Lenguajes y componentes

**Recomendación: un núcleo en Rust, entrenamiento en Python, integración en
JavaScript.**

| Opción | Veredicto | Motivo |
| --- | --- | --- |
| Reutilizar el motor JS para entrenar | No | No se puede llamar desde el cargador de datos de PyTorch. Habría que precodificar todos los datos a disco desde Node y repetirlo con cada cambio del codificador. El estado en JSON no está pensado para velocidad |
| Motor en Python | No | Uno o dos órdenes de magnitud más lento. La codificación sería el cuello de botella |
| **Motor en Rust** | **Sí** | Un solo codificador para entrenar (módulo de Python), para el autojuego (binario) y para producción (WASM). Este repo ya demostró que el patrón WASM funciona en Vercel |

El argumento decisivo no es la velocidad del simulador. En autojuego el cuello
de botella es la red. Lo decisivo es tener **un único codificador** que corra
igual en los tres sitios, y poder codificar los datos al vuelo al entrenar.

**El motor Rust se escribe a partir de las reglas y del comportamiento del
motor JS de este proyecto, no de libriichi.** El motor JS es el oráculo: se
generan partidas con semilla, se reproducen en Rust y se compara evento por
evento (acciones legales, puntos, fin de mano y de partida).

| Componente | Lenguaje | Contenido |
| --- | --- | --- |
| `core` | Rust | Fichas, manos, shanten y aceptación por tablas generadas por el propio proyecto, yaku y puntos, reglas configurables, máquina de estados |
| `obs` | Rust | Estado visible por asiento, codificador, máscara y tabla de acciones |
| `mjai` | Rust | Eventos, lectura y escritura, conversor desde Tenhou, validador |
| `arena` | Rust | Autojuego por lotes, muros reproducibles, partidas duplicadas, estadísticas |
| `py` | Rust (PyO3) | Módulo de Python: cargador de datos y arena con inferencia por lotes |
| `wasm` | Rust | El codificador para la función de Vercel o el navegador |
| `train` | Python + PyTorch | Modelos, pérdidas, etapas, exportación a ONNX |
| `eval` | Python | Torneos, intervalos de confianza, informes |
| Adaptador | JavaScript, en este repo | Carga el WASM y el ONNX y traduce acciones |

## 4. Codificación del estado

La observación son tres tensores:

| Tensor | Forma | Contenido |
| --- | --- | --- |
| Planos por ficha | ~100 × 34 | Todo lo que es "por tipo de ficha" |
| Vector global | ~70 | Todo lo que es un número de la mesa |
| Máscara | 120 | Acciones legales |

**Desviación 1: separar los datos globales de los planos.** Mortal repite cada
dato global en una fila de 34 valores iguales. Eso lleva la entrada a 1.012
canales, y solo la primera convolución cuesta unos 20 millones de
multiplicaciones (1.012 × 192 × 3 × 34), casi lo mismo que **toda** la red
liviana de este diseño. Aquí los globales entran por una MLP pequeña que
modula los canales del tronco.

### Planos por ficha

| Grupo | Planos | Detalle |
| --- | --- | --- |
| Mano propia | 6 | Copias en termómetro (4), cinco rojo en mano (1, marcado en la posición del 5), ficha recién robada (1) |
| Por jugador (×4, en orden relativo a mi asiento) | ~16 | Ver abajo |
| Mesa | 8 | Indicadores de dora, fichas que son dora, copias visibles en termómetro (4), viento de ronda, viento de asiento |
| Cálculos baratos sobre mi mano | 5 | Por cada descarte: si mantiene el shanten y cuántas fichas acepta después; fichas que acepto ahora; mis esperas; fichas con las que estoy en furiten |
| Contexto | 1 | La ficha que se me ofrece |

Por cada jugador:

| Planos | Contenido |
| --- | --- |
| 6 | Descartes por tramo de la mano (turnos 1–6, 7–12, 13 en adelante) × (de la mano, recién robada) |
| 2 | Orden: turno normalizado del último descarte de cada ficha, y el mismo dato solo para descartes de la mano |
| 1 | Ficha del descarte de riichi |
| 1 | **Fichas seguras contra ese jugador**: sus propios descartes y todo lo que se tiró después de su riichi |
| 1 | Fichas que pasaron desde su último descarte (seguras solo en este turno) |
| 1 | Descartes suyos que otro llamó |
| 4 | Llamadas: chi (marcado en su ficha más baja), pon, kan abierto, kan cerrado |

**Desviación 2: historia de descartes por tramos y con orden explícito, en vez
de un grupo de planos por descarte.** Mortal dedica planos a cada uno de los
primeros 6 y últimos 18 descartes de cada jugador. Aquí se resume en 8 planos
por jugador. Se pierde el orden exacto dentro de un tramo y se gana una
entrada diez veces menor. *Riesgo:* puede perder lectura fina de manos. Por
eso el experimento E3 ([§10](#experimentos-de-diseño-baratos)) prueba una rama
que lee los descartes como secuencia.

**Desviación 3: dar hechas las fichas seguras.** Son un cálculo exacto y
barato que Mortal deja que la red deduzca. Dárselo a una red pequeña le ahorra
capacidad justo donde más le cuesta, que es la defensa.

**Desviación 4: sin tablas de valor en solitario.** La v4 de Mortal las
incluye y son lo más caro de su codificador (hasta 160 ms, medido). No hay una
ablación pública de cuánto aportan. Aquí entran solo shanten y aceptación de
fichas, que son consultas a tablas. Además, reimplementarlas obligaría a
estudiar de cerca un código AGPL que viene de otro GPL.

### Vector global

| Grupo | Datos |
| --- | --- |
| Puntos | Los 4 puntajes, mis diferencias con cada rival, mi puesto, puntos que faltan para subir y bajar un puesto |
| Progreso | Ronda, número de mano, honba, depósitos, fichas que quedan en el muro, turno |
| Asientos | Quién es el oya, mi viento |
| Estado de cada jugador | Riichi, ippatsu vivo, número de llamadas, mano cerrada |
| Estado propio | Shanten, furiten |
| **Formato de la partida** | Tonpuusen o hanchan, si es la última mano regular, si es prórroga, puntaje de retorno |
| **Vector de puntos por puesto** | Los 4 valores del uma efectivo, y el peso de los puntos brutos |

**Desviación 5: el formato de la partida es un dato de entrada.** Así el mismo
modelo aprende tonpuusen y hanchan, y sabe cuándo es la última mano. Los datos
públicos incluyen partidas de tonpuusen.

**Desviación 6: el uma es un dato de entrada.** En los datos humanos varía de
forma natural entre plataformas y salas. En las etapas de refuerzo se sortea
dentro de una familia. El objetivo es cambiar el uma al jugar sin reentrenar.
*Riesgo:* si no hay variación suficiente en los datos, el modelo ignora el
dato. Se mide en el experimento E2.

### Información oculta

Las manos rivales y el muro no entran a la red. Se usan como **etiquetas** de
cabezas auxiliares durante el entrenamiento ([§5](#cabezas)).

**Desviación 7: etiquetas en vez de oráculo.** El *oracle guiding* entrena
primero una red que ve todo y luego le retira la información. Es delicado de
ajustar. Las etiquetas auxiliares dan parte del beneficio con un entrenamiento
normal, y sus salidas sirven además para explicar jugadas en la plataforma.

## 5. Red

### Tronco

1. **Entrada.** Una convolución 1×1 lleva los planos al ancho de trabajo *C*.
   El vector global pasa por una MLP y se suma como sesgo por canal.
2. **Bloques residuales con pesos compartidos entre palos.** Las 34 posiciones
   se tratan como tres palos de 9 más 7 honores:
   - Dentro de cada palo, convolución de núcleo 3 sobre los números, **con los
     mismos pesos en los tres palos** y sin cruzar el borde del palo.
   - Los honores usan una transformación 1×1 propia: no tienen vecinos.
   - Mezcla entre palos: en cada número se resume lo que hay en los tres palos
     (media y máximo) y se reinyecta.
   - Compuerta global: un resumen de todas las posiciones, junto con el vector
     global, escala los canales.
3. **Salida.** Las cabezas leen las activaciones por ficha y un resumen global.

**Desviación 8: pesos compartidos entre palos.** Las reglas son simétricas
entre palos, con la única excepción del ryuuiisou. Mortal trata las 34 fichas
como una línea, donde 9m y 1p quedan como vecinos, y aprende la simetría con
aumento de datos. Aquí la simetría está en la arquitectura: cada partida vale
como sus 6 permutaciones de palos sin repetirla, y la mezcla entre palos hace
que patrones como el sanshoku sean locales. Con menos datos y menos cómputo
que Mortal, la eficiencia de datos importa. *Esto es una hipótesis.* El
experimento E1 la compara con una red residual 1D corriente a igual costo. Si
no gana, se usa la 1D con aumento de datos.

**Sin capa densa grande al final.** Mortal aplana 32 × 34 y pasa a un vector
de 1.024, que son 1,1 millones de parámetros. Aquí las cabezas por ficha leen
directamente las posiciones.

### Cabezas

| Cabeza | Salida | Se usa al jugar |
| --- | --- | --- |
| Política por ficha | 3 valores por posición: descartar, riichi con ese descarte, kan de ese tipo. Más las variantes de cinco rojo | Sí |
| Política global | Chi (6), pon (2), kan abierto, ganar, kyuushu, pasar | Sí |
| Puesto final | Distribución sobre mis 4 puestos | Sí: valor, y explicación |
| Puntos | Puntos esperados de esta mano y puntaje final esperado | Sí |
| Valor por acción | Un valor por cada una de las 120 acciones | Desde la etapa 2 |
| Tenpai rival | 3 probabilidades | Opcional: explicación |
| Peligro | 3 × 34: probabilidad de que cada ficha le dé ron a cada rival | Opcional: explicación |
| Resultado de la mano | Gano, reparto ron, otro gana, empate | Solo al entrenar |

**Desviación 9: política explícita además de valores.** Mortal solo aprende
valores Q y juega con el máximo. Aquí la primera etapa es imitación, que
entrena una política de forma directa y da una métrica clara (acierto contra
humanos). El valor por acción se añade en la etapa 2.

### Tamaños

| Modelo | Ancho × bloques | Parámetros | Multiplicaciones por pasada | Latencia estimada en WASM, 1 hilo |
| --- | --- | --- | --- | --- |
| XS | 64 × 8 | ~0,2 M | ~7 M | ~2 ms |
| **S (liviano)** | 96 × 12 | ~0,8 M | ~23 M | ~5 ms |
| M | 128 × 20 | ~2,2 M | ~67 M | ~16 ms |
| L | 192 × 40 | ~9–10 M | ~300 M | ~70 ms |

*De dónde salen:* parámetros y multiplicaciones del tronco como 6·C² por
bloque y 6·C²·34 por pasada, más un margen para la mezcla entre palos y las
cabezas. La latencia extrapola en línea recta la de Mortal medida en este
repo (70 ms para ~300 M). Son estimaciones y hay que medirlas.

## 6. Espacio de acciones

120 acciones con máscara. **Cada decisión es una sola consulta a la red.**

| Acciones | Cantidad |
| --- | --- |
| Descartar un tipo de ficha, o un cinco rojo | 34 + 3 |
| Riichi descartando ese tipo, o ese cinco rojo | 34 + 3 |
| Kan cerrado o añadido de ese tipo | 34 |
| Chi: tres formas × (gastando el rojo o no) | 6 |
| Pon: gastando el rojo o no | 2 |
| Kan abierto | 1 |
| Ganar (ron o tsumo) | 1 |
| Kyuushu kyuuhai | 1 |
| Pasar | 1 |

**Desviación 10: riichi y kan en una consulta.** Mortal elige "riichi" o "kan"
y vuelve a consultar la red para la ficha. Aquí la ficha va en la acción. Se
paga con una salida más ancha y con acciones raras con pocos ejemplos (los
kan). Se gana una pasada por decisión, que importa con poco CPU, y una
traducción uno a uno con mjai.

**Desviación 11: el cinco rojo en chi y pon lo decide la red**, no una regla
fija.

Casos especiales:

- **Ron y tsumo** comparten acción. En doble ron cada asiento decide.
- **Kan cerrado y añadido** comparten las 34 salidas: para un mismo tipo de
  ficha nunca son posibles los dos a la vez.
- **Decisiones forzadas** (tsumogiri en riichi sin opción de ganar ni de kan)
  no pasan por la red.
- **Guardia de última mano.** Se mantiene la regla anti-agarasu que ya existe
  en `majiang-bot.js` como red de seguridad configurable. El objetivo es que
  el modelo no la necesite; se mide con y sin ella.

## 7. Recompensa y valor

Se toma la idea, publicada por Suphx y usada por Mortal, de recompensar cada
mano por **cuánto cambió el valor esperado del resultado final**.

### Modelo de posición

Una red pequeña que, dado el estado **al empezar una mano**, predice el
resultado final de la partida:

- **Entrada:** formato de la partida, ronda, número de mano, honba, depósitos,
  quién es el oya y los 4 puntajes.
- **Salida:** distribución sobre las 24 ordenaciones finales, y el puntaje
  final esperado de cada jugador.
- **Entrenamiento:** con todas las partidas disponibles, de cualquier nivel.

**Desviación 12: una MLP sobre el estado actual, no una GRU sobre la
historia.** Con las reglas fijas, lo que queda de partida depende del estado
actual y no de cómo se llegó a él. Una MLP es más simple, se calibra mejor y
**no necesita memoria entre manos**, lo que encaja con un servidor sin estado.

### Recompensa de una mano

> recompensa = valor(inicio de la mano siguiente) − valor(inicio de esta mano)
>
> valor = uma · P(puesto) + peso × puntaje final esperado

En la última mano se usa el resultado real.

**Desviación 13: el valor incluye los puntos brutos.** En Tenhou solo cuenta
el puesto. En esta plataforma el resultado final es
`(puntaje − 30.000) / 1.000 + uma + oka`, así que cada 1.000 puntos valen un
punto. El vector efectivo de puesto es **+40 / +10 / −10 / −20** (el oka de 20
va al primero) y el peso de los puntos brutos es 1 por cada 1.000. Para Tenhou
el peso es 0.

## 8. Interfaz entre el bot y el juego

**Protocolo: mjai, con extensiones opcionales.**

### Dos transportes, los mismos mensajes

| Transporte | Uso |
| --- | --- |
| JSON por líneas en entrada y salida estándar | Enfrentar bots externos que hablen mjai, herramientas, depuración |
| Llamada en proceso: `decidir(eventos de la mano, asiento, reglas) → acción` | Producción: el WASM dentro de la función de Vercel. Sin estado: recibe el registro de la mano, como ya hacen los dos adaptadores actuales |

### Mensajes

- **Del juego al bot:** `start_game`, `start_kyoku`, `tsumo`, `dahai`, `chi`,
  `pon`, `daiminkan`, `ankan`, `kakan`, `dora`, `reach`, `reach_accepted`,
  `hora`, `ryukyoku`, `end_kyoku`, `end_game`. Lo que el asiento no ve va
  como `"?"`.
- **Del bot al juego:** `dahai`, `reach`, `chi`, `pon`, `daiminkan`, `ankan`,
  `kakan`, `hora`, `ryukyoku` o `none`.

### Extensiones

Van en una clave propia que otros bots ignoran:

| Dónde | Qué |
| --- | --- |
| `start_game` | **Reglas:** tonpuusen o hanchan, puntaje inicial y de retorno, uma y oka, cincos rojos, variantes |
| Petición de decisión | Lista de acciones legales según el juego. El bot la compara con la suya y avisa si difieren: es una prueba continua |
| Respuesta | Opcional: probabilidades de la política, valor, distribución de puesto, mapa de peligro. Sirve para revisar partidas |

### Cambios en este repo para integrarlo

1. `mjai.js`: emitir `start_game` y `end_game` y poder guardar la partida
   entera.
2. Un adaptador nuevo, hermano de `majiang-bot.js`.
3. Un tercer nivel en `bot.js`, con el mismo respaldo que hoy.

Cada uno será un issue aparte cuando llegue el momento.

## 9. Pipeline de datos

### Fuentes

| Fuente | Volumen | Estado legal | Nota |
| --- | --- | --- | --- |
| Registros de Tenhou, sala Houou | Millones de partidas desde 2009 | **⚠ Revisar los términos de uso de Tenhou** sobre descarga masiva y uso para entrenar | La fuente estándar del campo |
| Datasets en Hugging Face ya convertidos a mjai (listados en [ia-investigacion.md §6.4](../ia-investigacion.md#64-datasets-de-partidas)) | 2 millones de partidas en 6,3 GB; otro de ~64 GB | **⚠ Redistribuyen registros de Tenhou con `license: other`.** Usarlos no cambia el origen | Lo más rápido para empezar |
| Mahjong Soul | Mucho, con bastante tonpuusen | **⚠⚠ Sus registros se obtienen con clientes no oficiales.** Riesgo mayor. Reglas con diferencias menores | Recomiendo no empezar por aquí |
| Partidas de esta plataforma | Poco | Limpio, **si se avisa a los jugadores** | Requiere guardar registros |
| Autojuego | Ilimitado | Limpio | Etapa 3 |
| Partidas jugadas por Mortal | Ilimitado | **⚠ Duda:** salida de un programa AGPL. En general la salida de un programa no hereda su licencia, pero no lo doy por seguro | Recomiendo usarlas solo para evaluar, no para entrenar |

**Lo que te toca revisar a ti:** los términos de Tenhou, los de cada dataset
que elijas y, si entrenas con partidas de tu plataforma, el aviso a los
jugadores. Para entrenar en privado sin redistribuir datos el riesgo práctico
es bajo, pero es una decisión tuya, no una suposición mía.

### Conversión

1. **Descarga** de los registros en bruto, o de un dataset ya en mjai.
2. **Conversión a mjai** con un conversor propio dentro de `mjai`. Hay
   conversores con licencia Apache-2.0 (`convlog` de mjai-reviewer,
   tenhou-to-mjai) que se pueden usar como herramientas para contrastar.
3. **Validación:** cada partida se reproduce en el motor propio. Se comprueba
   que cada evento sea legal y que los puntos de cada mano coincidan. Lo que
   falla va a cuarentena con el motivo. **Esta es además la mejor prueba del
   motor:** millones de partidas reales.
4. **Almacenamiento:** mjai comprimido en fragmentos, con un índice por partida
   (fecha, formato, sala, nivel de cada jugador, resultado).
5. **La codificación es al vuelo**, en el cargador. No se guardan tensores.
   Cambiar el codificador no obliga a regenerar nada.

### Filtros

| Filtro | Criterio inicial |
| --- | --- |
| Reglas | 4 jugadores, con cincos rojos y kuitan |
| Formato | Tonpuusen y hanchan, etiquetados. Se sobremuestrea el tonpuusen |
| Sala | Houou |
| **Nivel por asiento** | Aprender solo de los asientos con dan o rate sobre un umbral (los registros de Tenhou traen ambos). El umbral es un hiperparámetro |
| Calidad | Fuera las partidas con abandonos (rachas largas de tsumogiri por tiempo) |
| Duplicados | Por identificador de partida |

El modelo de posición usa **todas** las partidas válidas.

### Particiones

Por fecha: entrenamiento hasta un corte, validación después y prueba con los
últimos meses. Nunca al azar por posición: las posiciones de una misma partida
están correlacionadas.

## 10. Plan de entrenamiento por etapas

**Supuestos de las estimaciones:**

- ~660 decisiones por hanchan sumando los 4 asientos (dato de un comentario en
  el código de Mortal); la mitad en tonpuusen.
- GPU de referencia: una RTX 4090 (24 GB) con precisión mixta.
- Ritmo de entrenamiento estimado por costo de cómputo: L ~10–15 mil
  muestras/s, M ~40–60 mil, S limitado por el cargador.
- Codificador en Rust: 20–50 mil observaciones/s por núcleo. Hacen falta 8–16
  núcleos para no frenar a la GPU.

**Ninguno de estos ritmos está medido.** La primera tarea con GPU es un
benchmark de una hora que los reemplace por números reales.

### Etapa 0: modelo de posición

| | |
| --- | --- |
| Datos | Inicios de mano de todas las partidas: unas 10 filas por partida |
| Cómputo | Minutos a una hora. Sirve una CPU |
| Éxito | Calibración por tramos (lo predicho frente a lo ocurrido) con error bajo en validación, por formato y por mano |

### Etapa 1: imitación supervisada

| | |
| --- | --- |
| Objetivo | Entropía cruzada de la política sobre la acción del humano, más las cabezas auxiliares |
| Datos | Mínimo útil: 300 mil partidas (~200 M de muestras). Meta: 1–2 millones |
| Cómputo, modelo M | ~9 h por pasada sobre 2 millones de partidas. 2–3 pasadas: **~1 día** |
| Cómputo, modelo L | ~30 h por pasada: **3–4 días** |
| VRAM | 8–12 GB bastan con lotes de 2.048–4.096; 24 GB dan holgura |
| Disco | 10–70 GB según el dataset |
| Éxito, fuera de línea | Acierto en el descarte ≥ 68 % en validación (meta 70 % o más). Aciertos de riichi y de llamadas por separado. Curvas sin sobreajuste |
| Éxito, jugando | Puesto medio ≤ 2,30 contra 3 majiang-ai en al menos 2.000 partidas con las reglas de la plataforma. Tasa de ron repartido bajo 14 % |
| Línea base | Se anota la distancia contra Mortal-S42. **Lo esperable es perder**: un modelo de pura imitación no iguala a los jugadores de los que aprende |

### Experimentos de diseño baratos

Se hacen en la etapa 1, con el modelo S y 300 mil partidas (horas cada uno):

| | Pregunta | Decide |
| --- | --- | --- |
| E1 | ¿Los pesos compartidos entre palos ganan a una red 1D corriente a igual costo? | El tronco |
| E2 | ¿El modelo usa el uma y el formato de entrada? Se mide cambiando el dato y viendo si cambian las decisiones de última mano | Desviaciones 5 y 6 |
| E3 | ¿Una rama que lee los descartes como secuencia mejora sobre los planos por tramos? | Desviación 2 |
| E4 | ¿Cuánto aportan las cabezas auxiliares de tenpai y peligro? | Desviación 7 |
| E5 | ¿Qué umbral de nivel por asiento da mejor resultado? | Filtro de datos |

### Etapa 2: mejora fuera de línea

| | |
| --- | --- |
| Objetivo | (a) Ajustar la cabeza de valor por acción y las de puesto y puntos al **retorno real de cada mano**, sin *bootstrapping*. (b) Mejorar la política imitando con más peso las acciones con ventaja positiva. Se parte del modelo de la etapa 1 |
| Alternativa | Un término conservador tipo CQL sobre la cabeza de valor por acción, jugando con su máximo. Se comparan las dos; ambas son técnicas publicadas |
| Datos | Los mismos, más la recompensa por mano de la etapa 0 |
| Cómputo | 1–2 pasadas más: **1–3 días** para L, menos de un día para M |
| Éxito | Gana al modelo de la etapa 1 en partidas duplicadas por **+3 puntos o más** (escala 90/45/0/−135) con el intervalo de 95 % fuera de cero. Baja la tasa de ron repartido. Pasa la batería de posiciones de última mano |

### Etapa 3: autojuego

| | |
| --- | --- |
| Objetivo | Gradiente de política con el valor como línea base y recompensa por mano |
| Rivales | Una liga: el modelo actual contra versiones anteriores y contra el modelo de imitación como ancla |
| Estabilidad | Penalización por alejarse de la política de la etapa 2, que se relaja con el tiempo. Uma sorteado por partida. Tasa de aprendizaje baja. Promoción solo si gana una prueba con muros duplicados |
| Ritmo | Cifra de planificación: 1–3 millones de partidas al día con una 4090 y 16–32 núcleos, con el modelo M |
| Volumen | 20–100 millones de partidas: **2–6 semanas** con una GPU |
| Éxito | Gana al mejor de la etapa 2 por +3 puntos. Meta para L: empatar con Mortal-S42 dentro del intervalo en 20 mil partidas |

**Aviso honesto:** la etapa 3 es la más cara y la más incierta. No hay cifras
públicas de cuánto cómputo usó Mortal ni de cuánto le aportó su fase en línea.
Empatar con Mortal es una meta, no una promesa. Las etapas 1 y 2 ya dan un bot
útil para la plataforma.

### Costo aproximado en la nube

Con una 4090 alquilada a 0,35–0,70 USD por hora (**precio a verificar**): la
etapa 1 cuesta decenas de dólares; la etapa 2, parecido; la etapa 3, entre 300
y 1.000 USD según cuánto dure.

## 11. Estrategia de evaluación

### Formato de las pruebas

- **Partidas duplicadas, 1 contra 3:** cada juego de muros se juega 4 veces,
  con el retador en cada asiento. Es lo que hace Mortal y lo que ya se hizo en
  este repo.
- **Comparación pareada:** para comparar A con B, los dos juegan contra los
  mismos rivales con los mismos muros y se mira la diferencia.
- **Dos reglamentos:** hanchan de Tenhou, para comparar con cifras publicadas,
  y las reglas de esta plataforma, que es lo que se entrega.
- **Intervalos por juego de muros**, no por partida: las 4 partidas de un
  juego comparten suerte.

### Cuántas partidas hacen falta

Con puestos repartidos por igual, la desviación típica por partida es de unos
84 puntos (escala 90/45/0/−135) y de 1,12 puestos. La mitad del intervalo de
95 %:

| Partidas | Puntos | Puesto medio |
| --- | --- | --- |
| 1.000 | ± 5,2 | ± 0,069 |
| 4.000 | ± 2,6 | ± 0,035 |
| 10.000 | ± 1,65 | ± 0,022 |
| 40.000 | ± 0,82 | ± 0,011 |
| 100.000 | ± 0,52 | ± 0,007 |

En la práctica:

- **Diferencia grande** (contra majiang-ai): 1.000–2.000 partidas.
- **Promoción entre versiones** (3 puntos): unas 10.000.
- **Afinar** (1 punto): 40.000–100.000. Solo con el simulador rápido.

Los muros duplicados reducen algo la varianza, pero no mucho: en las pruebas
de este repo, 512 partidas dieron ± 7,7 puntos, casi lo mismo que sin
duplicar. Es un dato medido.

### Rivales

| Rival | Para qué | Licencia |
| --- | --- | --- |
| Versiones anteriores | Promoción | Propia |
| majiang-ai | Piso: cualquier modelo debe ganarle con claridad | MIT |
| Mortal-S42 | Ancla externa fuerte | **⚠** Código AGPL, pesos Apache-2.0. Para evaluar en privado sin distribuir no veo problema, pero **debe correr como proceso aparte por mjai y no entrar al repo privado** |
| akochan | Segunda ancla, opcional | **⚠** Licencia propia: solo uso no comercial. Además tarda ~1,5 s por decisión (medido) |

### Rating

- En 4 jugadores un Elo por parejas no está bien definido. Se propone una
  **tabla contra un panel fijo** (majiang-ai, el modelo de imitación,
  Mortal-S42): puntos medios y puesto medio de cada versión contra cada uno.
- **No hay rango oficial posible:** Tenhou no admite bots sin permiso, y jugar
  con bots en plataformas ajenas viola sus términos. No se propone.
- A futuro, el rating real sale de la liga de esta plataforma.

### Además de los torneos

- **Estadísticas de estilo:** tasas de victoria, ron repartido, riichi y
  llamadas, comparadas con las de jugadores de Houou. Detectan patologías.
- **Batería de posiciones:** casos escritos a mano con respuesta conocida (no
  ganar para quedar último, plegarse ante un riichi con mano sin valor).
  Corre en segundos.
- **Paridad:** el ONNX contra PyTorch y el WASM contra el módulo de Python
  sobre miles de posiciones, como ya se hizo con Mortal en este repo.

## 12. Versión liviana

**El modelo S: 96 × 12, ~0,8 M de parámetros, ~5 ms estimados por decisión en
un hilo.**

| Técnica | Detalle |
| --- | --- |
| Destilación | El modelo S aprende de las salidas del mejor modelo grande (política, valor, peligro), sobre posiciones humanas y de autojuego. Rinde más que entrenarlo solo |
| Cuantización | Pesos a 8 bits tras calibrar. Se mide la pérdida de acierto antes de aceptarla |
| Una pasada por decisión | Por el diseño de las acciones ([§6](#6-espacio-de-acciones)) |
| Codificador barato | Sin búsquedas: todo son recorridos de 34 posiciones y consultas a tablas |
| Entrada pequeña | ~100 planos en vez de 1.012 |

| | Hoy con Mortal (medido) | Meta con el modelo S (estimado) |
| --- | --- | --- |
| Red | 22 MB | 1–3 MB |
| Codificador WASM | 1,3 MB | < 0,5 MB |
| Tiempo por decisión | ~70 ms; dos consultas en riichi | ~5 ms, siempre una |
| Memoria | ~480 MB | < 100 MB |

**Dónde corre:**

- **En el servidor** (recomendado): los pesos quedan privados.
- **En el navegador:** posible con el modelo XS o S, y permitiría practicar sin
  conexión. **⚠ Cualquiera podría descargar los pesos.** Si la IA debe seguir
  siendo privada, solo en el servidor.

## 13. Repositorio e integración

**Recomendación: un repositorio privado separado.**

| Motivo | Detalle |
| --- | --- |
| **Licencia** | Este repo es AGPL-3.0 y contiene una copia de libriichi. La IA privada no puede vivir aquí |
| **Higiene de la implementación** | Quien implemente no debe tener el código de Mortal en su espacio de trabajo |
| Herramientas distintas | Rust y Python con GPU frente a JavaScript sin compilación |
| Artefactos pesados | Modelos, datos y registros de entrenamiento |
| Privacidad | Este repo es público |

### Cómo se conectan

```
riichi-aero-ai (privado)                  riichi-mahjong-aero (este)
  motor, codificador, entrenamiento
        │
        ├─ encoder.wasm  ─────────────►   adaptador JS + bot.js
        ├─ modelo.onnx   ─────────────►   (tercer nivel de bot)
        │
        ◄──── registros mjai de prueba ── motor JS (oráculo)
```

- De la IA al juego pasan **dos artefactos binarios** y un contrato: el
  protocolo de [§8](#8-interfaz-entre-el-bot-y-el-juego).
- Del juego a la IA pasan **registros de partidas**, que son datos y no
  código, para las pruebas diferenciales.

> **⚠ Punto de licencia que tienes que decidir.** Mientras este repo sea AGPL,
> **integrar aquí un binario privado choca con la AGPL**: quien ofrece el
> juego por red debe publicar el código fuente de la obra completa. Veo dos
> salidas:
>
> 1. **Quitar Mortal y cambiar la licencia del juego** cuando la IA propia lo
>    reemplace. `mortal/README.md` ya explica qué borrar. El resto del código
>    es tuyo, salvo majiang-ai (MIT) y Three.js (MIT). Antes hay que confirmar
>    que no quede nada derivado de Mortal y que no haya otros autores con
>    derechos sobre el código.
> 2. **Servir la IA como un servicio aparte** que habla mjai por red. Es la
>    lectura habitual de "programas separados", pero con la AGPL es una zona
>    gris y no la doy por segura.
>
> Recomiendo la primera. No es asesoría legal.

### Estructura inicial propuesta

Todavía no se crea.

```
riichi-aero-ai/
├── README.md
├── LICENSE                    # privada: todos los derechos reservados
├── PROVENANCE.md              # de dónde sale cada idea y cada dato; qué no se copió
├── Cargo.toml                 # workspace
├── crates/
│   ├── core/                  # fichas, manos, shanten, puntos, reglas, estado
│   ├── obs/                   # vista por asiento, codificador, acciones
│   ├── mjai/                  # eventos, conversor de Tenhou, validador
│   ├── arena/                 # autojuego, muros duplicados, estadísticas
│   ├── py/                    # módulo de Python (PyO3)
│   ├── wasm/                  # codificador para la plataforma
│   └── cli/                   # convertir, validar, jugar, bot mjai
├── python/
│   └── aero_ai/
│       ├── models/            # tronco, cabezas, tamaños
│       ├── data/              # cargador, filtros, particiones
│       ├── train/             # etapas 0 a 3
│       ├── eval/              # torneos, intervalos, informes
│       └── export/            # ONNX, cuantización, destilación
├── configs/                   # un archivo por experimento
├── tests/
│   ├── fixtures/              # registros del motor JS y posiciones de prueba
│   └── positions/             # batería de posiciones con respuesta conocida
├── tools/                     # descarga de datos, puente con bots externos
├── docs/                      # estos tres documentos, movidos aquí
└── .gitignore                 # datos, modelos y registros fuera de git
```

## 14. Entorno de esta sesión

Medido en el contenedor donde se escribió esto:

| Recurso | Valor |
| --- | --- |
| CPU | 4 núcleos (Xeon a 2,3 GHz) |
| RAM | 15 GB |
| Disco libre | ~30 GB |
| GPU | **No hay** |
| Herramientas | Rust 1.97, Python 3.13, Node 22. PyTorch no está instalado |
| Red | Llega a PyPI, crates.io y Hugging Face. GitHub, solo a este repo |
| Persistencia | El contenedor es efímero: lo que no se sube a git se pierde |

| Se puede hacer aquí | Lo tienes que correr tú |
| --- | --- |
| Todo el código: motor, codificador, conversor, arena, entrenamiento, evaluación | Cualquier entrenamiento real (etapas 1 a 3) |
| Pruebas del motor contra el motor JS y contra una muestra de registros | Descargar y guardar el dataset completo |
| Entrenamiento de humo en CPU: modelo XS, unos miles de partidas, para probar que el pipeline funciona de punta a punta | Autojuego a escala |
| Etapa 0 (modelo de posición) con una muestra | Torneos de más de unos pocos miles de partidas |
| Exportar a ONNX, compilar el WASM, integrar en el juego | Decisiones de licencia y de términos de uso |
| Torneos pequeños (cientos de partidas) | Crear el repo privado y dar acceso a la sesión |

## 15. Licencias y procedencia

### Reglas de trabajo

1. **Nada de código de Mortal en el repo de la IA**, ni literal ni traducido.
2. **Las sesiones de implementación trabajan desde este documento**, sin abrir
   el código de Mortal ni `mortal/libriichi` de este repo.
3. **El motor se especifica con el motor JS de este proyecto** y con las
   reglas públicas del juego.
4. **Las tablas de shanten y de agari se generan con código propio.** No se
   reutilizan los binarios de libriichi.
5. **El formato de la observación es propio e incompatible con el de Mortal.**
   Los pesos de Mortal no sirven aquí, y eso es intencional.
6. `PROVENANCE.md` registra el origen de cada idea, con su referencia pública.

### Límite honesto del "clean room"

Este diseño lo escribió quien leyó el código de Mortal. No es una sala limpia
estricta. Lo que protege es que la especificación describe ideas y que la
estructura es distinta en casi todo lo que se puede elegir: entrada, tronco,
cabezas, acciones, recompensa y entrenamiento. Si necesitas una garantía más
fuerte, la implementación debería hacerla alguien que no haya visto el código
de Mortal, trabajando solo desde este documento.

### Dudas marcadas

| Tema | Duda | Recomendación |
| --- | --- | --- |
| **Este repo es AGPL** | Integrar un binario privado choca con la licencia | Ver [§13](#13-repositorio-e-integración) |
| **Estos documentos** | Se publican en un repo público y AGPL | Moverlos al repo privado cuando exista, si no quieres que el diseño sea público |
| **Código del juego reutilizado** | El motor JS se usa como especificación y oráculo | Es tuyo. Confirmar que no hay otros titulares |
| **libriichi** | AGPL-3.0-or-later | No copiar. No usar sus tablas binarias, cuyo origen no vi documentado |
| **Tablas de valor en solitario** | Port de mahjong-cpp, anotado como GPL-3.0 | No reimplementar desde ninguno de los dos |
| **Formato mjai** | Es una convención de mensajes creada por el proyecto mjai de gimite. Implementar un formato compatible no suele plantear problemas de derechos de autor. **No verifiqué la licencia de ese proyecto** | No copiar código ni documentación suya. Verificar la licencia si se quiere reutilizar algo |
| **Conversores Apache-2.0** | `convlog` y tenhou-to-mjai | Se pueden usar como herramientas. Si se incorporan como dependencia, conservar los avisos |
| **Registros de Tenhou** | Términos de uso sobre descarga y uso | Revisar antes de descargar en masa |
| **Datasets de Hugging Face** | `license: other`; redistribuyen Tenhou | Revisar cada ficha |
| **Mahjong Soul** | Obtención por clientes no oficiales | Evitar al principio |
| **Pesos Mortal-S42** | Apache-2.0 según su autor, entrenados con código AGPL y datos de Tenhou | Solo como rival de evaluación, en proceso aparte |
| **Destilar desde Mortal** | Entrenar con sus salidas | No hacerlo: mantiene limpia la procedencia |
| **akochan** | Licencia propia, uso no comercial | Solo evaluación privada, si acaso |

## Referencias públicas de las ideas

- Recompensa por predicción global y *oracle guiding*: Li et al., *Suphx*,
  2020 (<https://arxiv.org/abs/2003.13590>).
- Aprendizaje fuera de línea conservador: Kumar et al., *CQL*, 2020
  (<https://arxiv.org/abs/2006.04779>).
- Imitación ponderada por ventaja: Peng et al., *AWR*, 2019
  (<https://arxiv.org/abs/1910.00177>); Wang et al., *CRR*, 2020
  (<https://arxiv.org/abs/2006.15134>).
- Gradiente de política proximal: Schulman et al., *PPO*, 2017
  (<https://arxiv.org/abs/1707.06347>).
- Compuertas por canal: Hu et al., *Squeeze-and-Excitation*, 2017
  (<https://arxiv.org/abs/1709.01507>).
- Destilación: Hinton et al., 2015 (<https://arxiv.org/abs/1503.02531>).
- Análisis de Mortal: [MORTAL_NOTES.md](MORTAL_NOTES.md).
