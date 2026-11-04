const express = require('express');
const { normalizeExpression, parseQuotedExpression } = require('../expression-text');

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

function historySource(entry) {
  if (!entry) return 'not_found';
  return entry.source === 'ai' && entry.id !== null ? 'ai_saved' : entry.source;
}

function createLookupRouter({ expressions, searchHistory, generateDefinition, requireAuthentication }) {
  const router = express.Router();

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
      response.status(400).json({ error: 'La expresión debe tener entre 1 y 100 caracteres.' });
      return;
    }

    const normalized = normalizeExpression(expression);
    let entry = await expressions.findByNormalized(normalized);
    let failure;

    if (!entry) {
      try {
        entry = await generateEntry({ expression, normalized, explicitlySave });
        if (!entry) failure = { reason: 'not_found', message: 'Todavía no tenemos esta expresión en el diccionario.' };
      } catch (error) {
        console.error('No se pudo generar una definición con IA:', error.message);
        failure = describeFailure(error);
      }
    }

    await searchHistory.record({
      userId: request.user.id,
      expression,
      normalized,
      found: Boolean(entry),
      source: historySource(entry)
    });

    response.json({ found: Boolean(entry), entry, ...failure });
  });

  return router;
}

module.exports = { createLookupRouter };
