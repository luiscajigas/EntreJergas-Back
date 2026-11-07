const express = require('express');
const { validateDefinition } = require('../ai-provider');
const { maxExpressionLength } = require('../expression-text');
const { reply, replyError } = require('../http-reply');
const { isPositiveId } = require('../validation');

/** @typedef {import('../types/app').Schemas} Schemas */

/**
 * @param {Schemas['DefinitionText']} definition
 * @returns {Schemas['DefinitionText']}
 */
function pickTranslation({ meaning, region, context, equivalent, example }) {
  return { meaning, region, context, equivalent, example };
}

/**
 * @param {{
 *   expressions: import('../types/app').ExpressionRepository,
 *   translateDefinition: import('../types/app').TranslateDefinition,
 *   aiLimiter: import('../types/app').RateLimiter,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createTranslateRouter({ expressions, translateDefinition, aiLimiter, requireAuthentication }) {
  const router = express.Router();

  /** @param {{ expression?: unknown } | undefined} body */
  const readTemporaryDefinition = (body) => {
    const expression = typeof body?.expression === 'string' ? body.expression.trim() : '';
    return expression && expression.length <= maxExpressionLength ? validateDefinition(body, expression) : null;
  };

  router.post('/translate', requireAuthentication, async (request, response) => {
    const id = request.body?.id;
    let source;

    if (isPositiveId(id)) {
      const cached = await expressions.findTranslation(id);
      if (cached) {
        reply(response, 'TranslateResponse', { translation: cached });
        return;
      }
      source = await expressions.findById(id);
      if (!source) {
        replyError(response, 404, 'La expresión no existe.');
        return;
      }
    } else {
      source = readTemporaryDefinition(request.body);
      if (!source) {
        replyError(response, 400, 'La definición a traducir no es válida.');
        return;
      }
    }

    if (!aiLimiter.tryConsume(request.user.id)) {
      replyError(response, 429, 'Hiciste muchas traducciones seguidas. Espera un minuto.', 'rate_limited');
      return;
    }

    let translation;
    try {
      translation = pickTranslation(await translateDefinition(source));
    } catch (error) {
      console.error('No se pudo traducir la definición:', /** @type {Error} */ (error).message);
      replyError(response, 502, 'No se pudo traducir la definición.');
      return;
    }

    if (isPositiveId(id)) await expressions.saveTranslation(id, translation);
    reply(response, 'TranslateResponse', { translation });
  });

  return router;
}

module.exports = { createTranslateRouter };
