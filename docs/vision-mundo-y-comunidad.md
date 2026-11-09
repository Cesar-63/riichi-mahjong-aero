# Visión: mundo, comunidad y ecosistema

Notas de diseño de noviembre de 2026. Recogen una conversación de ideas sobre
hacia dónde podría crecer el juego. **Nada de esto está implementado ni
decidido**: es una lista anotada y evaluada para volver a ella cuando toque.

Las ideas se reparten en **tres ediciones** del juego (ver
[Ediciones](#ediciones)): una primera edición en torno a *Tetsuya*, una
edición liga cerrada para Mahjong Chile y una edición definitiva con modo
historia y bots propios.

Las ideas están en cinco bloques:

- **A.** [Mundo, cámara y animaciones](#a-mundo-cámara-y-animaciones): que el
  juego se sienta vivo.
- **B.** [Personajes y avatares](#b-personajes-y-avatares): personalidad e
  identificación.
- **C.** [Edición liga](#c-edición-liga-para-mahjong-chile): torneos,
  transmisión y comunidad Mahjong Chile.
- **D.** [Ecosistema](#d-ecosistema-servicios-complementarios): servicios y
  aplicaciones complementarias, incluida la mesa presencial.
- **E.** [Mundo navegable y modo historia](#e-mundo-navegable-y-modo-historia):
  un Chile inventado donde se juega mahjong.

Al final hay una [hoja de ruta por edición](#hoja-de-ruta-por-edición) y una
lista de [riesgos y pendientes](#riesgos-y-pendientes).

## Ediciones

| | Edición 1: *Tetsuya* | Edición 2: Liga | Edición 3: Definitiva |
| --- | --- | --- | --- |
| Para qué | Laboratorio de estilo, animaciones y personalidad | Plataforma de la liga Mahjong Chile | El juego completo, eventualmente a la venta |
| Animaciones y física (A) | Se crean | Se reutilizan | Se pulen |
| Personajes (B) | Fijos, con personalidad | Avatares personalizados por jugador | Los dos |
| Comunidad (C, D) | — | Todo: cuentas, ranking, comentarista, transmisión | Integrado al mundo |
| Mundo (E) | El edificio del parlor | La sala de torneo | La ciudad y el modo historia |
| Reglas | Tipo Tenhou (las actuales) | WRC | Varían por escenario |
| Bots | majiang-ai y Mortal | Ninguno | Propios, entrenados desde cero |
| Código | Público, AGPL-3.0 | Cerrado | Cerrado |

**Edición 1: *Tetsuya*.** Es la versión actual, extendida. Sirve como
laboratorio: aquí se prueban el estilo PS1, las animaciones, la física del ron
y la intro con cámara. El "mundo abierto" se limita al edificio del parlor (la
calle de la entrada, el salón y la trastienda), lo justo para probar el paso
entre zonas sin pagar el costo de una ciudad. Los personajes son fijos, con
cara, ropa y estilo de juego propios.

**Edición 2: Liga.** Código cerrado y **sin bots**: en la liga juegan
personas. Lleva los avatares personalizados, las cuentas con Discord, el
ranking y las estadísticas, el comentarista, las repeticiones y el modo
transmisión, con las **reglas WRC actualizadas, idénticas en el juego y en el
cálculo de puntajes**, que son las que quiere usar la liga A de Mahjong Chile.
Sin Mortal, el modo comentarista pierde
la recomendación de la IA, pero mantiene el análisis de yaku, que es pura
combinatoria. La app de mesa presencial (D) entra **al final** de esta edición,
cuando la plataforma ya tenga vida.

**Edición 3: Definitiva.** Modo historia, ambientes distintos, el Chile
inventado y **bots propios entrenados desde cero**, que reemplazan a Mortal y
permiten que el juego sea cerrado y se pueda vender.

### Tres condiciones para que el orden funcione

1. **Separar el núcleo desde la Edición 1.** El código compartido (reglas,
   motor, mesa 3D, animaciones) no puede depender de Mortal, para que la
   Edición 2 pueda ser cerrada. Hoy se cumple: Mortal está aislado en
   `server/engine/mortal/` y solo lo usa `bot.js`, y `mjai.js` solo implementa
   el formato de eventos. Todos los commits son del autor del proyecto o
   hechos con Claude, así que el autor es dueño del código y puede publicarlo
   bajo AGPL en la Edición 1 y usarlo cerrado en la Edición 2. Hay que
   mantenerlo así: si entran colaboradores, que acepten que su código pueda
   usarse en las versiones cerradas.
2. **Empezar los bots propios temprano**, en paralelo desde la Edición 1 (ver
   [Bots propios](#bots-propios)). Es lo más lento de todo el plan.
3. **La app de mesa va tarde.** Sola es una calculadora más; solo interesa
   cuando detrás se ve la plataforma (ranking, historial, perfiles) a la que se
   conecta.

### Repositorios

**Público, Edición 1: este mismo repo.** No se parte de cero, porque este repo
ya es la Edición 1:

- **Historial:** commits y PRs que documentan cada decisión (la mesa 3D, la
  integración de Mortal). Empezar de cero pierde esa trazabilidad.
- **Infraestructura:** el despliegue en Vercel, la base Redis y la
  configuración ya están conectados aquí.
- **Licencia en orden:** ya está bajo AGPL-3.0 y documenta de dónde viene cada
  pieza (`mortal/README.md`).
- **Está limpio:** el historial no tiene claves ni tokens filtrados. Lo único
  pesado es el modelo de Mortal (21 MB), y no es un problema.
- **El nombre** (`riichi-mahjong-aero`) se puede cambiar en GitHub sin perder
  nada; los enlaces viejos redirigen solos.

**Privado, Ediciones 2 y 3: repo nuevo, desde cero.**

- No puede ser un fork de GitHub: el fork de un repo público no puede ser
  privado.
- Se crea vacío y se copia **solo el núcleo**: reglas, motor, mesa 3D y
  animaciones. No entran `server/engine/mortal/` ni `bot.js` en su forma
  actual.
- Como el autor es dueño de ese código, puede usarlo cerrado allá aunque acá
  siga público bajo AGPL (ver la condición 1).
- **Por decidir al empezar la Edición 2:** cómo se sincroniza el núcleo entre
  los dos repos. Por ejemplo, el privado copia del público cada cierto tiempo,
  o el núcleo pasa a ser un paquete propio que importan ambos.

## Punto de partida: lo que ya existe

Varias ideas se montan sobre piezas que el repo ya tiene:

| Pieza | Dónde | Sirve para |
| --- | --- | --- |
| Escena 3D con three.js: salón, mesa, lámpara | `public/js/three3d/world.js`, `table3d.js` | A, E |
| Revuelto y reparto animados | `public/js/three3d/shuffle.js` | A |
| Palitos en la mesa (cajón, honba, riichi) | `public/js/three3d/sticks.js` | A (palitos arrojados) |
| Juego en línea: salas, timers, desconexión, bots | `server/handler.js`, `api/game.js` | C |
| Registro mjai de cada mano | `server/engine/mjai.js` | C (repeticiones, análisis), D |
| Cálculo de yaku y puntos | `server/engine/score.js`, `hand.js` | C (análisis de yaku), D (calculadora) |
| Bots normal (majiang-ai) y difícil (Mortal) | `server/engine/bot.js`, `mortal/` | Edición 1: rivales con personalidad (E), entrenamiento (D) |
| Garito fuera de la mesa: lobby, trastienda, menú | PR #17 | A, E |
| Laboratorio de animaciones y su grabación en video | `public/lab.html`, `scripts/lab-capture.mjs` | A (cámara de cine, ron con física), videos y tutoriales ([animaciones-ia.md](animaciones-ia.md)) |

El juego se publica bajo **AGPL-3.0** por Mortal (ver
[mortal/README.md](../mortal/README.md)). Eso importa para la edición liga y
para una eventual venta: ver [Riesgos](#riesgos-y-pendientes).

---

## A. Mundo, cámara y animaciones

### La idea

- Que el juego parta fuera del parlor o en la entrada, y la cámara entre al
  local, estilo *Tetsuya*.
- Más color, más movimiento y más detalle. Que no se vea "pegado" ni hecho con
  lo justo y necesario.
- Ir sumando escenarios y personajes con el tiempo.
- **Traspaso de puntos visible:** quien paga le arroja los palitos sobre la
  mesa al que se los quitó, en su dirección.
- **Mano rota tras el ron:** a quien le hicieron ron empuja su mano, pasa a
  llevar el muro de enfrente y las fichas se caen con física, como si tuvieran
  material y peso propios, como en los juegos *Tetsuya*. El ganador da vuelta
  su mano.

### Evaluación

- **La intro con cámara vale la pena y es barata.** Una toma de la calle o de
  la puerta, un dolly hacia adentro y luego a la mesa. Tiene que poder
  saltarse: a la tercera partida molesta.
- **Separar dos cámaras:**
  - *De juego*: estable y legible. No se mueve mientras se elige el descarte.
  - *De cine*: solo en momentos muertos o dramáticos: inicio de mano, riichi,
    ron o tsumo, traspaso de puntos.
- **El ron con la mano rota es la mejor idea de este bloque.** Le da
  personalidad al momento más importante del juego. Hay dos formas:
  1. **Física real puntual** (cannon-es o Rapier): se activa solo durante ese
     momento, con 30 a 50 fichas, y después la mesa vuelve a su estado. Se ve
     orgánico y distinto cada vez. **Recomendada**: pocos cuerpos durante
     pocos segundos no pesan nada.
  2. **Física falsa**: caída, rebote y giro aleatorio por código. Más
     controlable, pero se nota más repetida.
- **Sonido según el material:** un clack por impacto, con volumen según la
  velocidad del golpe. Hace la mitad del trabajo de que se sienta material.
- **Palitos arrojados:** con un arco, uno o dos rebotes, y que queden
  desordenados frente al ganador. Puede variar según el carácter de quien paga:
  con rabia o con resignación.
- **Aprovechar el revuelto automático.** El traspaso de puntos puede ir
  encima de la animación de la mesa revolviendo. Así se tapa el tiempo muerto
  entre manos y la partida no se alarga.
- **Vida ambiental, barata y efectiva:** humo de cigarro, la lámpara con un
  parpadeo leve, gente en otras mesas al fondo, un ventilador, sonido de
  ambiente.
- **Las mismas animaciones sirven para videos.** El laboratorio graba
  cualquier escena en video, así que la cámara de cine, la mano rota y los
  personajes sirven también para tutoriales, el tráiler y jugadas
  destacadas. Ver [animaciones-ia.md](animaciones-ia.md).
- **El riesgo es el ritmo.** Cada animación suma segundos por mano. Desde el
  principio tiene que haber una opción de velocidad (completa, rápida o sin
  animaciones) y todo se tiene que poder saltar con un clic. Ojo con el
  `introMs` del servidor: las animaciones tienen que calzar con los tiempos
  que impone el servidor.

---

## B. Personajes y avatares

### La idea

- Un modelo base de personaje común para todos.
- Ropa simple y formal: todos de terno, o ropa sencilla como en *Tetsuya*
  (polera y pantalón).
- Personalización simple: el color de cada parte del terno, líneas o rayas,
  peinados y diseños de cara.
- Gráfica tipo **PlayStation 1**.
- Nada disparatado ni sexualizado. Que mantenga la formalidad.
- Que tenga una sensación de hecho a mano, no de hecho con IA: diseñarlo en
  parte a mano y en parte adaptando estilos.
- El objetivo es que la gente tenga un avatar con el que identificarse.

### Evaluación

- **El estilo PS1 encaja con todo lo que se busca.** Es la forma más directa
  de que no parezca hecho con IA, porque es una estética de restricciones:
  pocos polígonos, texturas chicas (64×64 o 128×128) sin suavizado, vértices
  que tiemblan un poco, dithering y paleta limitada. Lo que delata a la IA
  suele ser el exceso de detalle liso y genérico. Con restricciones fuertes y
  aplicadas con consistencia, todo se siente de autor.
- **Arquitectura propuesta:**
  - **Un solo cuerpo base con un solo rig.** Todas las animaciones (sentarse,
    robar, descartar, declarar riichi, tirar palitos, romper la mano) sirven
    para todos los personajes. Es lo que hace viable tener muchos.
  - **Terno por zonas de color:** chaqueta, pantalón, camisa y corbata. Cada
    zona es una máscara en la textura y se tiñe desde el código. Las rayas o
    los cuadros son patrones superpuestos. Pocas piezas dan cientos de
    combinaciones.
  - **Caras como textura, igual que en la PS1.** Un dibujo pixel art de unos
    32×32 o 64×64 que se puede **dibujar a mano** (Aseprite o similar). Ahí
    entra la mano del autor de forma directa, y es lo que más identidad da. Se
    pueden separar ojos, cejas y boca para combinarlos y animarlos: pestañear,
    fruncir el ceño al perder.
  - **Peinados como mallas intercambiables.** Es la parte más trabajosa, pero
    en PS1 cada uno tiene entre 50 y 150 polígonos.
  - **Accesorios sobrios:** lentes, cigarro, reloj, sombrero.
  - **Siluetas:** dos o tres contenidas (delgado, ancho, mayor), sin
    exageraciones.
- **Prioridad: torso, cabeza y manos.** En la mesa casi nunca se ven las
  piernas. Las manos importan mucho: roban, descartan, empujan la mano y tiran
  los palitos.

### Plan de trabajo

1. **Biblia de arte** de una página: paleta, tamaño de texturas, presupuesto
   de polígonos y referencias (*Tetsuya*, juegos de PS1).
2. Prueba técnica: un cuerpo base y un shader PS1 en código, más dos o tres
   caras dibujadas a mano.
3. Validar el estilo **en la mesa real** antes de producir más.
4. Recién ahí, el editor de personaje y el catálogo de peinados.

---

## C. Edición liga, para Mahjong Chile

### La idea

- Una iteración distinta a la versión *Tetsuya*, moldeada para la comunidad
  **Mahjong Chile** y sus torneos.
- **Comentarista automático** con líneas predefinidas, como en *Sega Network
  Mahjong MJ*. Escribir las líneas a mano para probar cómo queda.
- Conexión con **Discord**.
- **Repeticiones y ángulos de cámara**, pensado para grabar y presentar.
- Presentación de puntos, estadísticas y **tarjetas de jugador**.
- **Modo comentarista:** agarrar la cámara, pausar y mostrar en la interfaz qué
  yaku tenía disponibles el jugador, qué habría pasado con otra jugada, y qué
  fichas venían en el muro.
- Cerrado para la liga y los torneos de la comunidad, sin necesidad de
  venderlo. "La app es nuestra": se le agrega lo que se quiera.
- Junto con los avatares: cada jugador tiene su cuenta con un personaje hecho a
  mano. Solo entra y juega, y ve sus estadísticas.

### Evaluación

**1. El mismo motor, no un juego aparte.** Un juego con dos caras: la versión
*Tetsuya* (mundo, historia, ambiente) y la versión liga (torneo, transmisión,
cuentas). Comparten las reglas, la mesa 3D, las animaciones (A) y los avatares
(B). Separarlo en dos repos obliga a mantener todo dos veces.

**2. La base es el registro de partida, y ya existe.** El motor guarda el
registro mjai de cada mano. Si además se guarda la semilla del muro y se
persisten las partidas completas, salen casi gratis:

- las repeticiones,
- la cámara libre en la repetición,
- "en el muro le venía esto": como el muro se conoce, se muestra qué habría
  robado,
- el "qué habría pasado si…",
- las estadísticas por jugador.

**3. Análisis de yaku en modo comentarista.**

- Se pausa una mano y se muestran los yaku a los que podía apuntar. Por
  ejemplo: "podía ir a honitsu, a toitoi o quedarse en riichi pinfu".
- Para cada camino: qué fichas faltaban, cuántas quedaban vivas y cuánto valía
  (han, fu y puntos).
- Con el muro conocido, el caso real: "si se iba por honitsu, en dos robos le
  llegaba esto y cerraba un mangan".
- No necesita IA: es combinatoria sobre el cálculo de yaku que ya hace
  `score.js`.
- **Recomendación de IA:** lo que recomendaba la IA y con qué confianza, y los
  errores grandes de una mano. La Edición 2 no lleva Mortal, así que esto
  queda para cuando existan los bots propios.

**4. Comentarista automático con líneas predefinidas.**

- Funciona por **eventos**: riichi, riichi persecutorio, dora, ippatsu, mano
  grande, tenpai en el último robo, remontada del último lugar, una mano que se
  acerca a un yaku vistoso ("¡ojo, que va armando honitsu!").
- Cada evento tiene varias líneas. El sistema rota para no repetir y usa
  prioridades para que dos frases no se pisen.
- Las líneas van en un archivo simple (planilla o JSON) que se edita sin tocar
  código.
- El potencial grande: jerga chilena y, más adelante, **voces grabadas por
  gente de la comunidad**.

**5. Discord:**

- iniciar sesión con la cuenta de Discord, sin crear usuarios aparte,
- un bot que publica resultados, tablas y próximas fechas,
- inscripción a torneos.

**6. Modo transmisión y modo comentarista:**

- vista de director con todas las manos, separada de la vista del jugador,
- gráficas listas para OBS: marcador, tarjetas de jugador, tabla del torneo y
  rótulos,
- **retraso obligatorio** en la vista con manos abiertas cuando es en vivo.
  Si no, un jugador mira el stream y ve las manos rivales.

**7. Cuentas con avatar hecho a mano.** Como la comunidad es cerrada (decenas
de jugadores, no miles), es realista hacer cada personaje a mano. Es lo que
hace que la gente se apropie del juego.

**8. Reglas WRC, sin concesiones.** La intención de la liga A de Mahjong Chile
es usar las reglas WRC actualizadas tal cual, tanto en el juego como en el
cálculo de puntajes. Si hoy se aparta en algo, es solo porque Mahjong Soul no
permite configurar ciertas reglas. Un juego propio elimina esa limitación, y es
un argumento fuerte a favor de la Edición 2: **la primera plataforma donde la
liga juega exactamente con su reglamento**.

El motor hoy usa reglas tipo Tenhou (tonpuusen, 3 aka dora, uma
+20/+10/−10/−20). Hay que agregar el set WRC y revisar el reglamento punto por
punto contra el motor: duración, puntos iniciales, uma y oka, dora rojas, yaku,
empates y pagos. El objetivo es la fidelidad total al reglamento, verificada
con pruebas que reproduzcan sus ejemplos. Que las reglas sean configurables
también sirve para otros torneos y para la Edición 3.

---

## D. Ecosistema: servicios complementarios

### La idea

- Ir sumando servicios, aplicaciones, jueguitos o secciones paralelas al
  juego, aprovechando la IA.
- Que también sirva en **partidas presenciales**: abrirla en el navegador
  durante una partida real para llevar los puntajes y calcular cuánto valió
  una mano.
- Al terminar, registrar los puntajes y subirlos directo a la plataforma, para
  que una partida presencial cuente como oficial en la misma liga que el
  online.
- Una **liga híbrida**: partidas en la vida real y en el videojuego, todo en el
  mismo lugar.

### Evaluación

**1. Una sola plataforma con módulos, no apps sueltas.** Una cuenta (la de
Discord), un ranking y un historial de partidas. El juego online, la app de
mesa presencial, el comentarista y cualquier módulo nuevo se conectan a eso.
Si cada cosa nace por su lado, en seis meses hay diez herramientas que no se
hablan.

**2. La app de mesa presencial va tarde, al final de la Edición 2.** Sola es
una calculadora más, y ya existen varias. Su valor es que la partida presencial
quede en el mismo ranking, historial y estadísticas que el online, así que solo
interesa cuando la gente ya usa la plataforma y le importa su perfil. Entonces
se presenta como "registra tu partida presencial y que cuente en tu ranking".
La lógica que necesita (puntaje, yaku y registro) se construye igual para la
plataforma, así que en ese momento es casi solo interfaz. Tendría tres partes:

- **Marcador de mesa:** puntos de los cuatro jugadores, quién es dealer,
  honba, riichi depositados y cambio de viento.
- **Calculadora de mano:** se eligen las fichas y la app calcula yaku, han, fu
  y puntos, y aplica el pago automáticamente. Más adelante, **reconocer las
  fichas desde una foto**: justo donde la IA aporta.
- **Cierre de partida:** se registra el resultado y **los cuatro jugadores lo
  confirman** desde su teléfono. Ese visto bueno permite que cuente como
  oficial sin que un organizador revise todo.

Si registra mano por mano, una partida presencial queda con un historial casi
tan rico como una online: estadísticas e incluso repetición en la mesa 3D.

**3. Reutilización.** El cálculo de yaku y puntos y las reglas configurables
son los mismos de C. La calculadora presencial y el análisis del comentarista
usan el mismo código.

**4. Otros módulos posibles:**

- **Entrenamiento:** ejercicios de "¿qué descartas?" corregidos por una IA
  (Mortal en la Edición 1, los bots propios después), práctica de eficiencia y
  de cálculo de puntos.
- **Para principiantes:** aprender los yaku jugando, la guía de reglas de la
  liga, partidas contra bots con pistas.
- **Gestión de torneos:** inscripción, sorteo de mesas por ronda, tabla en
  vivo y resultados publicados en Discord.
- **Revisión de partidas:** subir una partida y que la IA marque los momentos
  clave (la idea de mjai-reviewer, ver
  [ia-investigacion.md](ia-investigacion.md)).

**5. El riesgo es dispersarse.** Como desarrollar es rápido, es fácil empezar
diez cosas y no terminar ninguna. Regla: cada módulo nuevo se conecta a la
plataforma común y es útil por sí solo antes de pasar al siguiente.

---

## E. Mundo navegable y modo historia

### La idea

- Un **mundo navegable**: entrar al parlor, caminar y hacer cosas. Casi ningún
  juego de mahjong lo tiene.
- **Ambientación en Chile**, en un Chile inventado con un barrio o sector
  donde se juega mahjong. Afuera nadie va a saber si es real.
- **La comunidad dentro del juego:** sacar fotos del local donde nos juntamos
  y hacerlo parte del juego. Que en el juego levantes la vista de la mesa y te
  des cuenta de que estás en el local donde juegas siempre.
- **Escenarios de homenaje:** un salón de torneo como en *Saki*, los parlors
  de *Tetsuya*.
- **Una oda al mahjong tal como se conoce fuera de Japón:** anime, juegos y
  cultura online.
- **Modo historia con progresión:** partir en parlors de barrio, moverse a la
  ciudad, entrar a torneos o a una liga y llegar a profesional.
- **Reglas e IA que cambian** según el escenario y la etapa de la historia.
- Todo interconectado. Un juego grande y completo, donde por donde te metas
  haya para jugar una tarde. Quizás venderlo en una versión definitiva.

### Evaluación

**1. Es un diferenciador real.** Hay juegos de mahjong con historia, sobre todo
japoneses, pero un mundo para recorrer con ambientación propia y una comunidad
real adentro no es algo que se conozca. Le da sentido a lo demás: avatares,
animaciones y liga pasan a vivir en un lugar.

**2. Zonas, no mundo abierto.** Un mundo abierto continuo es lo más caro de
toda la lista. La propuesta es **zonas recorribles conectadas por un mapa**,
estilo *Yakuza* o *Persona* en chico: una calle, el parlor del barrio, la
trastienda, el salón de torneo. Cada zona es chica, densa y con cosas que
hacer, y el mapa de la ciudad las une. Se siente grande sin serlo.

**3. El estilo PS1 (B) lo hace posible.** Con pocos polígonos y texturas
chicas, una zona nueva cuesta poco. Las **fotos del local** se reducen a
texturas de baja resolución y quedan reconocibles pero integradas al estilo.

**4. El Chile inventado es una gran idea.** Un barrio que mezcla lo real con lo
ficticio, como si Santiago o Valparaíso tuvieran un sector del mahjong. Es
original y le da una identidad que un estudio japonés no puede copiar.

**5. Reglas e IA por escenario, profundidad sin costo artístico:**

- Reglas distintas por etapa: reglas viejas sin aka dora en el garito, reglas
  de torneo en el salón, las de la liga chilena en el modo profesional.
- **Rivales con personalidad:** ajustar el estilo de los bots (agresivo,
  defensivo, que persigue manos caras). Cada personaje juega distinto, no solo
  se ve distinto. Se puede probar en la Edición 1 con majiang-ai y Mortal; en
  la Edición 3 son los bots propios.

**6. La comunidad dentro de la historia.** Los jugadores reales de Mahjong
Chile, con sus avatares (B), pueden aparecer como personajes: rivales o caras
del parlor. Eso conecta B, C y E.

**7. Cómo empezarlo: un corte vertical.** Una calle, el parlor y una mesa, con
una historia corta de tres o cuatro partidas, la intro de cámara (A) y dos o
tres personajes (B). Si eso se siente bien, el resto escala.

---

## Bots propios

Para la Edición 3 los bots se entrenan desde cero, sin código ni pesos de
Mortal. Es lo más lento de todo el plan (datos y cómputo), así que conviene
empezar en paralelo desde la Edición 1:

- **Datos propios.** Las partidas de las Ediciones 1 y 2 ya quedan registradas
  en formato mjai. Las de la liga son personas jugando con reglas WRC: el
  material ideal. Hay que avisar en los términos de uso que las partidas se
  usan para entrenar.
- **Etapas.** Primero imitar partidas humanas (aprendizaje supervisado), luego
  mejorar jugando contra sí mismos (aprendizaje por refuerzo).
- **Trabajo limpio.** Un repo aparte. Las ideas de Mortal y de la
  [investigación](ia-investigacion.md) se pueden aprovechar; el código y los
  pesos, no.
- **Uso intermedio.** Cuando sean decentes, pueden darle a la Edición 2 la
  recomendación de IA del modo comentarista, y reemplazar a Mortal en los
  ejercicios de entrenamiento.

## Hoja de ruta por edición

Las tres ediciones comparten una **plataforma común** (cuentas, partidas,
ranking), un **motor compartido** y el **estilo PS1**.

**Edición 1: *Tetsuya*** (pública, AGPL)

1. **Separar el núcleo** de Mortal y dejar la regla por escrito: nada del
   núcleo depende de `server/engine/mortal/`.
2. **Animaciones de vida:** ron con física, palitos arrojados, intro de cámara,
   vida ambiental y opción de velocidad. *(A)*
3. **Estilo PS1:** biblia de arte y prueba técnica en la mesa real. *(B)*
4. **Personajes fijos** con cara, ropa y estilo de juego propios. *(B, E)*
5. **El edificio del parlor:** calle, salón y trastienda recorribles. *(E)*
6. **Persistir partidas completas** (registro mjai más semilla) y
   **repeticiones**. *(C)*

**En paralelo desde la Edición 1:** recolección de partidas y primeros
experimentos de [bots propios](#bots-propios).

**Edición 2: Liga** (cerrada, sin bots)

1. **Reglas WRC** configurables. *(C)*
2. **Cuentas con Discord**, historial y **ranking**. *(C)*
3. **Avatares personalizados**: el editor y los avatares hechos a mano para
   cada jugador. *(B)*
4. **Perfiles con estadísticas** y tarjetas de jugador. *(C)*
5. **Modo comentarista:** cámara libre, repeticiones y análisis de yaku. *(C)*
6. **Comentarista automático** con líneas propias. *(C)*
7. **Gráficas de transmisión** y modo director con retraso. *(C)*
8. **Gestión de torneos** y bot de Discord. *(C, D)*
9. **App de mesa presencial**, cuando la plataforma ya tenga uso. *(D)*

**Edición 3: Definitiva** (cerrada)

1. **Bots propios** en el juego, con personalidades por personaje.
2. **Corte vertical del modo historia:** una calle, el parlor y una mesa, con
   una historia corta. *(E)*
3. Si funciona: la ciudad, los ambientes distintos, reglas por escenario y la
   comunidad dentro de la historia. *(E)*

## Riesgos y pendientes

- **Alcance.** Es mucho. La regla de D aplica a todo: terminar cada pieza y
  conectarla antes de empezar la siguiente.
- **Ritmo de partida.** Cada animación suma segundos. Opción de velocidad desde
  el primer día.
- **Licencias entre ediciones.** La Edición 1 es AGPL por Mortal. Las
  Ediciones 2 y 3 pueden ser cerradas siempre que no incluyan código de Mortal
  ni código de terceros aportado bajo AGPL. Mantener el núcleo separado y, si
  entran colaboradores, que acepten que su código se use en las versiones
  cerradas. Si la Edición 3 se vende, confirmarlo con alguien que sepa de
  licencias, incluido el estatus del código escrito con IA, que no está del
  todo resuelto.
- **Tres productos a mantener.** El núcleo compartido evita duplicar trabajo,
  pero el código que entre al repo privado no puede venir de Mortal ni de
  aportes de terceros bajo AGPL (ver [Repositorios](#repositorios)).
- **Homenaje sí, copia no.** Inspirarse en el ambiente de *Saki*, *Tetsuya* o
  *Sega Network Mahjong MJ*, sin usar nombres, personajes, logos ni escenas
  reconocibles de esas obras.
- **Permisos.** El dueño del local tiene que autorizar que se use su espacio, y
  cada persona de la comunidad tiene que aceptar aparecer como personaje.
- **Datos de entrenamiento.** Avisar que las partidas se usan para entrenar
  los bots.
- **Transmisión en vivo.** La vista con manos abiertas necesita retraso para no
  filtrar información a los jugadores.
- **Partidas oficiales presenciales.** La confirmación de los cuatro jugadores
  es el mínimo. Hay que definir qué pasa con las disputas.

## Decisiones tomadas

- **Referencia de la mano rota tras el ron:** los juegos *Tetsuya*.
- **Reglas de la Edición 2:** las WRC actualizadas, idénticas en el juego y
  en el cálculo de puntajes. Las diferencias actuales de la liga A solo vienen
  de las limitaciones de configuración de Mahjong Soul.
- **Edición 2:** código cerrado y sin bots.
- **Edición 3:** bots propios entrenados desde cero.
- **App de mesa:** al final de la Edición 2, no antes.
- **Repositorios:** este repo sigue como el público de la Edición 1; las
  ediciones cerradas van en un repo privado nuevo con el núcleo copiado.

## Preguntas abiertas

- ¿Cómo se sincroniza el núcleo entre el repo público y el privado? (Se decide
  al empezar la Edición 2.)
