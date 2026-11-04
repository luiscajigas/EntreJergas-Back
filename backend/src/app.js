const cors = require('cors');
const express = require('express');
const { createAiProvider, createAiTranslator } = require('./ai-provider');
const { createRequireAuthentication } = require('./auth/require-authentication');
const { createSessionStore } = require('./auth/sessions');
const { createExpressionRepository } = require('./repositories/expressions');
const { createSearchHistoryRepository } = require('./repositories/search-history');
const { createUserRepository } = require('./repositories/users');
const { createAuthRouter } = require('./routes/auth');
const { createLookupRouter } = require('./routes/lookup');
const { createTranslateRouter } = require('./routes/translate');

function createApp(pool, {
  generateDefinition = createAiProvider(),
  translateDefinition = createAiTranslator()
} = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim());

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '10kb' }));

  const sessions = createSessionStore(pool);
  const requireAuthentication = createRequireAuthentication(sessions);

  app.get('/api/health', async (_request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', service: 'entrejergas-api' });
  });

  app.use('/api/auth', createAuthRouter({ users: createUserRepository(pool), sessions, requireAuthentication }));

  const expressions = createExpressionRepository(pool);
  const searchHistory = createSearchHistoryRepository(pool);
  app.use('/api', createLookupRouter({ expressions, searchHistory, generateDefinition, requireAuthentication }));

  app.use('/api', createTranslateRouter({ expressions, translateDefinition, requireAuthentication }));

  app.get('/api/history', requireAuthentication, async (request, response) => {
    const result = await pool.query(`
      SELECT id, searched_expression AS expression, found, result_source AS source,
        created_at AS "createdAt"
      FROM search_history
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 30
    `, [request.user.id]);

    response.json({ items: result.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  });

  app.get('/api/dashboard', requireAuthentication, async (request, response) => {
    const [expressionsResult, searchesResult, regionsResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM expressions'),
      pool.query('SELECT COUNT(*)::int AS count FROM search_history WHERE user_id = $1', [request.user.id]),
      pool.query(`
        SELECT region, COUNT(*)::int AS count
        FROM expressions
        GROUP BY region
        ORDER BY count DESC, region ASC
      `)
    ]);

    response.json({
      expressions: expressionsResult.rows[0].count,
      searches: searchesResult.rows[0].count,
      regions: regionsResult.rows
    });
  });

  app.use((error, _request, response, _next) => {
    if (error.status >= 400 && error.status < 500) {
      response.status(error.status).json({ error: 'La solicitud no es válida.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
  });

  return app;
}

module.exports = { createApp };