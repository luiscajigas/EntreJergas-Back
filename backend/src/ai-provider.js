const { AiError, createJsonClient } = require('./ai/json-client');
const { analysisPrompt, translationPrompt, verificationPrompt } = require('./ai/prompts');
const { normalizeCountries } = require('./countries');
const { maxExpressionLength } = require('./expression-text');

/** @typedef {import('./types/app').Definition} Definition */
/** @typedef {import('./ai/json-client').AiOptions} AiOptions */

const maxExpressions = 3;
const maxFieldLength = 600;
const definitionFields = ['meaning', 'region', 'context', 'equivalent', 'example'];

/**
 * @param {unknown} value
 * @param {string} expression
 * @returns {Definition | null}
 */
function validateDefinition(value, expression) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, string>} */
  const texts = {};
  for (const field of definitionFields) {
    const text = record[field];
    if (typeof text !== 'string' || !text.trim()) return null;
    texts[field] = text.trim().slice(0, maxFieldLength);
  }

  return /** @type {Definition} */ ({ expression, ...texts });
}

/**
 * @param {AiOptions} [options]
 * @returns {import('./types/app').TranslateDefinition}
 */
function createAiTranslator(options) {
  const requestJson = createJsonClient(options);

  return async (definition) => {
    const parsed = await requestJson({
      system: translationPrompt,
      user: JSON.stringify({
        expression: definition.expression,
        meaning: definition.meaning,
        region: definition.region,
        context: definition.context,
        equivalent: definition.equivalent,
        example: definition.example
      }),
      maxTokens: 800
    });

    const translation = validateDefinition(parsed, definition.expression);
    if (!translation) {
      throw new AiError('Gemini no devolvió todos los campos traducidos.', { code: 'AI_INVALID_RESPONSE', status: 502 });
    }

    return translation;
  };
}

/**
 * Valida una expresión analizada; lo que no cumpla la forma esperada se descarta.
 * @param {unknown} value
 * @returns {import('./types/app').AnalyzedExpression | null}
 */
function parseAnalyzedExpression(value) {
  if (!value || typeof value !== 'object') return null;
  const item = /** @type {Record<string, unknown>} */ (value);
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!text || text.length > maxExpressionLength) return null;

  const { type, confidence, register, suggestion } = item;
  if (type !== 'regional' && type !== 'common' && type !== 'typo' && type !== 'unknown') return null;

  const definition = type === 'regional' || type === 'common' ? validateDefinition(item, text) : null;
  if ((type === 'regional' || type === 'common') && !definition) return null;

  return {
    text,
    type,
    confidence: confidence === 'high' || confidence === 'medium' ? confidence : 'low',
    suggestion: typeof suggestion === 'string' && suggestion.trim() ? suggestion.trim() : null,
    countries: normalizeCountries(item.countries),
    register: register === 'neutral' || register === 'informal' || register === 'vulgar' ? register : null,
    definition
  };
}

/**
 * @param {AiOptions} [options]
 * @returns {import('./types/app').AnalyzeText}
 */
function createAiAnalyzer(options) {
  const requestJson = createJsonClient(options);

  return async (text) => {
    const parsed = await requestJson({
      system: analysisPrompt,
      user: `Texto del usuario:\n${text}`,
      maxTokens: 1400
    });

    const rawItems = parsed?.expressions;
    if (!Array.isArray(rawItems)) {
      throw new AiError('Gemini no devolvió la lista de expresiones.', { code: 'AI_INVALID_RESPONSE', status: 502 });
    }

    const items = rawItems.map(parseAnalyzedExpression).filter((item) => item !== null);
    if (rawItems.length > 0 && items.length === 0) {
      throw new AiError('Gemini no devolvió expresiones válidas.', { code: 'AI_INVALID_RESPONSE', status: 502 });
    }

    return items.slice(0, maxExpressions);
  };
}

/**
 * Segunda opinión independiente antes de guardar: en las pruebas con Gemini real, quien
 * clasifica a veces da por cierta una expresión inventada; quien revisa con este encargo, no.
 * @param {AiOptions} [options]
 * @returns {import('./types/app').VerifyExpression}
 */
function createAiVerifier(options) {
  const requestJson = createJsonClient(options);

  return async (item) => {
    const parsed = await requestJson({
      system: verificationPrompt,
      user: JSON.stringify({ expression: item.text, meaning: item.definition?.meaning, countries: item.countries }),
      maxTokens: 200
    });
    return parsed?.verified === true;
  };
}

module.exports = { createAiAnalyzer, createAiTranslator, createAiVerifier, validateDefinition };
