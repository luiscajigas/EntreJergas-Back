const cors = require('cors');
const express = require('express');

function normalizeExpression(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function serializeExpression(row) {
  return {
    id: Number(row.id),
    expression: row.expression,
    meaning: row.meaning,
    region: row.region,
    context: row.context,
    equivalent: row.equivalent,
    example: row.example,
    pronunciation: row.pronunciation,
    audioUrl: row.audio_url,
    source: 'database'
  };
}

function createApp(pool) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim());

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', async (_request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', service: 'entrejergas-api' });
  });

  app.post('/api/lookup', async (request, response) => {
    const expression = typeof request.body?.expression === 'string'
      ? request.body.expression.trim()
      : '';

    if (!expression || expression.length > 100) {
      return response.status(400).json({
        error: 'La expresión debe tener entre 1 y 100 caracteres.'
      });
    }

    const normalized = normalizeExpression(expression);
    const result = await pool.query(
      'SELECT * FROM expressions WHERE normalized_expression = $1',
      [normalized]
    );
    const entry = result.rows[0] || null;

    await pool.query(`
      INSERT INTO search_history (searched_expression, normalized_expression, found)
      VALUES ($1, $2, $3)
    `, [expression, normalized, Boolean(entry)]);

    return response.json({
      found: Boolean(entry),
      entry: entry ? serializeExpression(entry) : null,
      message: entry ? undefined : 'Todavía no tenemos esta expresión en el diccionario.'
    });
  });

  app.get('/api/history', async (_request, response) => {
    const result = await pool.query(`
      SELECT id, searched_expression AS expression, found, created_at AS "createdAt"
      FROM search_history
      ORDER BY id DESC
      LIMIT 30
    `);

    response.json({ items: result.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  });

  app.get('/api/dashboard', async (_request, response) => {
    const [expressionsResult, searchesResult, regionsResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM expressions'),
      pool.query('SELECT COUNT(*)::int AS count FROM search_history'),
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
    console.error(error);
    response.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
  });

  return app;
}

module.exports = { createApp };