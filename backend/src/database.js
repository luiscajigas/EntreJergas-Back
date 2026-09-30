const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Error inesperado en una conexión PostgreSQL inactiva:', error);
});

const seedExpressions = [
  ['parcero', 'parcero', 'Amigo cercano o compañero.', 'Antioquia y región Andina', 'Informal y amistoso; se usa para dirigirse a alguien de confianza.', 'amigo', 'Ese parcero siempre está cuando lo necesito.'],
  ['parce', 'parce', 'Forma abreviada de parcero: amigo o compañero.', 'Antioquia y región Andina', 'Muy informal y frecuente entre jóvenes y amigos.', 'amigo', 'Parce, ¿vamos por un café?'],
  ['que chimba', 'qué chimba', 'Algo muy bueno, emocionante o admirable.', 'Antioquia y región Andina', 'Informal; expresa entusiasmo. Puede ser vulgar según el contexto.', 'qué genial', '¡Qué chimba ese concierto!'],
  ['chimba', 'chimba', 'Algo excelente o, según el contexto, algo sin importancia.', 'Antioquia y región Andina', 'Jerga informal. El sentido depende del tono y la situación.', 'genial', 'La película estuvo una chimba.'],
  ['bacano', 'bacano', 'Agradable, bueno o que gusta mucho.', 'Caribe y región Andina', 'Informal y positivo; común en conversaciones cotidianas.', 'chévere', 'El plan estuvo muy bacano.'],
  ['chevere', 'chévere', 'Bueno, agradable o interesante.', 'Caribe y otros países de Latinoamérica', 'Informal; se usa para expresar aprobación.', 'genial', 'Tu idea suena chévere.'],
  ['berraco', 'berraco', 'Persona valiente, capaz o muy trabajadora; también algo difícil.', 'Santander y región Andina', 'Informal; cambia de sentido según la frase.', 'muy capaz', 'Mi abuela es una berraca.'],
  ['camellar', 'camellar', 'Trabajar, especialmente con esfuerzo.', 'Colombia', 'Informal; habitual en conversaciones sobre trabajo.', 'trabajar', 'Mañana me toca camellar temprano.'],
  ['guayabo', 'guayabo', 'Malestar del día siguiente a haber tomado alcohol; también tristeza.', 'Colombia', 'Coloquial; el sentido se entiende por el contexto.', 'resaca', 'Después de la fiesta amaneció con guayabo.'],
  ['vaina', 'vaina', 'Cosa, asunto o situación cuyo nombre no se especifica.', 'Caribe y región Andina', 'Muy coloquial; puede expresar molestia o sorpresa.', 'cosa', 'Pásame esa vaina que está en la mesa.'],
  ['paila', 'paila', 'Expresión para indicar que algo salió mal o se perdió.', 'Colombia', 'Informal; suele expresar resignación.', 'qué mal', 'Llegamos tarde y ya cerraron: paila.'],
  ['tinto', 'tinto', 'Café negro servido en una porción pequeña.', 'Colombia', 'Uso cotidiano; no significa vino tinto en este contexto.', 'café negro', '¿Me regalas un tinto, por favor?'],
  ['mamar gallo', 'mamar gallo', 'Bromear, tomar del pelo o no actuar con seriedad.', 'Caribe colombiano', 'Informal y juguetón entre personas de confianza.', 'bromear', 'Deja de mamar gallo y ayúdame.'],
  ['dar papaya', 'dar papaya', 'Exponerse innecesariamente a un riesgo o facilitar que algo ocurra.', 'Colombia', 'Coloquial; suele usarse como recomendación preventiva.', 'exponerse', 'No dejes el celular solo, no des papaya.'],
  ['rumba', 'rumba', 'Fiesta o salida para bailar y divertirse.', 'Caribe y Colombia', 'Informal; se usa para hablar de salir de fiesta.', 'fiesta', 'El sábado hay rumba en el barrio.'],
  ['chichai', 'chichai', 'Expresión regional cuyo significado depende de la zona y del contexto.', 'Por confirmar', 'Regionalismo pendiente de documentar; cuéntanos dónde lo escuchaste.', 'Por confirmar', '¿En qué contexto escuchaste “chichai”?']
];

async function initializeDatabase(databasePool = pool) {
  if (databasePool === pool && !process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Configura la URL de PostgreSQL en el entorno del backend.');
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS search_history (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        searched_expression TEXT NOT NULL,
        normalized_expression TEXT NOT NULL,
        found BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE search_history
        ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
        ON user_sessions(user_id);

      CREATE INDEX IF NOT EXISTS idx_search_history_created_at
        ON search_history(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_search_history_user_created_at
        ON search_history(user_id, created_at DESC);
    `);

    await client.query('BEGIN');
    for (const [normalized, expression, meaning, region, context, equivalent, example] of seedExpressions) {
      await client.query(`
        INSERT INTO expressions
          (normalized_expression, expression, meaning, region, context, equivalent, example)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (normalized_expression) DO NOTHING
      `, [normalized, expression, meaning, region, context, equivalent, example]);
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