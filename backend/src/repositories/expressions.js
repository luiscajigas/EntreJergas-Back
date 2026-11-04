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
    source: row.source === 'ai' ? 'ai' : 'database'
  };
}

function createExpressionRepository(pool) {
  const findByNormalized = async (normalized) => {
    const result = await pool.query('SELECT * FROM expressions WHERE normalized_expression = $1', [normalized]);
    return result.rows[0] ? serializeExpression(result.rows[0]) : null;
  };

  return {
    findByNormalized,

    async findById(id) {
      const result = await pool.query('SELECT * FROM expressions WHERE id = $1', [id]);
      return result.rows[0] ? serializeExpression(result.rows[0]) : null;
    },

    async saveGenerated(normalized, definition) {
      const inserted = await pool.query(`
        INSERT INTO expressions (
          normalized_expression, expression, meaning, region, context,
          equivalent, example, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai')
        ON CONFLICT (normalized_expression) DO NOTHING
        RETURNING *
      `, [
        normalized,
        definition.expression,
        definition.meaning,
        definition.region,
        definition.context,
        definition.equivalent,
        definition.example
      ]);
      return inserted.rows[0] ? serializeExpression(inserted.rows[0]) : findByNormalized(normalized);
    },

    async findTranslation(expressionId) {
      const result = await pool.query(`
        SELECT meaning, region, context, equivalent, example
        FROM expression_translations
        WHERE expression_id = $1 AND language = 'en'
      `, [expressionId]);
      return result.rows[0] ?? null;
    },

    async saveTranslation(expressionId, { meaning, region, context, equivalent, example }) {
      await pool.query(`
        INSERT INTO expression_translations
          (expression_id, language, meaning, region, context, equivalent, example)
        VALUES ($1, 'en', $2, $3, $4, $5, $6)
        ON CONFLICT (expression_id, language) DO NOTHING
      `, [expressionId, meaning, region, context, equivalent, example]);
    },

    async count() {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM expressions');
      return result.rows[0].count;
    },

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
