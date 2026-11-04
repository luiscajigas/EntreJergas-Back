function normalizeExpression(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseQuotedExpression(value) {
  const text = value.trim();
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
