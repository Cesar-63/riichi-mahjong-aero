// The characters a player can sit at the table as (models in
// public/models/personajes/, built by scripts/personajes/build.py). Shared
// by the server, which checks the choice, and the client.
export const CHARACTERS = [
  { id: 'genzo', name: 'Genzo', about: 'El viejo del salón: camisa gris y cigarro en la boca' },
  { id: 'shiro', name: 'Shiro', about: 'Pelo blanco, camisa celeste abierta, pocas palabras' },
  { id: 'ryuji', name: 'Ryuji', about: 'Terno blanco, corbata a rayas y una cicatriz' },
  { id: 'momo', name: 'Momo', about: 'Estudiante de uniforme marinero y pelo rosado' },
  { id: 'kaito', name: 'Kaito', about: 'Camisa verde abierta, polera negra y jeans' },
  { id: 'tatsuo', name: 'Tatsuo', about: 'Un señor de traje negro, camisa roja y detalles dorados' },
];
export const DEFAULT_CHARACTER = CHARACTERS[0].id;
export const isCharacter = (id) => CHARACTERS.some((c) => c.id === id);
export const characterId = (id) => (isCharacter(id) ? id : DEFAULT_CHARACTER);
// The characters for seats that have none (bots): the ones nobody at the
// table uses, in the order given (the server shuffles it), then repeats.
export function fillCharacters(chosen, order = CHARACTERS.map((c) => c.id)) {
  const free = order.filter((id) => !chosen.includes(id));
  let k = 0;
  return chosen.map((id) => (isCharacter(id) ? id : free.length ? free[k++ % free.length] : order[k++ % order.length]));
}
