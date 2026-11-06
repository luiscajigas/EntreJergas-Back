const { spanishSpeakingCountries } = require('./countries');

const optionCount = 4;

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 * @returns {T[]}
 */
function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * Arma una ronda con las palabras del diccionario. Función pura: el azar se recibe
 * como parámetro para poder probarla. Una palabra puede usarse en varios países, por
 * eso las opciones incorrectas excluyen todos sus países y solo una opción es válida.
 *
 * @param {import('./types/app').GameCandidate[]} candidates
 * @param {{ exclude?: number[], random?: () => number }} [options]
 * @returns {import('./types/app').Schemas['GameRound'] | null}
 */
function buildRound(candidates, { exclude = [], random = Math.random } = {}) {
  if (candidates.length === 0) return null;

  const excluded = new Set(exclude);
  const fresh = candidates.filter((candidate) => !excluded.has(candidate.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[Math.floor(random() * pool.length)];
  const correct = chosen.countries[Math.floor(random() * chosen.countries.length)];

  // Primero países con palabras en el diccionario: así las opciones son creíbles.
  const inDictionary = shuffle([...new Set(candidates.flatMap((candidate) => candidate.countries))], random);
  const others = shuffle([...spanishSpeakingCountries], random);
  const wrong = [...new Set([...inDictionary, ...others])]
    .filter((country) => !chosen.countries.includes(country))
    .slice(0, optionCount - 1);

  return { id: chosen.id, expression: chosen.expression, options: shuffle([correct, ...wrong], random) };
}

module.exports = { buildRound };
