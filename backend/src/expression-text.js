/** @param {string} value */
function normalizeExpression(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quita las comillas que envuelven todo el texto.
 * @param {string} value
 */
function stripWrappingQuotes(value) {
  const text = value.trim();
  /** @type {Record<string, string>} */
  const quotePairs = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»' };
  const closingQuote = quotePairs[text[0]];
  if (text.length < 2 || !closingQuote || !text.endsWith(closingQuote)) return text;

  const inner = text.slice(1, -1);
  // "uno" y "dos" empieza y termina con comillas, pero no son las mismas: no se tocan.
  return inner.includes(text[0]) || inner.includes(closingQuote) ? text : inner.trim();
}

module.exports = { normalizeExpression, stripWrappingQuotes };
