/** @typedef {import('../types/app').Schemas} Schemas */

/**
 * @param {any} row
 * @returns {Schemas['ExpressionEntry']}
 */
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
    source: row.source === 'ai' ? 'ai' : 'database',
    countries: Array.isArray(row.countries) ? row.countries : [],
    register: row.language_register ?? null
  };
}

/** @param {import('pg').Pool} pool */
function createExpressionRepository(pool) {
  /** @param {string} normalized */
  const findByNormalized = async (normalized) => {
    const result = await pool.query('SELECT * FROM expressions WHERE normalized_expression = $1', [normalized]);
    return result.rows[0] ? serializeExpression(result.rows[0]) : null;
  };

  return {
    findByNormalized,

    /** @returns {Promise<{ normalized: string, expression: string }[]>} */
    async listNames() {
      const result = await pool.query('SELECT normalized_expression AS normalized, expression FROM expressions');
      return result.rows;
    },

    /**
     * @param {{ text: string, country: string | null, limit: number, offset: number }} filters
     * @returns {Promise<{ items: Schemas['ExpressionEntry'][], total: number }>}
     */
    async search({ text, country, limit, offset }) {
      const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
      const where = `normalized_expression LIKE $1 ESCAPE '\\' AND ($2::text IS NULL OR $2 = ANY(countries))`;
      const [rows, count] = await Promise.all([
        pool.query(`SELECT * FROM expressions WHERE ${where} ORDER BY normalized_expression LIMIT $3 OFFSET $4`, [pattern, country, limit, offset]),
        pool.query(`SELECT COUNT(*)::int AS count FROM expressions WHERE ${where}`, [pattern, country])
      ]);
      return { items: rows.rows.map(serializeExpression), total: count.rows[0].count };
    },

    /** @returns {Promise<import('../types/app').GameCandidate[]>} */
    async listGameCandidates() {
      const result = await pool.query('SELECT id, expression, countries FROM expressions');
      return result.rows
        .filter((row) => Array.isArray(row.countries) && row.countries.length > 0)
        .map((row) => ({ id: Number(row.id), expression: row.expression, countries: row.countries }));
    },

    /** @param {number} id */
    async findById(id) {
      const result = await pool.query('SELECT * FROM expressions WHERE id = $1', [id]);
      return result.rows[0] ? serializeExpression(result.rows[0]) : null;
    },

    /**
     * @param {string} normalized
     * @param {import('../types/app').Definition} definition
     * @param {{ countries: string[], register: Schemas['ExpressionEntry']['register'] }} details
     */
    async saveGenerated(normalized, definition, { countries, register }) {
      const inserted = await pool.query(`
        INSERT INTO expressions (
          normalized_expression, expression, meaning, region, context,
          equivalent, example, source, countries, language_register
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai', $8, $9)
        ON CONFLICT (normalized_expression) DO NOTHING
        RETURNING *
      `, [
        normalized,
        definition.expression,
        definition.meaning,
        definition.region,
        definition.context,
        definition.equivalent,
        definition.example,
        countries,
        register
      ]);
      return inserted.rows[0] ? serializeExpression(inserted.rows[0]) : findByNormalized(normalized);
    },

    /**
     * @param {number} expressionId
     * @returns {Promise<Schemas['DefinitionText'] | null>}
     */
    async findTranslation(expressionId) {
      const result = await pool.query(`
        SELECT meaning, region, context, equivalent, example
        FROM expression_translations
        WHERE expression_id = $1 AND language = 'en'
      `, [expressionId]);
      return result.rows[0] ?? null;
    },

    /**
     * @param {number} expressionId
     * @param {Schemas['DefinitionText']} translation
     */
    async saveTranslation(expressionId, { meaning, region, context, equivalent, example }) {
      await pool.query(`
        INSERT INTO expression_translations
          (expression_id, language, meaning, region, context, equivalent, example)
        VALUES ($1, 'en', $2, $3, $4, $5, $6)
        ON CONFLICT (expression_id, language) DO NOTHING
      `, [expressionId, meaning, region, context, equivalent, example]);
    },

    /** @returns {Promise<number>} */
    async count() {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM expressions');
      return result.rows[0].count;
    },

    /** @returns {Promise<Schemas['CountryCount'][]>} */
    async countByCountry() {
      const result = await pool.query('SELECT countries FROM expressions');
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const { countries } of result.rows) {
        for (const country of Array.isArray(countries) ? countries : []) {
          counts.set(country, (counts.get(country) ?? 0) + 1);
        }
      }
      return [...counts]
        .map(([country, count]) => ({ country, count }))
        .sort((left, right) => right.count - left.count || left.country.localeCompare(right.country));
    },

    /** @returns {Promise<Schemas['RegionCount'][]>} */
    async countByRegion() {
      const result = await pool.query(`
        SELECT region, COUNT(*)::int AS count
        FROM expressions
        GROUP BY region
        ORDER BY count DESC, region ASC
      `);
      return result.rows;
    }
  };
}

module.exports = { createExpressionRepository };
