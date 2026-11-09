# Instrucciones para Claude

## Idioma

El código, los comentarios y los nombres van en inglés. Los textos del juego,
el README, los issues, los PRs y los mensajes de commit van en español.

## Organización del trabajo: issues + tablero kanban

El trabajo pendiente vive en los issues de GitHub de este repo, ordenados en
un tablero de GitHub Projects (ver "Organización del trabajo" en el README).

- **Antes de empezar,** busca si ya hay un issue para la tarea. Si no hay,
  créalo con:
  - qué hay hoy (archivos y funciones concretas);
  - qué se busca;
  - una lista `- [ ]` de "Hecho cuando".
- **Etiquetas:** solo de tipo (`mejora`, `bug`, `docs`) y de área (`mesa-3d`,
  `partida`, `puntaje`, `por-equipos`, `sala`, `menú`, `bots`, `laboratorio`).
  **No uses etiquetas de estado:** el estado lo dan las columnas del tablero
  (Todo, En curso, En revisión, Done).
- **Al empezar un issue,** avisa en un comentario. Claude no puede mover las
  tarjetas del tablero, así que pídele al usuario que lo pase a "En curso".
- **Cada PR** lleva `Closes #N` en la descripción por cada issue que resuelve.
  Así, al mergear, el issue se cierra y la tarjeta pasa sola a Done.
- **Si un cambio resuelve algo que no tenía issue,** crea el issue igual y
  ciérralo con el PR, para que quede el registro.
- **Si encuentras algo pendiente** (un bug o una idea) mientras trabajas en
  otra cosa, abre un issue nuevo en vez de meterlo en el PR actual.

## Antes de un PR

- `npm test` tiene que pasar.
- Los cambios visuales de la mesa se comprueban en `/lab.html`.
- Actualiza el README si cambia algo que el jugador ve.
