const express = require('express');
const { validateDefinition } = require('../ai-provider');

function pickTranslation({ meaning, region, context, equivalent, example }) {
  return { meaning, region, context, equivalent, example };
}

function createTranslateRouter({ expressions, translateDefinition, aiLimiter, requireAuthentication }) {
  const router = express.Router();

  const readTemporaryDefinition = (body) => {
    const expression = typeof body?.expression === 'string' ? body.expression.trim() : '';
    return expression && expression.length <= 100 ? validateDefinition(body, expression) : null;
  };

  router.post('/translate', requireAuthentication, async (request, response) => {
    const id = Number(request.body?.id);
    const savedExpression = Number.isSafeInteger(id) && id > 0;
    let source;

    if (savedExpression) {
      const cached = await expressions.findTranslation(id);
      if (cached) {
        response.json({ translation: cached });
        return;
      }
      source = await expressions.findById(id);
      if (!source) {
        response.status(404).json({ error: 'La expresión no existe.' });
        return;
      }
    } else {
      source = readTemporaryDefinition(request.body);
      if (!source) {
        response.status(400).json({ error: 'La definición a traducir no es válida.' });
        return;
      }
    }

    if (!aiLimiter.tryConsume(request.user.id)) {
      response.status(429).json({ error: 'Hiciste muchas traducciones seguidas. Espera un minuto.', code: 'rate_limited' });
      return;
    }

    let translation;
    try {
      translation = pickTranslation(await translateDefinition(source));
    } catch (error) {
      console.error('No se pudo traducir la definición:', error.message);
      response.status(502).json({ error: 'No se pudo traducir la definición.' });
      return;
    }

    if (savedExpression) await expressions.saveTranslation(id, translation);
    response.json({ translation });
  });

  return router;
}

module.exports = { createTranslateRouter };
