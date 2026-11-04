const express = require('express');
const { reply } = require('../http-reply');

/**
 * @param {{
 *   expressions: import('../types/app').ExpressionRepository,
 *   searchHistory: import('../types/app').SearchHistoryRepository,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createActivityRouter({ expressions, searchHistory, requireAuthentication }) {
  const router = express.Router();

  router.get('/history', requireAuthentication, async (request, response) => {
    reply(response, 'HistoryResponse', { items: await searchHistory.listForUser(request.user.id) });
  });

  router.get('/dashboard', requireAuthentication, async (request, response) => {
    const [total, searches, regions, countries] = await Promise.all([
      expressions.count(),
      searchHistory.countForUser(request.user.id),
      expressions.countByRegion(),
      expressions.countByCountry()
    ]);
    reply(response, 'DashboardResponse', { expressions: total, searches, regions, countries });
  });

  return router;
}

module.exports = { createActivityRouter };
