const express = require('express');
const { normalizeExpression, stripWrappingQuotes } = require('../expression-text');
const { reply, replyError } = require('../http-reply');

/** @typedef {import('../types/app').Schemas} Schemas */

const maxTextLength = 300;

/**
 * @param {Schemas['ExpressionEntry']} entry
 * @returns {Schemas['HistorySource']}
 */
function historySource(entry) {
  return entry.source === 'ai' && entry.id !== null ? 'ai_saved' : entry.source;
}

/**
 * @param {{
 *   lookupService: ReturnType<typeof import('../lookup-service').createLookupService>,
 *   searchHistory: import('../types/app').SearchHistoryRepository,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createLookupRouter({ lookupService, searchHistory, requireAuthentication }) {
  const router = express.Router();

  router.post('/lookup', requireAuthentication, async (request, response) => {
    const raw = typeof request.body?.expression === 'string' ? request.body.expression : '';
    const text = stripWrappingQuotes(raw);

    if (!text || text.length > maxTextLength) {
      replyError(response, 400, `El texto debe tener entre 1 y ${maxTextLength} caracteres.`);
      return;
    }

    const { entries, unresolved, failure } = await lookupService.resolve(text, request.user.id);

    const userId = request.user.id;
    /** @type {{ expression: string, found: boolean, source: Schemas['HistorySource'] }[]} */
    const searches = [
      ...entries.map((entry) => ({
        expression: entry.expression,
        found: true,
        source: historySource(entry)
      })),
      ...unresolved.map(({ text: expression }) => ({
        expression,
        found: false,
        source: /** @type {const} */ ('not_found')
      }))
    ];
    if (searches.length === 0)
      searches.push({ expression: text, found: false, source: 'not_found' });
    for (const { expression, found, source } of searches) {
      await searchHistory.record({
        userId,
        expression,
        normalized: normalizeExpression(expression),
        found,
        source
      });
    }

    reply(response, 'LookupResponse', {
      found: entries.length > 0,
      entries,
      unresolved,
      ...failure
    });
  });

  return router;
}

module.exports = { createLookupRouter };
