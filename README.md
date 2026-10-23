# Riichi Mahjong

Riichi mahjong para 4 jugadores en el navegador, con reglas tipo **partida
ranked de Tenhou**, jugado en 3D en un salón de mahjong clásico al estilo de
los juegos *Tetsuya*. Las reglas, la pared y el reparto de puntos los maneja el
servidor. Es una prueba de concepto comunitaria y sin fines de lucro.

- Sin build ni dependencias: HTML, CSS y JS (módulos ES) servidos estáticos.
- El servidor es **una sola función de Vercel** (`api/game.js`) que guarda el
  estado de cada sala en **Upstash Redis**.
- Funciona en cualquier navegador moderno (escritorio y móvil).

## Reglas implementadas

| | |
| --- | --- |
| Duración | Tonpuusen (東風戦). Si nadie llega a 30.000 al final de 東4, se juega 南 a muerte súbita (termina apenas alguien tenga ≥30.000; como máximo hasta 南4). |
| Puntos | 25.000 iniciales, 30.000 de retorno, uma +20/+10/−10/−20, oka +20 al 1º. Los depósitos de riichi que queden en mesa van al 1º. Empates por orden de asiento inicial. |
| Fin anticipado | Bancarrota (<0). Agari-yame / tenpai-yame automático del oya en el último kyoku si va 1º y tiene ≥30.000. |
| Yaku | Todos los estándar más yakuman (kokushi, suuankou, daisangen, shou/daisuushii, tsuuiisou, chinroutou, ryuuiisou, chuuren, suukantsu, tenhou, chiihou). Kuitan permitido. Kazoe yakuman con 13 han. Sin doble yakuman (sí se suman yakuman distintos). Sin kiriage mangan. |
| Dora | Dora, kan-dora (ankan al momento; minkan/kakan tras el descarte), ura-dora con riichi, **3 akadora** (un 5 rojo por palo). |
| Llamadas | Chi, pon, minkan, ankan, kakan; prioridad ron > pon/kan > chi. Kuikae prohibido. Chankan (y kokushi puede robar un ankan). Riichi solo permite ankan si no cambia las esperas. |
| Furiten | Permanente por descarte propio, temporal al dejar pasar la ficha ganadora, y de riichi. Se muestra en pantalla. |
| Empates | Ryuukyoku con pago por tenpai (3.000), nagashi mangan, kyuushu kyuuhai, suufon renda, suucha riichi, suukaikan y sanchahou (triple ron). Doble ron permitido. |
| Pao | Daisangen y daisuushii. |
| Tiempo | 5 s por acción + 10 s de reserva por mano. Al acabarse: tsumogiri / pasar. Un jugador desconectado juega en automático (1,5 s por acción). Tras riichi el tsumogiri es automático. |

## Cómo se juega

