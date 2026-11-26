# Ciudad: datos y arte

El modo Ciudad separa **datos**, **lógica** y **dibujo**:

| Qué | Dónde |
| --- | --- |
| El mapa: zonas, puertas, mesas, NPCs, luces de horneado, cámaras | `public/city/map.json` |
| Reglas: caminar, chocar, cruzar puertas, sentarse, recordar la posición | `public/js/city/logic.js` |
| Geometría y horneado de la luz en los vértices | `public/js/city/bake.js` |
| Texturas provisorias, dibujadas por código | `public/js/city/textures.js` |
| Personajes (los modelos de `public/models/personajes/`) | `public/js/city/actors.js` |
| La escena de entrada: cámara de cada toma, fundidos y textos | `public/js/city/intro.js` |
| La escena, las cámaras y los controles | `public/js/city/city.js` |

`logic.js`, `intro.js` y `bake.js` no usan three.js ni el navegador: `test/city.test.js`
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
- `intro` (opcional): la escena de entrada, que se ve al llegar desde el
  menú. `fade`: segundos de negro en cada corte. `shots`: las tomas, en
  orden; cada una tiene `zone`, `duration` (segundos), `from` y `to` (cada
  una `{ position, target, fov }`), opcionalmente `via` (un punto por donde
  pasa la cámara, para una curva) y `text` y `sub` (el texto grande y el
  chico; `{name}` y `{about}` se cambian por el nombre y la descripción del
  personaje). La última toma va en la zona de `start` con `"to": "play"`:
  termina en la cámara de juego de esa zona y no funde a negro. El jugador
  solo se ve en la zona donde empieza. Esa toma puede moverlo con
  `player`: `at` (dónde tiene los pies mientras está sentado y hacia dónde
  mira), `seat` (`height`, la altura de lo que lo sostiene, y `back`, cuánto
  detrás de los pies quedan las caderas), `rise` y `walk` (`[inicio, fin]`
  en segundos de la toma): se levanta y camina hasta `start`.
- `zones`: cada zona tiene:
  - `name`, `ambient` (la luz mínima: el color de las sombras), `fog`
    (color, `near`, `far`) y `subdiv` (tamaño de la cuadrícula de vértices,
    en metros).
  - `sun` (zonas al aire libre): `dir` (hacia dónde está el sol), `color` e
    `intensity`. Se hornea con las sombras que proyectan las cajas.
  - `sky`: colores del cielo, `top` y `horizon`.
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
    - `emissive`: color plano, no recibe horneado (ventanas con luz de día,
      ampolletas, cables).
    - `ao: false`: no oscurece lo que tiene cerca.
    - `shadow: false`: no proyecta sombra al sol.
    - `visible: false`: solo colisión.
  - `lights`: las **luces de horneado** de ampolletas y ventanas (`at`,
    `color`, `intensity`, `radius`). Como el sol, no existen en la escena:
    solo se usan para calcular los colores de los vértices y el tinte de
    los personajes.
  - `signs`: carteles pintados (`text`, `sub`, `at`, `normal`, `size`, y
    los colores `bg`, `fg` y `accent`; `vertical` escribe un carácter bajo
    otro y `arrow` agrega una flecha hacia abajo). Hasta 8 por zona: van
    todos en una textura.
  - `glows`: halos de ampolletas (`at`, `size`, `color`).
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
