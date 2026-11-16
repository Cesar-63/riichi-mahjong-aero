# Ciudad: datos y arte

El modo Ciudad separa **datos**, **lógica** y **dibujo**:

| Qué | Dónde |
| --- | --- |
| El mapa: zonas, puertas, mesas, NPCs, luces de horneado, cámaras | `public/city/map.json` |
| Reglas: caminar, chocar, cruzar puertas, sentarse, recordar la posición | `public/js/city/logic.js` |
| Geometría y horneado de la luz en los vértices | `public/js/city/bake.js` |
| Texturas provisorias, dibujadas por código | `public/js/city/textures.js` |
| Personajes (los modelos de `public/models/personajes/`) | `public/js/city/actors.js` |
| La escena, las cámaras y los controles | `public/js/city/city.js` |

`logic.js` y `bake.js` no usan three.js ni el navegador: `test/city.test.js`
los prueba en node, y revisa el mapa con `mapProblems` (puertas que llevan
a un lugar donde se puede estar de pie, asientos libres, etc.).

## El mapa

Unidades en metros. En el suelo, `x` y `z`; `y` hacia arriba. `facing` en
radianes: 0 mira a +z y crece hacia +x.

- `characters`: los personajes que se pueden elegir (ids de
  `public/js/shared/characters.js`).
- `render`: la resolución interna por defecto (`height`, en líneas) y las
  que ofrece el menú (`options`).
- `start`: zona y posición donde empieza el jugador.
- `zones`: cada zona tiene:
  - `name`, `ambient` (la luz mínima), `fog` (color, `near`, `far`) y
    `subdiv` (tamaño de la cuadrícula de vértices, en metros).
  - `bounds`: el rectángulo por donde se puede caminar.
  - `camera`: `{ "type": "fixed", position, target, fov, track }` (`track`
    de 0 a 1: cuánto gira hacia el jugador) o `{ "type": "follow",
    distance, height, look, fov }` (tercera persona).
  - `boxes`: la geometría. Cada caja tiene `min`, `max` y `tex` (un nombre
    de `textures.js`). Opcionales:
    - `color`: tiñe la textura.
    - `inside`: es una habitación, vista por dentro.
    - `skip`: caras que no se dibujan (`"x+"`, `"y-"`…).
    - `faceTex`: otra textura para alguna cara.
    - `uv`: metros por repetición de la textura; `fit` estira una sola
      copia sobre cada cara (puertas, ventanas).
    - `solid`: el jugador choca con ella.
    - `emissive`: brillo completo, no recibe horneado (neón, pantallas,
      ventanas encendidas).
    - `ao: false`: no oscurece lo que tiene cerca.
    - `visible: false`: solo colisión.
  - `lights`: las **luces de horneado** (`at`, `color`, `intensity`,
    `radius`). No existen en la escena: solo se usan para calcular los
    colores de los vértices y el tinte de los personajes.
  - `neons`: carteles (`text`, `sub`, `color`, `at`, `normal`, `size`,
    `glow`). Con `light`, el cartel también ilumina en el horneado.
  - `glows`: halos de lámparas (`at`, `size`, `color`).
  - `doors`: `x`, `z`, `radius` y `to` (zona, posición, `facing` y, para
    cámaras en tercera persona, `cam`: hacia dónde mira la cámara al llegar).
  - `tables`: mesas de mahjong (`x`, `z`, `radius` de choque, `seat` y
    `reach`: a qué distancia del asiento aparece el aviso).
  - `npcs`: `character`, posición, `facing` y `pose` (`"sit"`).
  - `colliders`: círculos de choque extra (`x`, `z`, `r`).

Para **agregar una zona**: una entrada nueva en `zones` y una puerta de ida
y otra de vuelta. No hace falta tocar código.

## Reemplazar el arte

- **Texturas:** cada nombre de `tex` es una función en `textures.js`. Para
  usar una imagen pintada, que `texture(nombre)` devuelva esa imagen
  (64 a 256 px, filtrado bilineal).
- **Zonas hechas en Blender:** una zona puede llevar `"model":
  "city/models/calle.glb"`. El modelo se dibuja sin luces, con su textura
  por sus colores de vértice (`COLOR_0`, el vertex paint), igual que la
  geometría de cajas. Las cajas de la zona pasan entonces a `"visible":
  false` y quedan solo como colisión; puertas, mesas, NPCs y cámaras siguen
  en el mapa. Las `lights` se mantienen para teñir a los personajes.
  **Esto aún no se ha probado con un modelo real.**
- **Personajes:** son los `.glb` de `public/models/personajes/`; cambiar un
  modelo ahí lo cambia en la mesa y en la ciudad.
