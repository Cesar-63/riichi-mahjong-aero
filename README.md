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

1. Escribe un nombre y un código de sala (por defecto `publica`) y pulsa
   **Buscar partida**. Cuando hay 4 en la cola de esa sala, empieza la partida
   con asientos al azar.
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
- El servidor solo envía qué huecos están vacíos y de dónde salió el último
  robo, nunca qué ficha hay en cada posición.

## Modo test (contra bots)

En el lobby, **Modo test: jugar contra 3 bots** crea una sala privada
(`bots-…`) con tu jugador y tres bots, y empieza al instante. Los bots:

- descartan siempre la ficha que acaban de robar (tras una llamada, la última
  ficha legal de la mano);
- hacen pon o chi siempre que pueden;
- nunca declaran ron, tsumo, riichi ni kan.

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
`RESULT_SECONDS` (12, tiempo para cerrar la pantalla de resultado).

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
temporizadores vencidos, y guarda. Cada jugador recibe solo su vista (nunca
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
