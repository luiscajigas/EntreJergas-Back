const express = require('express');
const { isCountryCode } = require('../countries');
const { buildRound } = require('../game');
const { reply, replyError } = require('../http-reply');
const { isPositiveId } = require('../validation');

const maxExcluded = 100;

/** @param {unknown} value */
function readExcludedIds(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map(Number).filter(Number.isSafeInteger).slice(0, maxExcluded);
}

/**
 * @param {{
 *   expressions: import('../types/app').ExpressionRepository,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createGameRouter({ expressions, requireAuthentication }) {
  const router = express.Router();

  router.get('/game/round', requireAuthentication, async (request, response) => {
    const candidates = await expressions.listGameCandidates();
    reply(response, 'GameRoundResponse', {
      round: buildRound(candidates, { exclude: readExcludedIds(request.query.exclude) })
    });
  });

  router.post('/game/answer', requireAuthentication, async (request, response) => {
    const { id, country } = request.body ?? {};
    if (!isPositiveId(id) || !isCountryCode(country)) {
      replyError(response, 400, 'La respuesta no es válida.');
      return;
    }

    const entry = await expressions.findById(id);
    if (!entry) {
      replyError(response, 404, 'La expresión no existe.');
      return;
    }
    reply(response, 'GameAnswerResponse', { correct: entry.countries.includes(country), entry });
  });

  return router;
}

module.exports = { createGameRouter };
