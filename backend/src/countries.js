/** Países donde el español es lengua principal u oficial (ISO 3166-1 alfa-2). */
const spanishSpeakingCountries = new Set([
  'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GQ', 'GT',
  'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE'
]);

/**
 * Conserva solo los códigos válidos: lo que diga la IA no llega directo a la base de datos.
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCountries(value) {
  if (!Array.isArray(value)) return [];
  const codes = value
    .filter((code) => typeof code === 'string')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => spanishSpeakingCountries.has(code));
  return [...new Set(codes)];
}

module.exports = { normalizeCountries, spanishSpeakingCountries };
