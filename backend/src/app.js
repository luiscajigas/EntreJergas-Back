const cors = require('cors');
const express = require('express');
const { createAiProvider, createAiTranslator } = require('./ai-provider');
const { createRequireAuthentication } = require('./auth/require-authentication');
const { createSessionStore } = require('./auth/sessions');
const { errorHandler } = require('./error-handler');
const { createRateLimiter } = require('./rate-limiter');
const { createExpressionRepository } = require('./repositories/expressions');
const { createSearchHistoryRepository } = require('./repositories/search-history');
const { createUserRepository } = require('./repositories/users');
const { createActivityRouter } = require('./routes/activity');
const { createAuthRouter } = require('./routes/auth');
const { createLookupRouter } = require('./routes/lookup');
const { createTranslateRouter } = require('./routes/translate');

function createApp(pool, {
  generateDefinition = createAiProvider(),
  translateDefinition = createAiTranslator(),
  aiLimiter = createRateLimiter({ max: 30, windowMs: 60 * 1000 }),
  loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 })
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

  app.use('/api/auth', createAuthRouter({ users: createUserRepository(pool), sessions, loginLimiter, requireAuthentication }));

  const expressions = createExpressionRepository(pool);
  const searchHistory = createSearchHistoryRepository(pool);
  app.use('/api', createLookupRouter({ expressions, searchHistory, generateDefinition, aiLimiter, requireAuthentication }));
  app.use('/api', createTranslateRouter({ expressions, translateDefinition, aiLimiter, requireAuthentication }));

  app.use('/api', createActivityRouter({ expressions, searchHistory, requireAuthentication }));

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };