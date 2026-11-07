const { Pool } = require('pg');
const { seedExpressions } = require('./seed-expressions');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Valida el certificado. Si la URL trae sslmode, pg usa ese valor en lugar de este.
  ssl: process.env.PGSSLMODE === 'require' || process.env.NODE_ENV === 'production',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Error inesperado en una conexión PostgreSQL inactiva:', error);
});

/** @param {Pick<import('pg').Pool, 'connect'>} [databasePool] */
async function initializeDatabase(databasePool = pool) {
  if (databasePool === pool && !process.env.DATABASE_URL) {
    throw new Error(
      'Falta DATABASE_URL. Configura la URL de PostgreSQL en el entorno del backend.'
    );
  }

  const client = await databasePool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS expressions (
        id BIGSERIAL PRIMARY KEY,
        normalized_expression TEXT NOT NULL UNIQUE,
        expression TEXT NOT NULL,
        meaning TEXT NOT NULL,
        region TEXT NOT NULL,
        context TEXT NOT NULL,
        equivalent TEXT NOT NULL,
        example TEXT NOT NULL,
        pronunciation TEXT,
        audio_url TEXT,
        source TEXT NOT NULL DEFAULT 'database',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE expressions
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'database';

      ALTER TABLE expressions
        ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}';

      ALTER TABLE expressions
        ADD COLUMN IF NOT EXISTS language_register TEXT;

      CREATE TABLE IF NOT EXISTS search_history (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        searched_expression TEXT NOT NULL,
        normalized_expression TEXT NOT NULL,
        found BOOLEAN NOT NULL,
        result_source TEXT NOT NULL DEFAULT 'not_found',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE search_history
        ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE search_history
        ADD COLUMN IF NOT EXISTS result_source TEXT NOT NULL DEFAULT 'not_found';

      UPDATE search_history
      SET result_source = CASE WHEN found THEN 'database' ELSE 'not_found' END
      WHERE result_source = 'not_found' AND found = TRUE;

      CREATE TABLE IF NOT EXISTS expression_translations (
        expression_id BIGINT NOT NULL REFERENCES expressions(id) ON DELETE CASCADE,
        language TEXT NOT NULL,
        meaning TEXT NOT NULL,
        region TEXT NOT NULL,
        context TEXT NOT NULL,
        equivalent TEXT NOT NULL,
        example TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (expression_id, language)
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
        ON user_sessions(user_id);

      CREATE INDEX IF NOT EXISTS idx_search_history_created_at
        ON search_history(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_search_history_user_created_at
        ON search_history(user_id, created_at DESC);
    `);

    await client.query('BEGIN');
    for (const [
      normalized,
      expression,
      meaning,
      region,
      context,
      equivalent,
      example,
      countries,
      register
    ] of seedExpressions) {
      await client.query(
        `
        INSERT INTO expressions
          (normalized_expression, expression, meaning, region, context, equivalent, example, countries, language_register)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (normalized_expression) DO NOTHING
      `,
        [normalized, expression, meaning, region, context, equivalent, example, countries, register]
      );

      // Completa las filas creadas antes de que existieran estas columnas, sin tocar su definición.
      await client.query(
        `
        UPDATE expressions
        SET countries = $1, language_register = $2
        WHERE normalized_expression = $3 AND language_register IS NULL
      `,
        [countries, register, normalized]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initializeDatabase, pool };
