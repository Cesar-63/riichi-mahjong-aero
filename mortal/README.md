# Bot difícil: Mortal

Los bots de nivel **difícil** juegan con [Mortal](https://github.com/Equim-chan/Mortal)
(Equim, AGPL-3.0-or-later), una IA de riichi entrenada con aprendizaje por
refuerzo. Usan los pesos comunitarios
[Mortal-S42](https://huggingface.co/haor/Mortal-S42) (Apache-2.0): una red de 40
bloques y 192 canales, unos 10,8 millones de parámetros, entrenada con unas
1,1 millones de partidas de Tenhou Houou y partidas de rango alto de Mahjong
Soul.

Todo lo de Mortal vive en dos carpetas:

| | |
| --- | --- |
| `mortal/` | Código fuente en Rust y herramientas (esta carpeta) |
| `server/engine/mortal/` | Lo que usa el servidor: `encoder.wasm`, `mortal-s42.onnx` y el adaptador `mortal-bot.js` |

## Cómo decide

1. `mjaiView` deja el registro mjai de la mano tal como lo ve el asiento del bot.
2. `encoder.wasm` (libriichi compilado a WebAssembly) reproduce la mano con el
   `PlayerState` de Mortal y arma lo que lee la red: una observación de
   1012 × 34 y la máscara de las 46 acciones legales.
3. `mortal-s42.onnx` corre con [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)
   (MIT) y da un valor por acción.
4. `mortal-bot.js` elige la mejor acción legal y la traduce a nuestro motor. El
   riichi y el kan llevan una segunda consulta, como en Mortal: primero
   "riichi", después qué ficha tirar; primero "kan", después cuál. En la última
   mano aplica nuestra regla anti-agarasu.

Si algo falla, decide majiang-ai (el nivel normal).

## Qué se cambió de Mortal

- `libriichi/` es una copia del libriichi de Mortal (commit
  `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2`) con solo los módulos del
  codificador y **sin la capa de Python** (pyo3/numpy). La hace
  `tools/strip_pyo3.py` de forma mecánica: quita atributos de Python y las
  funciones que reciben tipos de Python; el resto queda igual.
- **Tonpuusen.** Mortal solo conoce el hanchan, y la red recibe el progreso de
  la partida (Este 1 = 0 … Sur 4 = 7). Con `PlayerState::tonpuusen`, nuestro
  Este se le muestra como el Sur de un hanchan (quedan 4 manos y luego muerte
  súbita, como el 西入 de Tenhou) y el Sur de muerte súbita como el Oeste. El
  viento de ronda sigue siendo Este, así que los yaku se calculan bien. Son tres
  cambios a mano, marcados con `salón:` en `state/player_state.rs`,
  `state/update.rs` y `state/obs_repr.rs`.
- `encoder/` es nuestro: la API en C que expone el codificador a JavaScript.

## Verificación

- La red en ONNX elige la misma acción que PyTorch en 3.000 posiciones de
  nuestras partidas (diferencia máxima 6,7 × 10⁻⁶; con los pesos guardados en
  16 bits, 0,004).
- El codificador WASM, sin el ajuste de tonpuusen, da las mismas máscaras que el
  libriichi original en 23.198 posiciones de 52 partidas. Las observaciones
  difieren como mucho en 7,5 × 10⁻⁹ por redondeo de las funciones matemáticas, y
  la red elige la misma acción en las 23.198 posiciones y en los 52 kanes.
- **De punta a punta:** en 1.867 decisiones de 24 partidas (sin el ajuste de
  tonpuusen, para comparar lo mismo), el bot difícil eligió exactamente lo
  mismo que el `Bot` mjai oficial de Mortal en Python con los mismos pesos,
  incluidos 35 riichi en dos pasos, pon y chi con cincos rojos, ankan, ron y
  tsumo.
- `test/mortal.test.js` prueba el codificador y el bot difícil en el juego.

## Velocidad y fuerza

- **Velocidad** (un hilo, sin otros procesos): codificador 0,7 ms de mediana y
  160 ms como máximo; red 69 ms de mediana y 133 ms como máximo. Un riichi hace
  dos consultas. La primera decisión de cada instancia carga la red (unos
  0,6 s). Memoria: unos 480 MB.
- **Fuerza:** 240 partidas duplicadas (60 juegos de muros, cada uno 4 veces con
  el bot difícil en cada asiento contra 3 normales). Puesto medio del difícil:
  **2,50 ± 0,16** (intervalo de 95 %), sin diferencia medible con los normales.
  Juega como Mortal: más prudente, reparte menos ron (11,0 % de las manos contra
  13,4 %), gana algo menos (18,7 % contra 22,5 %), declara menos riichi (17,3 %
  contra 24,0 %) y llama menos (28,8 % contra 34,9 %). Esas cifras son casi las
  que Mortal publica de sí mismo (11,3 % de ron repartido, 21,2 % de victorias,
  18,9 % de riichi). Para separar diferencias de 0,1 puestos hacen falta miles de
  partidas: la ventaja publicada de Mortal sobre akochan es de 0,09 puestos en
  13.152 partidas. El efecto del ajuste de tonpuusen tampoco está medido.

## Rehacer las piezas

```sh
# encoder.wasm (necesita: rustup target add wasm32-unknown-unknown)
./mortal/build.sh

# libriichi/ desde un checkout de Mortal; después hay que volver a aplicar
# los tres cambios "salón:" de tonpuusen
python3 mortal/tools/strip_pyo3.py <Mortal> mortal/libriichi/src

# mortal-s42.onnx (necesita torch y onnx)
python3 mortal/tools/export_onnx.py <Mortal> s42-inference.pth server/engine/mortal/mortal-s42.onnx
```

`build.sh` y `export_onnx.py` reproducen byte a byte `encoder.wasm` y
`mortal-s42.onnx`. `strip_pyo3.py` reproduce `libriichi/src` salvo `lib.rs` (escrito
a mano) y los tres cambios `salón:`.

## Licencias

- Mortal y libriichi: AGPL-3.0-or-later (`libriichi/LICENSE`). Por eso todo el
  juego se publica con AGPL-3.0 (`LICENSE` en la raíz).
- Pesos Mortal-S42: Apache-2.0. El aviso de su autor dice: *"Model weights:
  Apache-2.0"*; el código de inferencia que acompaña a esos pesos es AGPL, pero
  aquí no se usa.
- onnxruntime-web: MIT.

## Quitar el bot difícil

Para un proyecto aparte sin AGPL basta con borrar `mortal/`,
`server/engine/mortal/`, `test/mortal.test.js` y la dependencia
`onnxruntime-web`. `server/engine/bot.js` carga Mortal solo cuando juega un bot
difícil y, si no lo encuentra, usa majiang-ai.
