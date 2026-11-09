# Personajes

Los seis personajes que se sientan a la mesa (`public/js/shared/characters.js`
tiene la lista; el jugador elige el suyo en el lobby).

| Archivo | Quién es | De dónde sale |
| --- | --- | --- |
| `genzo.glb` | El viejo de camisa gris, con cigarro | Modelo fuente `viejo_retro.glb`, tal cual |
| `ryuji.glb` | Terno blanco y corbata a rayas | Modelo fuente `terno_blanco_retro.glb`, tal cual |
| `shiro.glb` | Pelo blanco, camisa celeste abierta | Modelo fuente `pelo_blanco_retro.glb`, con brazos nuevos (el original tiene las manos en los bolsillos) |
| `kaito.glb` | Camisa verde abierta, polera negra, jeans | Shiro recoloreado, pelo negro con mechones más largos atrás |
| `tatsuo.glb` | Señor de traje negro, camisa roja, detalles dorados | El traje de Ryuji recoloreado y la cabeza de Genzo, sin cigarro y con pelo cano peinado hacia atrás |
| `momo.glb` | Estudiante de uniforme marinero, pelo rosado | Cabeza, cuello y piernas de Shiro; torso, falda, pelo y texturas del uniforme hechos por el script |

## Cómo se arman

Los tres modelos fuente (`scripts/personajes/fuentes/`) son del proyecto:
figuras low-poly de pie, de unas 900 a 1150 caras, hechas de **piezas sueltas**
(cabeza, torso, cada tramo de brazo y pierna, mechones de pelo…) con un atlas
de 256×256 en baldosas de 64 px. No traen esqueleto ni animaciones.

`python3 scripts/personajes/build.py` (necesita numpy y Pillow) los lee y
escribe los `.glb` de esta carpeta:

- **Esqueleto.** Cada pieza se cuelga entera de una articulación (cadera,
  columna, cabeza y, por lado, brazo, antebrazo, mano, muslo, pierna y pie):
  piel rígida, como en una PS1. El script decide a qué articulación va cada
  pieza por dónde está (los cortes de cada modelo están en `CUTS`) y lee de
  las mismas piezas dónde queda cada articulación.
- **Variantes.** Los personajes nuevos se arman pieza por pieza: se quitan o
  se toman piezas de otro modelo, se agregan formas simples (tubos y cajas
  para el pelo, el torso o la falda) y se repintan las baldosas del atlas
  conservando su sombreado. Los que mezclan dos modelos llevan un atlas de
  512×256 (dos páginas).
- `--huesos` escribe además `*_huesos.glb`, con un color por articulación,
  para revisar el reparto de piezas (no se suben al repositorio).

Los modelos quedan de pie, en reposo. Sentarlos y moverlos es trabajo del
juego (`public/js/three3d/characters.js`), que calcula todo por código.

`node scripts/personajes/retratos.mjs` (Playwright) dibuja los retratos del
selector del lobby en `public/img/personajes/`.
