const { PGlite } = require('@electric-sql/pglite');

/**
 * PostgreSQL real en memoria, con la parte de la interfaz de pg que usa el backend.
 * Sirve para las consultas que pg-mem no emula, como ANY sobre arreglos.
 */
function createRealPool() {
  const database = new PGlite();
  const query = async (text, params) => {
    if (params?.length) return database.query(text, params);
    const results = await database.exec(text);
    return results[results.length - 1] ?? { rows: [] };
  };
  return {
    database,
    pool: { query, connect: async () => ({ query, release() {} }), end: () => database.close() }
  };
}

module.exports = { createRealPool };
