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

/** @param {string} value */
function parseQuotedExpression(value) {
  const text = value.trim();
  /** @type {Record<string, string>} */
  const quotePairs = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»' };
  const closingQuote = quotePairs[text[0]];

  if (text.length < 2 || !closingQuote || !text.endsWith(closingQuote)) {
    return { expression: text, explicitlySave: false };
  }

  return {
    expression: text.slice(1, -1).trim(),
    explicitlySave: true
  };
}

module.exports = { normalizeExpression, parseQuotedExpression };
