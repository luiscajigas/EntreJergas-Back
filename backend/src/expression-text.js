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
  return text.length >= 2 && closingQuote && text.endsWith(closingQuote) ? text.slice(1, -1).trim() : text;
}

module.exports = { normalizeExpression, stripWrappingQuotes };
