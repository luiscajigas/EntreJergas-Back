const express = require('express');
const { normalizeExpression, parseQuotedExpression } = require('../expression-text');
const { reply, replyError } = require('../http-reply');

/** @typedef {import('../types/app').Schemas} Schemas */
/** @typedef {{ reason: Schemas['LookupFailureReason'], message: string }} LookupFailure */

/**
 * @param {{ code?: string, status?: number }} error
 * @returns {LookupFailure}
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

/**
 * @param {Schemas['ExpressionEntry'] | null} entry
 * @returns {Schemas['HistorySource']}
 */
function historySource(entry) {
  if (!entry) return 'not_found';
  return entry.source === 'ai' && entry.id !== null ? 'ai_saved' : entry.source;
}

/**
 * @param {{
 *   expressions: import('../types/app').ExpressionRepository,
 *   searchHistory: import('../types/app').SearchHistoryRepository,
 *   generateDefinition: import('../types/app').GenerateDefinition,
 *   aiLimiter: import('../types/app').RateLimiter,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createLookupRouter({ expressions, searchHistory, generateDefinition, aiLimiter, requireAuthentication }) {
  const router = express.Router();

  /**
   * @param {{ expression: string, normalized: string, explicitlySave: boolean }} search
   * @returns {Promise<Schemas['ExpressionEntry'] | null>}
   */
  const generateEntry = async ({ expression, normalized, explicitlySave }) => {
    const definition = await generateDefinition(expression);
    if (!definition) return null;
    if (explicitlySave) return expressions.saveGenerated(normalized, definition);
    return { id: null, ...definition, pronunciation: null, audioUrl: null, source: 'ai' };
  };

  router.post('/lookup', requireAuthentication, async (request, response) => {
    const raw = typeof request.body?.expression === 'string' ? request.body.expression : '';
    const { expression, explicitlySave } = parseQuotedExpression(raw);

    if (!expression || expression.length > 100) {
      replyError(response, 400, 'La expresión debe tener entre 1 y 100 caracteres.');
      return;
    }

    const normalized = normalizeExpression(expression);
    let entry = await expressions.findByNormalized(normalized);
    /** @type {LookupFailure | undefined} */
    let failure;

    if (!entry && !aiLimiter.tryConsume(request.user.id)) {
      failure = { reason: 'rate_limited', message: 'Hiciste muchas búsquedas nuevas seguidas. Espera un minuto; la expresión no se agregó.' };
    } else if (!entry) {
      try {
        entry = await generateEntry({ expression, normalized, explicitlySave });
        if (!entry) failure = { reason: 'not_found', message: 'Todavía no tenemos esta expresión en el diccionario.' };
      } catch (error) {
        const aiError = /** @type {Error & { code?: string, status?: number }} */ (error);
        console.error('No se pudo generar una definición con IA:', aiError.message);
        failure = describeFailure(aiError);
      }
    }

    await searchHistory.record({
      userId: request.user.id,
      expression,
      normalized,
      found: Boolean(entry),
      source: historySource(entry)
    });

    reply(response, 'LookupResponse', { found: Boolean(entry), entry, ...failure });
  });

  return router;
}

module.exports = { createLookupRouter };
