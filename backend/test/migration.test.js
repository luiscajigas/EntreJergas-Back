const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { initializeDatabase } = require('../src/database');
const { seedExpressions } = require('../src/seed-expressions');

/** PostgreSQL real, en memoria: aquí importa el comportamiento exacto de la migración. */
let database;

before(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE expressions (
      id BIGSERIAL PRIMARY KEY, normalized_expression TEXT NOT NULL UNIQUE, expression TEXT NOT NULL,
      meaning TEXT NOT NULL, region TEXT NOT NULL, context TEXT NOT NULL, equivalent TEXT NOT NULL,
      example TEXT NOT NULL, pronunciation TEXT, audio_url TEXT, source TEXT NOT NULL DEFAULT 'database',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO expressions (normalized_expression, expression, meaning, region, context, equivalent, example, source) VALUES
      ('boludo', 'boludo', 'Definición ya guardada.', 'Argentina', 'c', 'e', 'x', 'ai'),
      ('palabra propia', 'palabra propia', 'Otra.', 'Perú', 'c', 'e', 'x', 'ai');
  `);

  const query = async (text, params) => {
    if (params?.length) return database.query(text, params);
    const results = await database.exec(text);
    return results[results.length - 1] ?? { rows: [] };
  };
  const pool = { connect: async () => ({ query, release() {} }) };
  await initializeDatabase(pool);
  await initializeDatabase(pool);
});

after(async () => {
  await database.close();
});

const find = async (normalized) => (await database.query('SELECT * FROM expressions WHERE normalized_expression = $1', [normalized])).rows[0];

test('completa los países de las semillas sin cambiar la definición guardada', async () => {
  const boludo = await find('boludo');
  assert.equal(boludo.meaning, 'Definición ya guardada.');
  assert.deepEqual(boludo.countries, ['AR', 'UY']);
});

test('deja igual lo que no pertenece a las semillas', async () => {
  const own = await find('palabra propia');
  assert.equal(own.meaning, 'Otra.');
  assert.deepEqual(own.countries, []);
  assert.equal(own.language_register, null);
});

test('se puede ejecutar varias veces sin duplicar nada', async () => {
  const { rows } = await database.query('SELECT COUNT(*)::int AS count FROM expressions');
  assert.equal(rows[0].count, seedExpressions.length + 1);
});