1. En el menú principal (**Elige cómo jugar**) elige el modo, escribe tu
   nombre y un código de sala (por defecto `publica`) y pulsa **Entrar a la
   sala**. Cada sala queda con el modo de quien la abrió; para entrar hay que
   elegir ese mismo modo.
   - **Clásico** (ranked individual, el modo original): la partida empieza
     sola al llegar a 4 jugadores, con asientos al azar.
   - **Por equipos** (2 contra 2): en la sala de espera (máximo 4) eliges
     **Norte** o **Sur** (2 por equipo), marcas **Estoy listo** (cambiar de
     equipo lo quita) y el **anfitrión** (el primero que entró; si se va, el
     siguiente) pulsa **Comenzar** cuando hay 2 + 2 y los 4 están listos. Los
     compañeros se sientan uno al lado del otro (se sortea qué equipo empieza
     de Este y el orden dentro de cada equipo). Ver
     [Juego por equipos](#juego-por-equipos).
   - **Práctica**: contra bots, sin código de sala; con **Con Bot 1 de
     compañero** se juega por equipos. Ver [Práctica](#práctica-contra-bots).
2. Para descartar, un clic levanta la ficha y otro clic sobre ella la
   descarta (un clic en otra ficha levanta esa; fuera de la mano, la baja).
   En el menú, **Descartar con un solo clic** descarta al primer clic.
   **Arrastrar**: una ficha se puede tomar (clic sostenido) y llevar con el
   mouse (sin salir de la pantalla). Soltada dentro de la mano, se encaja
   donde la dejaste; soltada arriba, sobre la mesa, se descarta (si es tu
   turno). Con **Auto ordenar** (la "A" de la barra lateral, encendida por
   defecto) la ficha se acerca a la mano donde la soltaste y luego vuelve a
   su lugar en el orden; apagado, la mano queda como la acomodes (lo que
   robas entra por la derecha). Los botones (Riichi, Tsumo, Ron, Pon,
   Chi, Kan, Pasar) aparecen sobre tu mano cuando aplican.
3. **Menú** (botón ☰ arriba a la izquierda, siempre visible):
   - **Descartar con un solo clic** (queda guardado en el navegador).
   - **Reglas del salón** y **Pantalla completa**.
   - **Abandonar partida**: tu asiento sigue en automático (tsumogiri) hasta
     el final y los demás lo ven como "(abandonó)". Puedes volver uniéndote
     otra vez a la misma sala. Contra bots, abandonar termina la partida; si
     todos los humanos abandonan, la sala se libera.
4. **Barra lateral** (al centro del borde izquierdo, como en Mahjong Soul):
   cerrada muestra solo letras, que ya funcionan con un clic (en rojo cuando
   están activas); la flecha de su borde derecho la despliega con los
   nombres.
   - **A · Auto ordenar** (arriba, encendida por defecto y recordada en el
     navegador): ver arriba.
   - **R · Auto ron**: declara ron o tsumo apenas se puede.
   - **C · Saltar llamadas**: pasa los chi, pon y kan sobre los descartes de
     los rivales. Tu propio kan, riichi o tsumo no se tocan, y el ron se sigue
     ofreciendo.
   - **D · Auto descarte**: descarta cada ficha que robas (sin R, un tsumo
     posible se deja para que decidas).
   R, C y D duran la partida; los tres juntos juegan como en riichi.
5. Si recargas la página o se corta la conexión, vuelves a tu asiento (la
   sesión se guarda en el navegador).

## Muro y robos

- El muro son 4 lados de 17 pilas de 2 fichas en molinete. Al empezar cada
  mano se tiran dos dados: la suma elige el muro (contando al oya como 1, en
  sentido antihorario) y cuántas pilas contar desde su extremo derecho para
  el corte. Desde el corte se roba en sentido horario; las 7 pilas al otro
  lado son el muro muerto, con el indicador de dora boca arriba en la tercera
  pila y las fichas de rinshan en la pila junto al corte.
- El servidor solo envía qué huecos están vacíos y de dónde salió el último
  robo, nunca qué ficha hay en cada posición.

## Ambientación: salón Tetsuya

Inspirada en los juegos de *Tetsuya*: habitación oscura, mesa amplia (30
fichas de lado, con bastante paño libre entre los descartes y los muros, como
en esos juegos) de madera sin
barnizar (mate, con vetas y el marco cortado en diagonal en las esquinas,
como un marco de cuadro) y tapete verde gastado bajo una sola lámpara cálida
y débil cuya luz se apaga hacia los bordes, con sillas en penumbra, y fichas
de reverso amarillo envejecido. Colores y brillos van más bien apagados,
también el papel de la interfaz. La mesa no tiene placa central: los dados quedan
toda la mano sobre el tapete a la derecha del oya (quien los tiene de su lado
reparte).

La interfaz se diseñó en Claude Design y se pasó al juego con estos
materiales:

- **Papel** viejo para botones, la ficha de la ronda, el menú, las reglas y la
  hoja final; el botón principal de cada caja lleva un borde rojo, como un
  sello.
- **Tablillas de madera** con nombre, viento y puntos de cada jugador.
- **Cajas azul marino** (estilo menú de PS2) en el lobby y la sala de espera.
- Letras: **Kaushan Script** (títulos y botones) y **Caveat Brush** (hojas y
  tablillas) con trazo de pincel; los avisos grandes (¡Pon!, ¡Ron!, Mangan…)
  en **Shippori Mincho B1** gruesa con un halo de luz detrás, no un contorno;
  el resto en **Zen Kaku Gothic New**. Todas de Google Fonts.
- Todo el texto está en español; el japonés va solo de acento, chico y al
  lado (ポン bajo "Pon", 満貫 detrás de "Mangan").

Pantallas:

- **Lobby** (pared verde oliva): título "Salón Mahjong", la caja **Elige cómo
  jugar** con los tres modos, tu nombre y la sala, y la hoja **Reglas de la
  casa** pegada a la pared. **Reglas del salón** abre las reglas completas.
- **Sala de espera**: la mesa dibujada desde arriba con los cuatro asientos
  (en el modo por equipos, Norte abajo y a la derecha, Sur arriba y a la
  izquierda) y la caja para elegir equipo, marcar listo y comenzar.
- **En partida**: una franja oscura arriba con un marco por rival (izquierda =
  kamicha, centro = toimen, derecha = shimocha) que tapa su silla, con la
  tablilla de nombre debajo (riichi, compañero, desconectado, su turno). Aún
  no hay retratos: cada marco muestra una silueta. Con la cámara en la mesa
  entera (cursor en la mitad superior) la franja se pliega hacia arriba y
  quedan solo las tablillas. Debajo del marco izquierdo, el botón de menú y la
  ficha de papel con la ronda, honba, depósitos, fichas que quedan y tus
  puntos. Estos dos no se mueven cuando la franja se pliega, así el menú
  no se escapa al ir a hacerle clic. Abajo a la izquierda **Puntos** y el reloj; a la derecha los
  botones de llamada (Ron y Tsumo con un sello 和).
- **Resultado de la mano**: una hoja oscura cubre la parte de arriba con la
  ronda y el ganador, han, fu, los puntos, el nombre del límite en grande con
  sus kanji tenues detrás (Mangan 満貫, Haneman 跳満, Baiman 倍満, Sanbaiman
  三倍満, Yakuman 役満) cruzado por un trazo de luz, y los yaku escritos a
  mano. Debajo, la cámara enfoca desde atrás del ganador su mano tumbada, sus
  fichas llamadas (que se corren a la misma línea de la mano) y la fila de
  dora y ura dora, alejándose lo necesario para que todo quepa a lo ancho. Al pie, una tablilla por jugador con su puntaje y
  lo que ganó o perdió, y **Aceptar**. Los empates usan la misma hoja
  ("Empate" y quién quedó en tenpai), con la mesa entera de fondo.
- **Fin de la partida**: la hoja de papel **Resultados** con puesto, puntos y
  resultado (y la suma de cada equipo), un sello rojo "Gana" y **Volver al
  lobby**.

La ambientación Frutiger Aero y la vista 2.5D se quitaron; siguen en el
historial del repositorio (último commit con ambas: `b9c1116`).

## Vista 3D

Hecha con [three.js](https://threejs.org) (0.170, MIT, incluido en
`public/vendor/three/`, sin build). three.js se descarga al empezar la
primera partida.

- Pantalla completa en cualquier proporción (16:9, ultrawide, móvil vertical).
- **Fichas estilo PS2**: cada ficha es una sola caja casi recta (sin piezas
  redondeadas separadas, así no hay escalón entre el frente y el reverso). El
  canto usa colores por vértice (marfil hacia la cara y una franja del color
  del reverso atrás) y el bisel está pintado en las texturas, como se hacía en
  PS2. Iluminación Phong mate, sin reflejos de entorno. Cada cara lleva una
  línea oscura fina en el borde y entre fichas vecinas queda siempre un poco
  de aire (muros, manos, descartes, llamadas y tu mano), así nunca se ven
  fundidas en un solo bloque.
- Muros en molinete, descartes, llamadas y dora en el muro muerto. Cada ficha
  viaja a su lugar, así robos, descartes y llamadas se animan solos.
- **Movimientos firmes**: las fichas se mueven a velocidad constante por
  tramos rectos, sin aceleraciones. Una ficha que cambia de lugar o se da
  vuelta primero sube por encima de todo lo que hay en la mesa (muros
  incluidos), cruza a esa altura y baja derecho. Si termina acostada, gira
  mientras sube (un descarte ya va acostado boca arriba, o de lado si es de
  riichi, antes de llegar a los descartes); si termina parada, gira mientras
  baja (un robo solo se para al llegar a la mano). Tu mano 3D y el palito de
  riichi también se mueven a velocidad constante. Robar y descartar son casi
  inmediatos (un descarte tarda una décima de segundo); llamadas, dora y el
  resto van a la mitad de esa velocidad. **Las jugadas no se pisan**: el robo
  del siguiente jugador espera a que termine de caer el descarte anterior, y
  lo mismo las llamadas y el palito de riichi, aunque lleguen varias jugadas
  en la misma actualización del servidor.
- **Sombras**: mapa de sombras ajustado a la mesa sin desplazamiento por
  normal (evita sombras despegadas), placa central opaca para que reciba
  sombras, y sombras de contacto suaves bajo cada ficha apoyada (estilo PS2),
  que se desvanecen cuando la ficha se levanta.
- Como en el 3D de Tenhou, **tu mano no está sobre la mesa**: son fichas 3D en
  una escena superpuesta con cámara ortográfica, de frente a ti al pie de la
  pantalla, levemente inclinadas para que se vea el canto superior, y con el
  tamaño ajustado al ancho y alto de la pantalla. La mano siempre deja libre
  el lugar de la ficha robada, así no se corre cada vez que robas. La ficha
  robada vuela desde su hueco del muro hasta ese lugar. Al descartar de la
  mano (tedashi), la ficha robada sube, pasa por encima de las demás y baja a
  su lugar mientras las otras le hacen espacio, como en Tetsuya; durante el reparto la mano se llena a medida
  que llegan tus fichas.
- **Cámara de jugador y mesa completa:** por defecto la cámara está baja,
  cerca de tu lado (estilo Tetsuya). Con el mouse en la mitad superior de la
  pantalla, o tocándola en el móvil, sube y muestra la mesa entera; en la
  mitad inferior vuelve. En pantallas verticales siempre se ve la mesa entera.
- **Cajón de puntos**: el botón **Puntos** (siempre a la izquierda, justo
  encima de tu mano, como los botones de llamada a la derecha) hace que la
  cámara mire hacia
  tu borde de la mesa, de donde sale un cajón con tus palitos de puntos (de
  10000, 5000, 1000 y 100, repartidos como en una bandeja real: 25000 son
  1 + 2 + 4 + 10). Los palitos son los de un juego japonés tradicional,
  blancos con puntos pintados: 100 = ocho puntos negros en dos filas; 1000 =
  un punto rojo (el palito de riichi); 5000 = un punto rojo grande con cuatro
  chicos en cuadro; 10000 = lo mismo, más un punto rojo chico a cada lado y
  uno negro grande hacia cada extremo. Encima del cajón aparece tu tablilla
  con tu puntaje y alrededor las de los demás en su posición (izquierda =
  kamicha, arriba = toimen, derecha = shimocha), con la diferencia con el
  tuyo. Un toque lo cierra.
- Botones, menú, resultados y el panel del compañero son HTML encima del
  canvas.

### Animaciones de riichi y de victoria (3D)

- **Riichi**: aviso grande "¡Riichi!" (リーチ debajo); la ficha sale de la mano, se acuesta de
  lado mientras sube y cae así en los descartes. Si nadie hace ron sobre ella
  (el servidor recién entonces marca el riichi), un palito de 1000 puntos en
  3D entra girando y se acomoda en el tapete frente al jugador.
- **Victoria**: aviso grande "¡Tsumo!"/"¡Ron!"; la mano del ganador queda
  parada sobre la mesa (la mano oculta de un rival se convierte en ella; la
  tuya, que no está en la mesa, se apoya ficha por ficha), espera un instante
  y las fichas caen boca arriba una tras otra, cada una girando sobre su
  canto trasero, así ninguna atraviesa la mesa. En un ron, la ficha ganadora
  vuela desde los descartes hasta su lugar, separada y brillando. La cámara
  muestra la mesa entera. Luego, justo delante de esa mano, se arma
  una fila con cartel **Dora**: los indicadores de dora vuelan desde el muro
  muerto hasta ella; con riichi sigue el cartel **Ura** y los ura dora salen
  de debajo de los indicadores, se voltean en el aire y se ponen al lado. Las
  fichas de la mano que valen dora se iluminan (dorado: dora y cincos rojos;
  rosado: ura dora) y un cartel cuenta dora, ura y rojas. Después la cámara
  baja detrás del ganador a su mano y se abre la hoja de resultado.
- **Empate por agotamiento**: todas las manos quedan paradas sobre la mesa y
  luego se tumban a la vez, ficha por ficha: las que están en tenpai boca arriba con el cartel **Tenpai**, y
  las noten boca abajo con **Noten**; las fichas llamadas se quedan donde
  estaban, así no chocan en las esquinas con la mano del vecino. Después se
  abre la pantalla de resultado. Los empates abortivos van directo al
  resultado.

### Animación de inicio de cada mano

Al empezar cada mano el servidor pausa los relojes y los bots durante
`INTRO_SECONDS` (7 s por defecto; 0 la desactiva) y la mesa reproduce, con
las 136 fichas y la mesa vista entera:

1. **Revolver**: las fichas boca abajo caen amontonadas al centro y dos
   "manos" las revuelven por toda la mesa siguiendo recorridos irregulares,
   arrastrándolas y empujándolas, con un remolino suelto cuyo centro también
   se mueve: nunca giran como un disco ordenado. Es una pequeña simulación
   física (`public/js/three3d/shuffle.js`): cada ficha conserva su impulso y
   frena con el roce del paño, chocan entre sí y rebotan (y se ponen a
   girar), y rebotan contra el borde de la mesa; una esquina puede montarse
   un momento sobre la vecina, como pasa de verdad, pero nunca se atraviesan.
   Al final se juntan y se enderezan para dejar lugar a los muros.
2. **Armar los muros**: cada ficha sube de la pila, cruza por encima de las
   demás y baja a las cuatro filas de pilas de dos, un poco hacia afuera,
   primero la de abajo y encima la de arriba, y las filas se empujan a su
   lugar.
3. **Tirar los dados**: el oya lanza los dos dados desde su lado hacia el
   centro de la mesa, cada mano en otra dirección; ruedan, rebotan y se
   detienen donde caen, en cualquier ángulo, mostrando la tirada real, que
   decide el corte del muro. Luego se levantan y se acomodan a la derecha del
   oya, juntos y alineados, donde se quedan toda la mano.
4. **Repartir**: desde el corte, en bloques de 4 (tres vueltas), luego 1 cada
   uno y el primer robo del oya; cada bloque se levanta por encima de los
   muros (los que vuelan a la vez, a distinta altura) antes de ir a la mano, y
   tu mano se llena a medida que llegan tus fichas. Al final se voltea el
   indicador de dora.

Quien se conecta a mitad de la pausa ve la animación acortada.

La mesa 3D dibuja la "vista" que envía el servidor (`public/js/three3d/`).

## Juego por equipos

Solo en el modo **Por equipos**:


- Cada jugador ve la **mano de su compañero** en un panel: acoplado al lado
  de la pantalla donde se sienta el compañero si hay espacio, o como franja
  desplegable arriba en pantallas angostas. Se
  puede plegar con su botón.
- **Pedir descarte**: clic en una ficha del compañero. A él se le resalta en
  naranja en su mano con el aviso "X te pide ▢". Es una sugerencia, no
  obliga; otro clic la cancela y caduca cuando la ficha sale de su mano o
  termina la mano.
- El servidor solo envía la mano del compañero (nunca la de los rivales), y
  las peticiones solo las ve el equipo.
- Los puntos y el uma siguen siendo individuales; al final se suma el
  resultado de cada equipo y gana el que tenga más.

## Práctica (contra bots)

En el menú principal, el modo **Práctica** con **Empezar práctica** crea una
sala privada (`bots-…`) y empieza al instante: tú contra 3 bots o, con **Con
Bot 1 de compañero**, tú y **Bot 1** (Equipo Norte) contra Bot 2 y Bot 3 por
equipos. Los bots:

- descartan siempre la ficha que acaban de robar (tras una llamada, la última
  ficha legal de la mano);
- hacen pon o chi siempre que pueden;
- nunca declaran ron, tsumo, riichi ni kan;
- en el modo por equipos, tu compañero bot descarta la ficha que le pidas (en
  su turno, si es legal).

Sirve para probar la interfaz y las reglas sin juntar a 4 personas. Cualquier
sala cuyo código empiece por `bots-` funciona así.

## Desplegar en Vercel

1. Importa este repositorio en Vercel (*Add New → Project*). No necesita
   configurar nada: `vercel.json` sirve `public/` y la función `api/game.js`.
2. En el proyecto: *Storage → Create Database →* **Upstash for Redis** (plan
   gratuito) y conéctala al proyecto. Eso crea las variables
   `KV_REST_API_URL` y `KV_REST_API_TOKEN` (también se aceptan
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
   Si al conectar eliges un prefijo (p. ej. `STORAGE`), también sirve:
   se aceptan las variables con cualquier prefijo.
3. Vuelve a desplegar (*Deployments → Redeploy*) para que la función tome las
   variables.
4. Abre `https://<tu-proyecto>.vercel.app/api/health`: debe responder
   `"store": "upstash"` y `"ok": true`.

Sin Redis la función usa memoria, que **no funciona** en Vercel (cada
invocación puede caer en una instancia distinta): Redis es obligatorio en
producción.

Variables opcionales: `TURN_SECONDS` (5), `BANK_SECONDS` (10),
`RESULT_SECONDS` (16, tiempo para cerrar la pantalla de resultado).

### Costo aproximado

Los clientes consultan el servidor cada ~0,7 s. Una partida tonpuusen completa
usa del orden de 15.000–20.000 comandos de Redis y unas 10.000 invocaciones de
la función, así que el plan gratuito de Upstash alcanza para unas pocas
decenas de partidas al mes. Para más uso, un plan de pago de Upstash o pasar
a un servicio de tiempo real (ver "Limitaciones").

## Desarrollo local

Requiere Node.js 20 o superior. No hay que instalar paquetes.

```sh
npm run dev      # http://localhost:3000 (store en memoria)
npm test         # tests del motor, puntuación y salas
```

Para probar solo, abre 4 ventanas (o una normal y tres de incógnito, porque la
sesión vive en `localStorage`) y únete a la misma sala.

## Laboratorio de animaciones

`/lab.html` (en local `http://localhost:3000/lab.html`, y también en el sitio
publicado; no está enlazado desde el juego) reproduce escenas fijas sobre la
mesa 3D real para mirar las animaciones de cerca y afinarlas:

- **Escenas**: inicio de mano (revolver, muros, dados, reparto), robos y
  descartes, pon de un rival, tu pon y tu chi, riichi y ron de un rival, tu
  tsumo, tu tsumo con tres kan y empate. Salen de
  `public/lab/scenarios.json`, que arma `npm run lab:scenarios` con el motor
  del juego (manos y muros preparados, siempre iguales).
- **Tiempo**: pausa (espacio), cuadro a cuadro (→), cámara lenta hasta
  0,05×, comienzo (R) y una barra para saltar a cualquier momento (con una
  marca por cada jugada). Toda la mesa usa un reloj propio de la página, así
  que también se detienen y frenan los avisos de llamada.
- **Cámara**: vistas preparadas (la del juego, mesa completa, desde arriba,
  tu mano, el centro, cada rival, la esquina de tus llamadas) y cámara libre:
  botón derecho para girar, Mayús + arrastre para mover, rueda para acercar.
  Se puede ocultar tu mano de frente.
- **Ajustes en vivo** (`public/js/three3d/tuning.js`): velocidades de las
  fichas y de tu mano, tiempos de la victoria, del empate, de los dados y del
  cajón, y la luz. Los que cambian se marcan; **Copiar cambios** da el texto
  con los valores nuevos para dejarlos fijos en el juego. Algunos (los tiempos
  de una animación ya empezada) se ven al volver al comienzo.

## Fichas

Las imágenes vienen del set `Regular` de
[FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
(dominio público, CC0) y están en `public/tiles/`. Para cambiar de set, mira
[`public/tiles/README.md`](public/tiles/README.md). Si la carpeta queda sin
imágenes, las fichas se dibujan con CSS.

## Estructura

```
api/game.js              Función de Vercel (POST /api/game)
server/handler.js        Salas, cola, temporizadores, vistas por jugador
server/store.js          Upstash Redis (REST) o memoria
server/engine/game.js    Máquina de estados de la partida (reglas)
server/engine/score.js   Yaku, fu y puntos
server/engine/hand.js    Descomposición de manos, esperas, shanten
public/                  Cliente (index.html, css/, js/)
public/js/shared/        Modelo de fichas compartido con el servidor
public/js/three3d/       Mesa 3D (three.js); tuning.js: velocidades, tiempos y luz
public/lab.html          Laboratorio de animaciones (js/lab.js, lab/scenarios.json)
scripts/lab-scenarios.mjs  Arma las escenas del laboratorio
dev-server.js            Servidor local
test/                    node:test
```

El estado completo de la partida es un objeto JSON. Cada request: toma un
lock de la sala en Redis, carga el estado, aplica la acción y los
temporizadores vencidos, y guarda; son dos idas y vueltas a Redis (tomar el
lock y leer en un pipeline, guardar y soltar el lock en otro). Al descartar,
el cliente no espera al servidor: dibuja de inmediato la ficha fuera de la
mano y en los descartes, y la respuesta del servidor la confirma (o, si la
rechaza, la devuelve a la mano). Cada jugador recibe solo su vista (nunca
las manos ajenas ni la pared).

## Limitaciones conocidas

- Polling en vez de WebSockets (Vercel no mantiene conexiones abiertas): hay
  hasta ~0,7 s de latencia. Para algo más fluido se puede mover la parte de
  tiempo real a Ably, Pusher, PartyKit o un servidor Node con WebSockets; el
  motor (`server/engine`) es independiente del transporte.
- No hay cuentas, rating ni historial: el "ranked" se limita a las reglas y
  al cálculo final de puntos.
- En doble ron, cada ganador cobra los honba y los depósitos de riichi van al
  primero en orden de turno desde quien descartó.
- En pao se aplica la responsabilidad a todo el valor de la mano.
- En móvil vertical se ve siempre la mesa entera desde arriba.
