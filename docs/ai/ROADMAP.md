# IA propia de riichi: hoja de ruta

Etapas y tareas para construir la IA descrita en
[ARCHITECTURE.md](ARCHITECTURE.md). Cada tarea dice quién la hace:

- **Claude:** se puede hacer en una sesión como esta (4 núcleos, 15 GB de RAM,
  sin GPU, contenedor efímero).
- **Tú:** necesita GPU, datos grandes, cuentas o una decisión tuya.

Las duraciones de entrenamiento son estimaciones
([ARCHITECTURE.md §10](ARCHITECTURE.md#10-plan-de-entrenamiento-por-etapas)).
Cada etapa termina en una **puerta**: si no se cumple, no se pasa a la
siguiente.

## Decisiones tomadas

Respondidas el 16 de noviembre de 2026.

| # | Decisión | Respuesta |
| --- | --- | --- |
| D1 | Arquitectura | **Aprobada** como está en [ARCHITECTURE.md](ARCHITECTURE.md) |
| D2 | Repositorio | **Privado y separado** (`riichi-aero-ai`, nombre provisional) |
| D3 | Licencia de este juego | **Quitar Mortal** y cambiar la licencia. Se hace en la etapa E, cuando el bot propio lo reemplace: antes, el nivel difícil se quedaría sin cerebro |
| D4 | Fuente de datos | **El dataset de 2 millones de partidas de Houou ya en mjai** de Hugging Face, para entrenar en privado y sin redistribuirlo. Sigue siendo `license: other` sobre registros de Tenhou ([ARCHITECTURE.md §9](ARCHITECTURE.md#9-pipeline-de-datos)) |
| D5 | Dónde entrenar | **Tu máquina.** Falta saber qué GPU, cuánta VRAM, cuántos núcleos y cuánto disco tiene, para ajustar los tamaños |
| D6 | Estos documentos | **Se copian al repo privado.** La copia de allí pasa a ser la que se mantiene |
| D7 | Rigor del "clean room" | **Implementación desde la especificación**, con las reglas de [ARCHITECTURE.md §15](ARCHITECTURE.md#15-licencias-y-procedencia): el repo privado no contiene código de Mortal y las sesiones de implementación no lo abren |

## Etapa A: cimientos del motor

Objetivo: un motor Rust propio que reproduce las partidas del motor JS.

| Tarea | Quién |
| --- | --- |
| Crear el repo privado `riichi-aero-ai` y abrir una sesión con acceso a él | Tú |
| Estructura del repo, `PROVENANCE.md`, integración continua | Claude |
| `core`: fichas, manos, shanten y aceptación por tablas propias | Claude |
| `core`: yaku, fu, puntos y pagos | Claude |
| `core`: máquina de estados con reglas configurables (Tenhou y esta plataforma) | Claude |
| `mjai`: eventos, lectura, escritura y validador | Claude |
| En este repo: un script que vuelca partidas con semilla del motor JS, con acciones legales y puntos | **Hecho:** `npm run ai:fixtures` |
| Pruebas diferenciales contra esos volcados | Claude |

**Puerta A:** 10.000 partidas aleatorias del motor JS se reproducen en Rust
sin una sola diferencia en acciones legales, puntos ni fin de partida. El
shanten por tablas coincide con el de `hand.js` en un millón de manos al azar.

## Etapa B: datos

Objetivo: partidas reales validadas y listas para entrenar.

| Tarea | Quién |
| --- | --- |
| Revisar términos de uso y elegir la fuente (D4) | Tú |
| Conversor de registros de Tenhou a mjai | Claude |
| Validar una muestra de unos miles de partidas reales con el motor | Claude |
| Corregir el motor con lo que la muestra revele | Claude |
| Descargar el dataset completo a tu máquina o instancia | Tú |
| Validar el dataset completo y generar el índice (el comando lo deja listo Claude) | Tú |
| Filtros y particiones por fecha | Claude |
| Informe de datos: cuántas partidas por formato, sala, nivel y año; tasa de rechazo | Tú lo corres, Claude lo escribe |

**Puerta B:** al menos el 99,9 % de las partidas de Tenhou se reproducen con
los puntos exactos. Cada rechazo tiene un motivo conocido.

## Etapa C: codificador y arena

Objetivo: observaciones, acciones y un simulador con inferencia por lotes.

| Tarea | Quién |
| --- | --- |
| `obs`: vista por asiento, planos, vector global, máscara de 120 acciones | Claude |
| Traducción de acciones a mjai y de vuelta | Claude |
| `py`: módulo de Python con el cargador de datos | Claude |
| `arena`: autojuego por lotes, muros reproducibles, partidas duplicadas | Claude |
| Estadísticas de juego desde registros | Claude |
| Bot mjai por entrada y salida estándar | Claude |
| Puente para jugar contra majiang-ai y contra Mortal-S42 como procesos aparte | Claude |
| Benchmark del codificador y de la arena | Claude aquí; tú en tu máquina |

**Puerta C:** la máscara coincide con las acciones legales del motor en todas
las posiciones del dataset de validación. Codificar y decodificar cada acción
humana da la misma acción. El codificador supera las 20.000 observaciones por
segundo y núcleo.

## Etapa D: imitación (etapas 0 y 1 del entrenamiento)

Objetivo: un primer bot que juega como un humano fuerte.

| Tarea | Quién |
| --- | --- |
| Código del modelo en los cuatro tamaños | Claude |
| Código de entrenamiento de las etapas 0 y 1, con configuración por archivo | Claude |
| Entrenamiento de humo en CPU con el modelo XS y unos miles de partidas | Claude |
| **Benchmark de una hora en tu GPU** para reemplazar las estimaciones por números reales | Tú |
| Etapa 0: modelo de posición | Tú (minutos) |
| Experimentos E1 a E5 con el modelo S (horas cada uno) | Tú los corres; Claude prepara las configuraciones y lee los resultados |
| Decidir el diseño final con esos resultados | Los dos |
| Etapa 1 con el modelo M (~1 día) y luego L (3–4 días) | Tú |
| Exportación a ONNX y prueba de paridad | Claude |
| Evaluación contra majiang-ai y contra Mortal-S42 | Tú a escala; Claude el código y pruebas pequeñas |

**Puerta D:** acierto en el descarte de 68 % o más en validación. Puesto medio
de 2,30 o mejor contra 3 majiang-ai en 2.000 partidas con las reglas de la
plataforma.

## Etapa E: integración en la plataforma

Objetivo: el bot propio jugando en el juego. Se puede hacer en paralelo con la
etapa F.

| Tarea | Quién |
| --- | --- |
| Resolver la licencia del juego (D3) | Tú |
| Destilar al modelo S y cuantizar | Tú lo corres; Claude el código |
| Compilar el codificador a WASM | Claude |
| En este repo: `start_game` y `end_game` en el registro mjai, y guardar la partida entera | Claude (issue aparte) |
| En este repo: adaptador y nivel nuevo de bot, con respaldo | Claude (issue aparte) |
| Medir latencia, memoria y arranque en frío en Vercel | Los dos |
| Si se elige: quitar Mortal y actualizar la licencia y el README | Claude, cuando lo decidas |

**Puerta E:** el bot propio juega partidas completas en la plataforma sin una
acción ilegal, con menos de 20 ms de mediana por decisión, y gana a majiang-ai.

## Etapa F: mejora fuera de línea (etapa 2 del entrenamiento)

| Tarea | Quién |
| --- | --- |
| Código de la etapa 2, con las dos variantes | Claude |
| Batería de posiciones de última mano | Claude |
| Entrenar las dos variantes (1–3 días) | Tú |
| Torneo de promoción de 10.000 partidas | Tú |

**Puerta F:** gana al modelo de la etapa 1 por 3 puntos o más con el intervalo
de 95 % fuera de cero.

## Etapa G: autojuego (etapa 3 del entrenamiento)

| Tarea | Quién |
| --- | --- |
| Código del autojuego: liga, actores, aprendiz, promoción | Claude |
| Prueba corta para verificar que no se degrada | Tú |
| Corrida larga (2–6 semanas) | Tú |
| Seguimiento: leer métricas, ajustar, decidir cuándo parar | Los dos |
| Destilar de nuevo al modelo liviano y desplegar | Tú y Claude |

**Puerta G:** gana al mejor de la etapa 2 por 3 puntos o más. Meta: empatar
con Mortal-S42 en 20.000 partidas.

## Orden y dependencias

```
Decisiones ─► A ─► B ─► C ─► D ─┬─► E (integración)
                                └─► F ─► G
```

- A, B y C son solo código y datos pequeños: se pueden avanzar sin GPU.
- La primera vez que hace falta tu GPU es en la etapa D.
- La etapa E entrega valor a la plataforma sin esperar a F y G.

## Riesgos

| Riesgo | Señal | Respuesta |
| --- | --- | --- |
| El motor no reproduce Tenhou con exactitud | Rechazos sobre el 0,1 % en la etapa B | No se entrena hasta arreglarlo |
| La entrada compacta pierde lectura de manos | Acierto bajo o mucha tasa de ron repartido en la etapa D | Experimento E3; ampliar los planos de descartes |
| Los pesos compartidos entre palos no ayudan | E1 sin diferencia | Red 1D corriente con aumento de datos |
| El modelo ignora el uma de entrada | E2 sin efecto | Entrenar un modelo por reglamento |
| El autojuego se degrada | Pierde contra el ancla de imitación | Más penalización hacia la política previa; más rivales en la liga |
| No se alcanza a Mortal | Diferencia estable tras la etapa G | El bot ya es útil; decidir si invertir más cómputo |
| Términos de uso de los datos | — | Decisión tuya (D4) antes de descargar |
| Licencia de este repo | — | Decisión tuya (D3) antes de integrar |

## Qué entrega esta sesión

- [MORTAL_NOTES.md](MORTAL_NOTES.md): análisis conceptual de Mortal.
- [ARCHITECTURE.md](ARCHITECTURE.md): el diseño propio.
- Este documento.

No se escribió código de la IA. El siguiente paso es crear el repo privado
(primera tarea de la etapa A).
