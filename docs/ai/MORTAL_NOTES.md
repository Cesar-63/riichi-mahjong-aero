# Notas sobre Mortal: análisis conceptual

Análisis de [Mortal](https://github.com/Equim-chan/Mortal) (Equim, AGPL-3.0-or-later)
para diseñar una IA propia. Describe **qué hace y por qué**, con palabras y
estructura propias. No contiene código de Mortal ni traducciones de su código.

- **Versión leída:** commit `0cff2b5` (28 de septiembre de 2025), el mismo del
  que sale la copia de `mortal/libriichi` de este repo.
- **Cómo se leyó:** un clon en un directorio temporal fuera del repo, que no se
  agregó a git. Se leyeron la red, el entrenamiento, el cargador de datos, el
  codificador de la observación, el agente, la arena y la documentación.
- **Qué significa "verificado":** lo que sigue sale de leer el código, salvo
  donde dice *no verificado* o *inferido*.

> **Aviso sobre "clean room".** Este análisis se hizo leyendo el código fuente
> de Mortal, y este repo ya contiene una copia de libriichi. Una sala limpia en
> sentido estricto separa a quien lee el original de quien escribe la
> implementación nueva. Aquí no hay esa separación: lo que hay es una
> **especificación conceptual** (este documento y `ARCHITECTURE.md`) desde la
> que se implementa sin abrir el código de Mortal. Las ideas y los algoritmos no
> están protegidos por derechos de autor; el código, su estructura y sus nombres
> sí. Esto no es asesoría legal. Las medidas concretas están en
> [ARCHITECTURE.md §15](ARCHITECTURE.md#15-licencias-y-procedencia).

## 1. Visión general

Mortal es una IA de riichi de 4 jugadores con las reglas de las mesas ranked de
Tenhou. Decide con **una sola pasada de una red neuronal**: no hace búsqueda en
el momento de jugar. Tiene dos mitades:

| Mitad | Lenguaje | Qué hace |
| --- | --- | --- |
| libriichi | Rust | Todo lo que es mahjong: estado del jugador, shanten, agari y puntos, codificación de la observación, lectura de registros mjai, simulador de partidas, estadísticas |
| mortal | Python + PyTorch | Todo lo que es red: el modelo, el motor de inferencia por lotes, el entrenamiento fuera de línea y en línea |

La red aprende un valor Q por acción. El valor mide puntos de posición
esperados de la partida, no puntos de la mano.

## 2. Codificación del estado

### Forma

La entrada es una matriz de **canales × 34**, donde 34 son los tipos de ficha
(m1–9, p1–9, s1–9, vientos, dragones). La versión 4 tiene 1.012 canales (las
anteriores, entre 934 y 942). Todo se codifica como planos sobre esas 34
posiciones:

- **Un dato por ficha** (por ejemplo, "tengo esta ficha") marca la posición de
  esa ficha.
- **Un dato global** (por ejemplo, mis puntos) llena una fila entera con el
  mismo valor. Buena parte de los 1.012 canales son filas constantes.

### Qué información entra

| Grupo | Contenido | Cómo |
| --- | --- | --- |
| Mano propia | Cuántas copias de cada ficha | 4 planos tipo termómetro (≥1, ≥2, ≥3, 4) |
| Cincos rojos propios | Si tengo cada uno de los tres | 3 filas |
| Puntos | Los de los 4 jugadores, desde mi asiento | Fila escalada; en la v4, dos escalas (hasta 100.000 y hasta 30.000) |
| Posición actual | Mi puesto | One-hot de 4 filas |
| Mano y ronda | Número de kyoku, honba, depósitos de riichi | One-hot y enteros con una codificación suavizada (bases radiales) |
| Vientos | Viento de ronda y de asiento | Marcas en la ficha del viento |
| Dora | Indicadores visibles, doras que tiene cada jugador a la vista, doras sin ver | Planos por ficha y enteros |
| Descartes propios | Los primeros 6 y los últimos 18, cada uno con detalle | Un grupo de planos por descarte |
| Descartes rivales | Igual, por rival: primeros 6 y últimos 18, con ficha, si fue de la mano o recién robada, si fue el descarte de riichi, y si alguien lo llamó | Un grupo de planos por descarte |
| Resumen temporal de descartes | Por jugador, cada ficha descartada con un peso que decae hacia atrás en el tiempo; para rivales, tres planos: todos, solo de la mano, solo riichi | Planos con valores entre 0 y 1 (desde la v3) |
| Llamadas | Hasta 4 llamadas por jugador con sus fichas, el rojo si lo hay y cuál se tomó | Un grupo de planos por hueco de llamada |
| Kan cerrados | Por jugador | Planos |
| Fichas vistas | Cuántas copias de cada ficha se ven en la mesa | Planos |
| Riichi rival | Declarado y aceptado, por rival; la ficha del descarte de riichi; el último descarte de mano | Filas y marcas |
| Estado propio | Furiten, shanten, si estoy en riichi | Filas |
| Fichas restantes | Robos que quedan en el muro | Fila escalada |
| **Contexto de la decisión** | Qué ficha se ofrece, qué puedo hacer (descartar, riichi, chi bajo/medio/alto, pon, kan y sus candidatas, ganar, kyuushu), qué descartes mantienen el shanten | Filas y marcas |
| **Tablas de valor en solitario** (solo v4) | Para cada descarte posible, probabilidad de tenpai, de ganar y valor esperado, turno por turno (17 turnos), más las fichas que hacen falta y el mejor descarte por valor y por probabilidad | Planos |

Tres ideas que vale la pena notar:

1. **El orden de los descartes se conserva dos veces.** Con detalle para los
   primeros y los últimos, y con un resumen de pesos decrecientes para todo el
   estanque. Así la red ve tanto "qué tiró justo antes del riichi" como el
   panorama general, con un número fijo de canales.
2. **La red recibe lo que se le pregunta.** La observación incluye las acciones
   posibles en ese momento, no solo la máscara de salida.
3. **La v4 le da a la red un cálculo de búsqueda ya hecho.** Las tablas de
   valor en solitario son una búsqueda de eficiencia (sin rivales) que corre en
   Rust antes de la red. Es un port del calculador de
   [nekobean/mahjong-cpp](https://github.com/nekobean/mahjong-cpp). Es la parte
   más cara de codificar: en este repo se midió 0,7 ms de mediana y 160 ms
   como máximo por observación.

### Información oculta

Durante el juego la red solo ve información pública más su mano. El código
conserva una **observación "oráculo"** aparte (217 canales en la v4) con las
manos rivales, el muro en orden, los indicadores de dora futuros y los ura. La
red puede construirse con esa entrada extra, lo que corresponde a la técnica de
*oracle guiding* de Suphx. **En el script de entrenamiento actual la red
principal se construye sin oráculo.** *Inferido:* se usó en versiones
anteriores y se dejó de usar; no encontré documentación que lo confirme.

## 3. Arquitectura de la red

| Parte | Diseño |
| --- | --- |
| Entrada | Convolución 1D (núcleo 3) de 1.012 canales al ancho de trabajo |
| Tronco | Bloques residuales 1D de preactivación: normalización por lotes, Mish, convolución de núcleo 3, dos veces por bloque |
| Atención por canal | Al final de cada bloque: se resume cada canal con la media y el máximo sobre las 34 posiciones, se pasa por una MLP pequeña compartida y el resultado, con sigmoide, escala los canales (estilo CBAM / squeeze-and-excitation) |
| Salida del tronco | Convolución a 32 canales, aplanado (32 × 34) y una capa densa a un vector de 1.024 |
| Cabeza Q (v4) | Una sola capa lineal de 1.024 a 1 + 46: un valor de estado y 46 ventajas |
| Combinación | *Dueling*: Q = valor + ventaja − media de las ventajas **de las acciones legales**. Las ilegales quedan en −∞ |
| Cabeza auxiliar | Una capa lineal que predice mi puesto al empezar la mano siguiente (4 clases). Solo se usa al entrenar |

**Tamaño.** Es configurable. La configuración de ejemplo y los pesos
comunitarios usan 192 canales × 40 bloques: unos 10,8 millones de parámetros y
unas 0,3 mil millones de multiplicaciones por pasada. En este repo, con
onnxruntime-web en un hilo, son unos 70 ms por decisión.

**Detalles finos.** La normalización por lotes usa un momento muy bajo (0,01),
que hace que sus estadísticas cambien despacio, y puede congelarse (se congela
en el entrenamiento en línea). La v1 usaba ReLU y una capa latente
estocástica; se abandonó.

Además hay una **segunda red, pequeña e independiente**, que solo sirve para
calcular la recompensa: ver [§5](#recompensa-predicción-global-del-resultado).

## 4. Espacio de acciones

Son **46 acciones planas** con una máscara de legalidad:

| Acciones | Significado |
| --- | --- |
| 37 | Descartar un tipo de ficha (34) o un cinco rojo (3). Las mismas 37 salidas se reutilizan para elegir **con qué ficha hacer kan** |
| 1 | Declarar riichi |
| 3 | Chi, según la ficha tomada quede abajo, en medio o arriba |
| 1 | Pon |
| 1 | Kan (decidir si se hace) |
| 1 | Ganar (ron o tsumo, según el contexto) |
| 1 | Kyuushu kyuuhai |
| 1 | Pasar |

Acciones especiales:

- **Riichi en dos pasos.** Primero se elige "riichi". Después se vuelve a
  consultar la red, con el riichi ya declarado en el estado, para elegir el
  descarte.
- **Kan en dos pasos.** Primero se elige "kan". Si hay más de una candidata,
  una segunda consulta con una bandera de "eligiendo kan" decide cuál, usando
  las salidas de descarte.
- **Chi y pon con cincos rojos.** La acción no dice si se gasta el rojo. Lo
  resuelve una regla fija fuera de la red. *No verificado en el código de
  Mortal:* el adaptador de este repo asume que prefiere gastar el rojo, y con
  esa regla coincidió con el bot oficial en 1.867 decisiones.
- **Ron y tsumo** comparten una acción. Con doble ron, cada jugador decide por
  su cuenta.
- **Atajos sin red.** Si la decisión es obvia o única (por ejemplo, tsumogiri
  forzado en riichi), el agente responde sin evaluar la red.
- **Guardia de agari.** Una regla opcional veta ganar en la última mano cuando
  ganar deja al jugador último. Si la red elige ganar y la regla lo veta, se
  toma la segunda mejor acción.

## 5. Entrenamiento

### Datos

- Registros de partidas en **formato mjai** comprimidos, un archivo por partida.
- El repo de Mortal **no incluye datos** ni dice de dónde sacarlos. Los modelos
  comunitarios declaran partidas de la sala Houou de Tenhou y de salas altas de
  Mahjong Soul.
- Se puede filtrar por **nombre de jugador**: una lista de jugadores de los que
  aprender, o una lista de exclusión. Una partida entra si participa al menos
  uno de los jugadores elegidos, y solo se generan muestras desde su asiento.
- Cada decisión de cada asiento elegido es una muestra: observación, máscara,
  acción tomada, a qué mano pertenece y cuántos pasos faltan para que la mano
  termine. Unas 660 muestras por partida, según un comentario del código.
- También son muestras las **decisiones de no actuar**: pasar un chi, un pon o
  un ron que se podía hacer. El cargador distingue "decidí pasar" de "me
  interrumpió la llamada de otro".
- **Aumento de datos:** una segunda pasada con los palos intercambiados.
- Los archivos se barajan y se mezclan en un búfer de varias partidas antes de
  formar lotes, para que un lote no salga de una sola partida.

### Recompensa: predicción global del resultado

La recompensa no es el resultado final de la partida ni los puntos de la mano.
Es **cuánto cambió, durante esa mano, el valor esperado de mi posición final**:

1. Una red recurrente pequeña (GRU de 2 capas) lee la secuencia de inicios de
   mano de una partida: número de mano, honba, depósitos y los 4 puntajes.
2. Predice una distribución sobre las **24 ordenaciones finales** posibles de
   los 4 jugadores. De ahí sale una matriz jugador × puesto.
3. Esa matriz, multiplicada por un vector de puntos por puesto, da los puntos
   de posición esperados en cada inicio de mano.
4. La recompensa de una mano es la diferencia entre el valor esperado al
   empezar la mano siguiente y el de la actual. En la última mano se usa el
   puesto real.

Esta red se entrena aparte, antes que la principal, con clasificación sobre
las 24 ordenaciones. La idea viene de Suphx (*global reward prediction*).

**Por qué importa:** convierte una señal por partida (ruidosa y tardía) en una
señal por mano. La mano es la unidad natural de crédito, y la red principal
aprende a valorar los puntos según la situación: 1.000 puntos valen mucho en la
última mano y poco en la primera.

### Objetivo fuera de línea

La pérdida suma tres términos:

| Término | Qué es |
| --- | --- |
| Regresión de Q | Error cuadrático entre Q(estado, acción jugada) y el **retorno real de esa mano**, descontado por los pasos que faltaban |
| Término conservador (CQL) | Baja los valores Q de todas las acciones (su log-suma-exponencial) y sube el de la acción que jugó el humano. Tiene un peso propio |
| Auxiliar | Entropía cruzada de la predicción del puesto en la mano siguiente |

Lo que se nota al leerlo:

- **El objetivo es Monte Carlo, no TD.** No hay *bootstrapping* ni red objetivo:
  cada decisión se entrena contra lo que pasó de verdad en esa mano. Es
  estable y simple, a costa de varianza.
- **El descuento solo cuenta descartes y kanes**, no los pases.
- **El término conservador es lo que hace que funcione fuera de línea.** Sin
  él, la red inventa valores altos para acciones que los humanos nunca
  tomaron. En la práctica empuja la política hacia la de los datos, como una
  clonación de comportamiento suave.
- **No hay etapa supervisada separada.** Mortal aprende valores desde el
  principio, sin pasar primero por imitar.

### Entrenamiento en línea

- Un **servidor** guarda los parámetros actuales y un búfer de partidas.
- Varios **clientes** piden los parámetros, juegan partidas en la arena y
  envían los registros. *Inferido de los nombres y la configuración:* el
  aprendiz juega contra un modelo de referencia fijo, y solo se aprende de los
  asientos del aprendiz.
- El **entrenador** vacía el búfer y entrena con el mismo objetivo, **sin el
  término conservador**, porque los datos ya vienen de la propia política.
- **Exploración:** casi siempre la mejor acción; con probabilidad pequeña,
  una muestra de Boltzmann sobre los valores Q con temperatura baja y corte
  top-p.
- El servidor puede frenar a los clientes si el búfer se llena, y forzar que
  no se juegue con parámetros viejos.

### Trucos de estabilidad

- Objetivo Monte Carlo en vez de TD.
- Término conservador con peso alto fuera de línea.
- AdamW con decaimiento de pesos, calentamiento de la tasa de aprendizaje y
  recorte de gradiente opcional.
- Normalización por lotes con momento bajo, congelada en línea.
- Precisión mixta opcional.
- Cada cierto número de pasos juega partidas de prueba contra una referencia y
  guarda como "mejor" el modelo solo si mejora a la vez el puesto medio y los
  puntos.

> **Los hiperparámetros reales no son públicos.** La configuración de ejemplo
> avisa que sus valores son marcadores de posición. Tampoco se publican los
> pesos oficiales ni cuántas partidas o cuánto cómputo se usó.

## 6. El papel de libriichi y su interfaz con Python

libriichi es una biblioteca de Rust expuesta a Python con PyO3. Hace todo lo
que debe ser rápido o exacto:

| Módulo | Función |
| --- | --- |
| Estado del jugador | Reconstruye, evento por evento, lo que un asiento sabe. Calcula acciones legales, shanten, esperas, furiten |
| Codificador | Convierte ese estado en la matriz de observación y la máscara |
| Algoritmos | Shanten y agari con tablas precalculadas, cálculo de puntos, tablas de valor en solitario |
| Datos | Lee registros mjai comprimidos y produce las muestras de entrenamiento y los datos de la red de recompensa |
| Arena | Simulador de partidas completas con muros reproducibles; modos 1 contra 3 y 2 contra 2 |
| Agentes | Envoltorios para jugar con la red, con akochan, con registros o con tsumogiri |
| Estadísticas | Tasas de victoria, de ron repartido, de riichi, de llamadas y demás, a partir de registros |
| Bot mjai | Un jugador que lee y escribe eventos mjai |

**Cómo se reparten el trabajo.** Python nunca toca reglas de mahjong. Rust
simula muchas partidas a la vez, codifica en paralelo las observaciones de
todos los jugadores que deben decidir y **llama a Python una vez por lote**.
Python corre la red sobre el lote y devuelve las acciones. Para entrenar,
Python le pide a Rust arreglos numpy ya listos.

**La consecuencia que importa:** el mismo código de Rust codifica al entrenar
y al jugar. No hay dos codificadores que puedan divergir.

## 7. Evaluación de la fuerza

- **Partidas duplicadas, 1 contra 3.** El retador juega contra tres copias del
  campeón. Cada semilla se juega 4 veces, con el retador en cada asiento. Los
  muros, las manos iniciales y los indicadores salen de la semilla, la mano y
  el honba, así que las cuatro partidas comparten la suerte del muro.
- También hay un modo **2 contra 2**.
- **Métrica principal:** puntos de posición medios con 90 / 45 / 0 / −135 y
  puesto medio.
- **Métricas de estilo:** tasas de victoria, ron repartido, riichi, llamadas,
  valor medio de las manos, turno medio, y más.
- **Referencia externa:** akochan. La documentación publica 13.152 partidas de
  1 akochan contra 3 Mortal: akochan −5,7 puntos de media, Mortal +1,9.
- **No hay rango oficial.** Mortal no juega en Tenhou.
- La arena difiere de Tenhou en dos detalles documentados: no hay empate por
  triple ron, y tenhou y chiihou no se suman con otros yakuman.

## 8. Qué es esencial y qué es detalle

### Esencial para la fuerza

| Decisión | Por qué |
| --- | --- |
| **Recompensa por mano basada en posición final esperada** | Es lo que enseña a jugar la partida y no solo la mano. Sin ella, el modelo juega bien la eficiencia y mal los finales |
| **Aprender de millones de partidas de jugadores fuertes antes del autojuego** | El mahjong tiene tanta varianza que empezar el autojuego desde cero es carísimo |
| **Conservadurismo fuera de línea** | Evita valores inventados para acciones fuera de los datos |
| **Codificador idéntico al entrenar y al jugar, y exacto** | Un canal mal codificado degrada el modelo sin dar error |
| **Historia de descartes con orden y con "de la mano / recién robada"** | Es la base de la lectura de manos y de la defensa |
| **Máscara de acciones legales exacta** | La red nunca gasta capacidad en acciones imposibles |
| **Simulador rápido con inferencia por lotes** | El autojuego y la evaluación necesitan millones de partidas |
| **Evaluación con partidas duplicadas y muchas partidas** | Sin eso no se distingue una mejora real del ruido |

### Detalle de implementación (se puede cambiar)

| Decisión de Mortal | Por qué es sustituible |
| --- | --- |
| Convolución 1D sobre 34 posiciones | Es un sesgo razonable, no el único: trata 9m y 1p como vecinos |
| Datos globales como filas llenas | Cómodo, pero infla la entrada a 1.012 canales |
| Atención por canal estilo CBAM, Mish, preactivación | Variantes estándar de ResNet |
| 192 × 40 | Un punto en la curva de tamaño contra fuerza |
| Cabeza *dueling* de valores Q | Una política con valor aparte también sirve, y encaja mejor con una etapa de imitación |
| 46 acciones con riichi y kan en dos pasos | Ahorra salidas a cambio de una segunda consulta |
| GRU sobre la historia de puntajes para la recompensa | El futuro de la partida depende del estado actual, no de cómo se llegó |
| Vector de puntos fijo dentro del valor Q | Obliga a reentrenar para otro uma |
| Tablas de valor en solitario como entrada (v4) | Ayudan, pero no hay una ablación pública que diga cuánto. Son caras de calcular |
| Solo hanchan | Decisión de alcance |
| Servidor y clientes por sockets para el autojuego | Fontanería |
| Rust + PyO3 | Lo esencial es "un solo codificador rápido", no el lenguaje |

### No se sabe

- Cuánto aporta cada grupo de canales. No hay ablaciones públicas.
- Cuánto aporta el entrenamiento en línea sobre el fuera de línea.
- Los hiperparámetros, la cantidad de datos y el cómputo del modelo oficial.

## 9. Licencias de lo analizado

| Componente | Licencia | Nota |
| --- | --- | --- |
| Mortal y libriichi | AGPL-3.0-or-later | No se puede copiar ni traducir a un repo privado que se distribuya o se ofrezca por red sin publicar el código |
| Tablas de valor en solitario de libriichi | Port de mahjong-cpp | **Duda:** `docs/ia-investigacion.md` anota mahjong-cpp como GPL-3.0. No reimplementar a partir de ninguno de los dos |
| Tablas binarias de shanten y agari de libriichi | Dentro del repo AGPL | **Duda:** su origen no está documentado en lo que leí. No reutilizarlas; generar las propias |
| Pesos Mortal-S42 | Apache-2.0 según su autor | Solo sirven con el codificador de Mortal |
| Formato mjai | Ver [ARCHITECTURE.md §15](ARCHITECTURE.md#15-licencias-y-procedencia) | Duda marcada allí |

## Fuentes

- Código: <https://github.com/Equim-chan/Mortal> en el commit `0cff2b5`.
- Documentación: <https://mortal.ekyu.moe> (fuerza y referencias).
- Suphx: Li et al., *Suphx: Mastering Mahjong with Deep Reinforcement
  Learning*, 2020 (<https://arxiv.org/abs/2003.13590>). De ahí vienen la
  predicción global de recompensa y el *oracle guiding*.
- CQL: Kumar et al., *Conservative Q-Learning for Offline Reinforcement
  Learning*, 2020 (<https://arxiv.org/abs/2006.04779>).
- Mediciones propias de velocidad y fuerza: [mortal/README.md](../../mortal/README.md).
