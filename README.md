# Riichi Mahjong Aero

Riichi mahjong para 4 jugadores en el navegador, con reglas tipo **partida
ranked de Tenhou**. Las reglas, la pared y el reparto de puntos los maneja el
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

1. En el menú principal elige el **modo de juego**, escribe un nombre y un
   código de sala (por defecto `publica`) y pulsa **Entrar a la sala**. Cada
   sala queda con el modo de quien la abrió; para entrar hay que elegir ese
   mismo modo.
   - **Clásico** (ranked individual, el modo original): la partida empieza
     sola al llegar a 4 jugadores, con asientos al azar.
   - **Por equipos** (2 contra 2): en la sala de espera (máximo 4) eliges
     **Equipo Norte** o **Equipo Sur** (2 por equipo), marcas **Estoy listo**
     (cambiar de equipo lo quita) y el **host** (el primero que entró; si se
     va, el siguiente) pulsa **Comenzar partida** cuando hay 2 + 2 y los 4
     están listos. Los compañeros se sientan uno al lado del otro (se sortea
     qué equipo empieza en 東 y el orden dentro de cada equipo). Ver
     [Juego por equipos](#juego-por-equipos).
2. Clic en una ficha para descartarla. Los botones (Riichi, Tsumo, Ron, Pon,
   Chi, Kan, Pasar) aparecen sobre tu mano cuando aplican.
3. **☰ Menú** (esquina superior izquierda, siempre visible):
   - **No llamar**: pasa automáticamente en chi/pon/kan; el ron se sigue
     ofreciendo.
   - **Reglas** y **Pantalla completa**.
   - **Abandonar partida**: tu asiento sigue en automático (tsumogiri) hasta
     el final y los demás lo ven como "(abandonó)". Puedes volver uniéndote
     otra vez a la misma sala. Contra bots, abandonar termina la partida; si
     todos los humanos abandonan, la sala se libera.
4. Si recargas la página o se corta la conexión, vuelves a tu asiento (la
   sesión se guarda en el navegador).

## Mesa 2.5D y muro

- Las fichas son imágenes planas del mismo tamaño en toda la mesa (proyección
  oblicua, sin perspectiva, como Tenhou). El volumen sale de dibujar el canto
  de cada ficha (cuerpo marfil + capa del reverso) siempre hacia abajo en
  pantalla; cada asiento rotado compensa la dirección con variables CSS
  (`--tx`, `--ty`).
- El muro son 4 lados de 17 pilas de 2 fichas en molinete. Al empezar cada
  mano se tiran dos dados (se ven en el centro): la suma elige el muro
  (contando al oya como 1, en sentido antihorario) y cuántas pilas contar
  desde su extremo derecho para el corte. Desde el corte se roba en sentido
  horario; las 7 pilas al otro lado son el muro muerto (algo más apagado), con
  el indicador de dora boca arriba en la tercera pila y las fichas de rinshan
  en la pila junto al corte.
- Cada robo anima una ficha desde su hueco del muro (o del muro muerto, tras
  un kan) hasta la mano de quien roba.
- Cada descarte vuela boca arriba desde la mano hasta la pila de descartes:
  desde la posición de la ficha robada si es **tsumogiri**, o desde dentro de
  la mano si es **tedashi**. En la pila, los descartes tsumogiri se ven más
  oscuros.
- El servidor solo envía qué huecos están vacíos y de dónde salió el último
  robo, nunca qué ficha hay en cada posición.

## Ambientaciones

Se elige en el menú principal (**Ambientación**) o en **☰ Menú** durante la
partida, y se recuerda en el navegador. Cambia la interfaz 2D y la escena 3D al
instante, sin recargar.

- **Frutiger Aero** (por defecto): cielo, burbujas, vidrio aguamarina y
  botones brillantes tipo Aqua.
- **Salón Tetsuya**: inspirada en los juegos de *Tetsuya*. Habitación oscura,
  mesa de madera (con vetas y el marco cortado en diagonal en las esquinas,
  como un marco de cuadro) y tapete verde bajo una lámpara cálida y sillas en
  penumbra (3D); fichas de reverso amarillo, menús en cajas azul marino con
  brillo azul, retratos de los rivales en marcos dorados, la mano propia sobre
  una franja oscura con resplandor azul y avisos de llamada en letra blanca
  con contorno negro. En 3D la mesa no tiene placa central: los dados quedan
  toda la mano sobre el tapete a la derecha del oya (quien los tiene de su
  lado reparte), y la ronda, los honba, los depósitos, las fichas que quedan
  y tus puntos se ven en un recuadro arriba a la izquierda.

## Vista 3D

Hecha con [three.js](https://threejs.org) (0.170, MIT, incluido en
`public/vendor/three/`, sin build). Es la vista por defecto; la vista 2.5D
clásica se elige en el menú principal (**Vista**) o en **☰ Menú → Vista**
durante la partida, o abriendo la página con `?3d=0` (`?3d=1` fuerza la 3D).
La elección se recuerda en el navegador. three.js solo se descarga cuando se
usa.

- Pantalla completa en cualquier proporción (16:9, ultrawide, móvil vertical).
- Escenario Frutiger Aero en 3D: la mesa de vidrio aguamarina flota en un
  cielo luminoso sobre un mar de nubes, con islas de pasto flotantes y
  burbujas de jabón iridiscentes; los reflejos salen del propio cielo.
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
  riichi también se mueven a velocidad constante. Son casi inmediatos (un
  descarte tarda una décima de segundo) y **las jugadas no se pisan**: el robo
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
  tamaño ajustado al ancho y alto de la pantalla. La ficha robada vuela desde
  su hueco del muro hasta la mano; durante el reparto la mano se llena a medida
  que llegan tus fichas.
- **Cámara de jugador y mesa completa:** por defecto la cámara está baja,
  cerca de tu lado (estilo Tetsuya). Con el mouse en la mitad superior de la
  pantalla, o tocándola en el móvil, sube y muestra la mesa entera; en la
  mitad inferior vuelve. En pantallas verticales siempre se ve la mesa entera.
- **Retratos de los rivales** arriba (izquierda = kamicha, centro = toimen,
  derecha = shimocha) con nombre, viento, puntos, riichi y el compañero en el
  modo por equipos; el que tiene el turno brilla.
- Botones, menú, resultados y el panel del compañero son los mismos del 2D,
  encima del canvas.

### Animaciones de riichi y de victoria (3D)

- **Riichi**: aviso grande "リーチ"; la ficha sale de la mano, se acuesta de
  lado mientras sube y cae así en los descartes. Si nadie hace ron sobre ella
  (el servidor recién entonces marca el riichi), un palito de 1000 puntos en
  3D entra girando y se acomoda frente al jugador (en la placa central, o en
  el tapete en el salón Tetsuya).
- **Victoria**: aviso grande "ツモ"/"ロン"; las fichas del ganador se tumban
  boca arriba una por una, girando sobre su canto a ritmo parejo (la ganadora,
  separada y brillando), y la cámara muestra la mesa entera. Luego, justo delante de esa mano, se arma
  una fila con cartel **ドラ**: los indicadores de dora vuelan desde el muro
  muerto hasta ella; con riichi sigue el cartel **裏ドラ** y los ura dora salen
  de debajo de los indicadores, se voltean en el aire y se ponen al lado. Las
  fichas de la mano que valen dora se iluminan (dorado: dora y cincos rojos;
  rosado: ura dora) y un cartel cuenta dora, ura y aka. Después se abre la
  pantalla de resultado. En 2D el resultado se abre tras un momento, para que
  se vea el aviso.
- **Empate por agotamiento** (3D): todas las manos se tumban a la vez, ficha
  por ficha: las que están en tenpai boca arriba con el cartel **テンパイ**, y
  las noten boca abajo con **ノーテン**. Después se abre la pantalla de
  resultado. Los empates abortivos van directo al resultado.

### Animación de inicio de cada mano

Al empezar cada mano el servidor pausa los relojes y los bots durante
`INTRO_SECONDS` (6 s por defecto; 0 la desactiva) y la vista 3D reproduce, con
las 136 fichas y la mesa vista entera:

1. **Revolver**: las fichas boca abajo forman un círculo que gira sobre todo
   el centro de la mesa (en Frutiger Aero la placa central se hunde en la
   mesa mientras tanto y vuelve a subir con los muros), cada una a su ritmo,
   acercándose y alejándose y dándose vuelta, mientras dos "manos" las
   arremolinan. Es una pequeña simulación con colisiones (`public/js/three3d/shuffle.js`): las
   fichas se empujan y se deslizan unas contra otras (una esquina puede
   montarse un momento sobre la vecina, como pasa de verdad, pero nunca se
   atraviesan); al final se juntan y se enderezan para dejar lugar a los
   muros.
2. **Armar los muros**: cada ficha sube de la pila, cruza por encima de las
   demás y baja a las cuatro filas de pilas de dos, un poco hacia afuera,
   primero la de abajo y encima la de arriba, y las filas se empujan a su
   lugar.
3. **Tirar los dados**: dos dados pequeños rebotan desde el lado del oya y caen
   mostrando la tirada real, que decide el corte del muro: en la placa
   central (Frutiger Aero) o a la derecha del oya, donde se quedan toda la
   mano (Tetsuya).
4. **Repartir**: desde el corte, en bloques de 4 (tres vueltas), luego 1 cada
   uno y el primer robo del oya; cada bloque se levanta por encima de los
   muros (los que vuelan a la vez, a distinta altura) antes de ir a la mano, y
   tu mano se llena a medida que llegan tus fichas. Al final se voltea el
   indicador de dora.

En 2D se muestra un aviso con la fase y los dados rodando. Quien se conecta a
mitad de la pausa ve la animación acortada.

El motor de reglas y el servidor son los mismos: la vista 3D dibuja la misma
"vista" que envía el servidor (`public/js/three3d/`).

## Juego por equipos

Solo en el modo **Por equipos**:


- Cada jugador ve la **mano de su compañero** en un panel fuera del tablero:
  acoplado al margen del lado donde se sienta el compañero si la pantalla
  tiene espacio, o como franja desplegable arriba en pantallas angostas. Se
  puede plegar con su botón.
- **Pedir descarte**: clic en una ficha del compañero. A él se le resalta en
  naranja en su mano con el aviso "X te pide ▢". Es una sugerencia, no
  obliga; otro clic la cancela y caduca cuando la ficha sale de su mano o
  termina la mano.
- El servidor solo envía la mano del compañero (nunca la de los rivales), y
  las peticiones solo las ve el equipo.
- Los puntos y el uma siguen siendo individuales; al final se suma el
  resultado de cada equipo y gana el que tenga más.

## Modo test (contra bots)

En el menú principal, **Modo test: jugar contra bots** crea una sala privada
(`bots-…`) con el modo elegido y empieza al instante: en **Clásico**, tú contra
3 bots; en **Por equipos**, tú y **Bot 1** (Equipo Norte) contra Bot 2 y
Bot 3. Los bots:

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
- En móvil vertical el tablero es pequeño (se ajusta al ancho de la pantalla).
