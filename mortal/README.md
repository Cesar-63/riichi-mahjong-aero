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
- `encoder/` es nuestro: la API en C que expone el codificador a JavaScript.
- Nuestras partidas son al Este (tonpuusen) y Mortal solo conoce el hanchan:
  juega nuestro Este como el Este de un hanchan, sin ajustes. Se probaron dos
  ajustes y ninguno mejoró (ver [Fuerza](#velocidad-y-fuerza)). La regla
  anti-agarasu, que está fuera de la red, sí sabe que Este 4 es la última mano.

## Verificación

- La red en ONNX elige la misma acción que PyTorch en 3.000 posiciones de
  nuestras partidas (diferencia máxima 6,7 × 10⁻⁶; con los pesos guardados en
  16 bits, 0,004).
- El codificador WASM da las mismas máscaras que el libriichi original en
  23.198 posiciones de 52 partidas. Las observaciones
  difieren como mucho en 7,5 × 10⁻⁹ por redondeo de las funciones matemáticas, y
  la red elige la misma acción en las 23.198 posiciones y en los 52 kanes.
- **De punta a punta:** en 1.867 decisiones de 24 partidas, el bot difícil
  eligió exactamente lo mismo que el `Bot` mjai oficial de Mortal en Python con
  los mismos pesos,
  incluidos 35 riichi en dos pasos, pon y chi con cincos rojos, ankan, ron y
  tsumo.
- `test/mortal.test.js` prueba el codificador y el bot difícil en el juego.

## Velocidad y fuerza

- **Velocidad** (un hilo, sin otros procesos): codificador 0,7 ms de mediana y
  160 ms como máximo; red 69 ms de mediana y 133 ms como máximo. Un riichi hace
  dos consultas. La primera decisión de cada instancia carga la red (unos
  0,6 s). Memoria: unos 480 MB.
- **Fuerza:** partidas duplicadas al Este con un bot difícil contra 3 normales:
  128 juegos de muros, cada uno con el difícil en los 4 asientos, con y sin
  mostrarle el Este como Sur (1.024 partidas). Intervalos de 95 % calculados por
  juego de muros.

  | 512 partidas cada uno | Puesto medio | Puntos Tenhou (90/45/0/−135) | 1º / 4º | Gana / reparte ron |
  | --- | --- | --- | --- | --- |
  | **Mortal tal cual (el que juega)** | **2,305 ± 0,107** | **+14,2 ± 7,7** | 30,7 % / 18,9 % | 23,1 % / 11,6 % de las manos |
  | Con el Este mostrado como Sur | 2,453 ± 0,105 | +4,6 ± 8,1 | 24,0 % / 22,3 % | 18,1 % / 12,7 % |

  Mortal tal cual es claramente más fuerte que el bot normal (un rival igual
  daría 2,5 y 0 puntos). Mostrarle el Este como Sur lo empeora: en los mismos
  muros queda 0,148 ± 0,124 puestos más abajo, porque cree que la partida está
  más avanzada y juega demasiado a la defensiva. Por eso se quitó. Los bots
  normales, entre ellos, ganan el 22,5 % de las manos y reparten ron en el
  13,4 %.
- **Avisarle solo en Este 4 que es la última mano** (la fila de progreso de la
  observación con el valor de Sur 4): otras 1.024 partidas con muros nuevos.
  Cambió el resultado de 305 de 512 partidas, pero no mejoró: 2,383 ± 0,096 con
  el aviso y **2,344 ± 0,103** sin él; en los mismos muros, 0,039 ± 0,058 puestos
  peor. Tampoco se dejó. Juntando las dos tandas, Mortal tal cual queda en
  2,32 de puesto medio en 1.024 partidas contra 3 bots normales.

## Rehacer las piezas

```sh
# encoder.wasm (necesita: rustup target add wasm32-unknown-unknown)
./mortal/build.sh

# libriichi/ desde un checkout de Mortal (lib.rs se escribe a mano)
python3 mortal/tools/strip_pyo3.py <Mortal> mortal/libriichi/src

# mortal-s42.onnx (necesita torch y onnx)
python3 mortal/tools/export_onnx.py <Mortal> s42-inference.pth server/engine/mortal/mortal-s42.onnx
```

Los tres reproducen byte a byte lo que está en el repositorio (`strip_pyo3.py`
todo `libriichi/src` salvo `lib.rs`).

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
