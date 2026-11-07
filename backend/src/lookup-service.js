const { normalizeExpression } = require('./expression-text');
const { differsByOneEdit } = require('./text-distance');

/** @typedef {import('./types/app').Schemas} Schemas */
/** @typedef {import('./types/app').AnalyzedExpression} AnalyzedExpression */

/**
 * @typedef {object} LookupOutcome
 * @property {Schemas['ExpressionEntry'][]} entries
 * @property {Schemas['UnresolvedExpression'][]} unresolved
 * @property {{ reason: Schemas['LookupFailureReason'], message: string } | null} failure
 */

/**
 * La IA clasifica; esta regla decide. Solo entra al diccionario compartido una
 * expresión regional, con confianza alta y al menos un país reconocido.
 * @param {AnalyzedExpression} item
 */
function shouldSave(item) {
  return item.type === 'regional' && item.confidence === 'high' && item.countries.length > 0 && item.definition !== null;
}

/**
 * @param {{ code?: string, status?: number }} error
 * @returns {NonNullable<LookupOutcome['failure']>}
 */
function describeFailure(error) {
  if (error.code === 'AI_NOT_CONFIGURED') {
    return { reason: 'not_configured', message: 'La IA no está configurada en el backend. Revisa la variable LLM_API_KEY; la expresión no se agregó.' };
  }
  if (error.code === 'AI_INVALID_RESPONSE') {
    return { reason: 'invalid_response', message: 'Gemini respondió con un formato que no pude validar. La expresión no se agregó; inténtalo de nuevo.' };
  }
  if (error.status === 429) {
    return { reason: 'quota_exceeded', message: 'Gemini alcanzó el límite de solicitudes de este proyecto. Espera a que se restablezca o revisa la cuota en AI Studio; la expresión no se agregó.' };
  }
  const detail = error.status ? ` (error ${error.status})` : '';
  return { reason: 'provider_unavailable', message: `Gemini no pudo responder${detail}. La expresión no se agregó; inténtalo de nuevo más tarde.` };
}

const minLengthForTypoCheck = 5;

const notFound = { reason: /** @type {const} */ ('not_found'), message: 'Todavía no tenemos esta expresión en el diccionario.' };

/**
 * @param {{
 *   expressions: import('./types/app').ExpressionRepository,
 *   analyzeText: import('./types/app').AnalyzeText,
 *   verifyExpression: import('./types/app').VerifyExpression,
 *   aiLimiter: import('./types/app').RateLimiter
 * }} dependencies
 */
function createLookupService({ expressions, analyzeText, verifyExpression, aiLimiter }) {
  /**
   * Cada verificación es una llamada a la IA, así que también cuenta para el límite.
   * @param {AnalyzedExpression} item
   * @param {number} userId
   * @returns {Promise<'confirmed' | 'rejected' | 'unavailable'>}
   */
  const verify = async (item, userId) => {
    if (!aiLimiter.tryConsume(userId)) return 'unavailable';
    try {
      return await verifyExpression(item) ? 'confirmed' : 'rejected';
    } catch (error) {
      console.error('No se pudo verificar la expresión:', /** @type {Error} */ (error).message);
      return 'unavailable';
    }
  };

  /**
   * La IA puede dar por real una palabra mal escrita. Si difiere en una letra de una
   * expresión del diccionario, se trata como error de escritura sin importar lo que diga.
   * @param {string} normalized
   */
  const findSimilarExpression = async (normalized) => {
    if (normalized.length < minLengthForTypoCheck) return null;
    const names = await expressions.listNames();
    return names.find((name) => differsByOneEdit(normalized, name.normalized))?.expression ?? null;
  };

  /**
   * @param {AnalyzedExpression} item
   * @param {string} normalized
   * @param {number} userId
   * @returns {Promise<Schemas['ExpressionEntry'] | null>}
   */
  const toEntry = async (item, normalized, userId) => {
    if (!item.definition) return null;

    const { countries, register } = item;
    if (item.type === 'regional') {
      const verification = await verify(item, userId);
      // Si el revisor no la reconoce, es mejor no responder que mostrar un significado inventado.
      if (verification === 'rejected') return null;
      if (verification === 'confirmed' && shouldSave(item)) {
        return expressions.saveGenerated(normalized, item.definition, { countries, register });
      }
    }
    return {
      id: null,
      ...item.definition,
      pronunciation: null,
      audioUrl: null,
      source: 'ai',
      countries,
      register,
      classification: item.type === 'common' ? 'common' : 'regional'
    };
  };

  return {
    /**
     * @param {string} text
     * @param {number} userId
     * @returns {Promise<LookupOutcome>}
     */
    async resolve(text, userId) {
      const normalizedText = normalizeExpression(text);
      const known = await expressions.findByNormalized(normalizedText);
      if (known) return { entries: [known], unresolved: [], failure: null };

      if (!aiLimiter.tryConsume(userId)) {
        return {
          entries: [],
          unresolved: [],
          failure: { reason: 'rate_limited', message: 'Hiciste muchas búsquedas nuevas seguidas. Espera un minuto; la expresión no se agregó.' }
        };
      }

      let items;
      try {
        items = await analyzeText(text);
      } catch (error) {
        const aiError = /** @type {Error & { code?: string, status?: number }} */ (error);
        console.error('No se pudo analizar el texto con IA:', aiError.message);
        return { entries: [], unresolved: [], failure: describeFailure(aiError) };
      }

      /** @type {LookupOutcome} */
      const outcome = { entries: [], unresolved: [], failure: null };
      const seen = new Set();
      for (const item of items) {
        const normalized = normalizeExpression(item.text);
        // Lo que la IA devuelva debe salir del texto: evita guardar expresiones que nadie buscó.
        if (!normalized || seen.has(normalized) || !normalizedText.includes(normalized)) continue;
        seen.add(normalized);

        const existing = await expressions.findByNormalized(normalized);
        // Una palabra común puede estar a una letra de una jerga: rumbo no es un error de rumba.
        const similar = existing || item.type === 'common' ? null : await findSimilarExpression(normalized);
        if (similar) {
          outcome.unresolved.push({ text: item.text, reason: 'typo', suggestion: similar });
          continue;
        }

        const entry = existing ?? await toEntry(item, normalized, userId);
        if (entry) {
          outcome.entries.push(entry);
        } else {
          outcome.unresolved.push({
            text: item.text,
            reason: item.type === 'typo' ? 'typo' : 'unknown',
            suggestion: item.type === 'typo' ? item.suggestion : null
          });
        }
      }

      if (outcome.entries.length === 0) outcome.failure = notFound;
      return outcome;
    }
  };
}

module.exports = { createLookupService, shouldSave };
