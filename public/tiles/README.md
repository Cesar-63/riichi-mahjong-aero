# Imágenes de fichas

Deja aquí las imágenes y el juego las usará automáticamente (si no hay, dibuja
las fichas con CSS).

## Opción A: set por capas (por defecto)

Compatible directo con [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
(carpeta `Regular/` o `Black/`): copia los `.svg` aquí. Se detecta por la
existencia de `Front.svg`; cada ficha se dibuja como `Front` + cara encima.

Nombres esperados (`.svg`):

| Fichas | Archivos |
| --- | --- |
| Caracteres (萬) | `Man1` … `Man9`, `Man5-Dora` (5 rojo) |
| Círculos (筒) | `Pin1` … `Pin9`, `Pin5-Dora` |
| Bambúes (索) | `Sou1` … `Sou9`, `Sou5-Dora` |
| Vientos | `Ton` (東), `Nan` (南), `Shaa` (西), `Pei` (北) |
| Dragones | `Haku` (白), `Hatsu` (發), `Chun` (中) |
| Fondo / reverso | `Front`, `Back` |

## Opción B: set plano (cada imagen es la ficha completa)

Mismos nombres, en el formato que quieras, y crea `tileset.json`:

```json
{ "ext": "png", "layered": false }
```

Con `layered: false` no se usa `Front`; `Back` sigue siendo el reverso.
Proporción esperada: 3:4 (ancho:alto).
