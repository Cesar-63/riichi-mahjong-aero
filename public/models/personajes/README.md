# Personajes

Personajes de prueba para el laboratorio de animaciones (**Rivales en la
mesa** en `/lab.html`, `--rivales` en `npm run lab:capture`, y los
episodios). Por ahora no aparecen en el juego.

Vienen de [Mesh2Motion](https://github.com/scottpetrovic/mesh2motion-app)
(commit `1168413`). Su código es MIT y su arte (modelos, rigs y animaciones)
es **CC0**: se puede usar, modificar y redistribuir, también en un producto
cerrado o a la venta, sin pedir permiso ni citar. Los cuatro modelos son de
*elbolilloduro* (Mesh2Motion no les asigna otra licencia, así que tienen la
CC0 del repositorio). Mesh2Motion también trae modelos con otras licencias
(Sintel, Jay y Bunny son CC-BY; Sophia es CC-SA): esos no se usan.

Todos comparten el mismo esqueleto humanoide (`root`, `pelvis`,
`spine_01`…), así que cualquier animación sirve para cualquier personaje.

| Archivo | Qué es | Origen en Mesh2Motion |
| --- | --- | --- |
| `psx-32.glb` | Señor mayor de suéter (rival de enfrente) | `static/assets/human/variations/psx-32.glb` |
| `psx-10.glb` | Hombre de polera gris (rival de la derecha) | `static/assets/human/variations/psx-10.glb` |
| `psx-05.glb` | Oficinista de camisa (rival de la izquierda) | `static/assets/human/variations/psx-05.glb` |
| `psx-15.glb` | Joven de chaqueta de cuero (tú, solo en los episodios) | `static/assets/human/variations/psx-15.glb` |
| `sitting-idle.glb` | Sentado, respirando (2 s, en bucle) | `static/assets/human/animations/sitting-idle.glb` |
| `sitting-talking.glb` | Sentado, hablando (3,6 s) | `static/assets/human/animations/sitting-talking.glb` |
| `victory.glb`, `yes.glb` | Celebrar: brazo arriba, puño | `static/assets/human/animations/` (mismo nombre) |
| `clapping.glb` | Aplaudir | ídem |
| `reject.glb`, `angry.glb` | "No, no" con las manos; rabieta | ídem |
| `confused.glb` | Rascarse la cabeza | ídem |
| `head-nod.glb` | Asentir | ídem |
| `idle-foldarms.glb` | Brazos cruzados, esperando | ídem |

Las reacciones son animaciones de pie: el juego las usa solo en la parte de
arriba del cuerpo (columna, brazos y cabeza) y las piernas siguen sentadas
(`public/js/three3d/characters.js`).

Los modelos se copiaron tal cual: unos 900 triángulos y una textura de
512×512 cada uno. Las animaciones venían comprimidas con
`EXT_meshopt_compression`; se descomprimieron con
[glTF-Transform](https://gltf-transform.dev) (`@gltf-transform/core` 4,
quitando la extensión al escribir), así el juego no necesita el
decodificador.
