const express = require('express');

function createActivityRouter({ expressions, searchHistory, requireAuthentication }) {
  const router = express.Router();

  router.get('/history', requireAuthentication, async (request, response) => {
    response.json({ items: await searchHistory.listForUser(request.user.id) });
  });

  router.get('/dashboard', requireAuthentication, async (request, response) => {
    const [total, searches, regions] = await Promise.all([
      expressions.count(),
      searchHistory.countForUser(request.user.id),
      expressions.countByRegion()
    ]);
    response.json({ expressions: total, searches, regions });
  });

  return router;
}

module.exports = { createActivityRouter };
