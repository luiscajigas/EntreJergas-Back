/** @typedef {import('../types/app').Schemas} Schemas */

/** @param {import('pg').Pool} pool */
function createSearchHistoryRepository(pool) {
  return {
    /** @param {{ userId: number, expression: string, normalized: string, found: boolean, source: Schemas['HistorySource'] }} search */
    async record({ userId, expression, normalized, found, source }) {
      await pool.query(`
        INSERT INTO search_history
          (user_id, searched_expression, normalized_expression, found, result_source)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, expression, normalized, found, source]);
    },

    /**
     * @param {number} userId
     * @param {number} [limit]
     * @returns {Promise<Schemas['HistoryItem'][]>}
     */
    async listForUser(userId, limit = 30) {
      const result = await pool.query(`
        SELECT id, searched_expression AS expression, found, result_source AS source,
          created_at AS "createdAt"
        FROM search_history
        WHERE user_id = $1
        ORDER BY id DESC
        LIMIT $2
      `, [userId, limit]);
      return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
    },

    /**
     * @param {number} userId
     * @returns {Promise<number>}
     */
    async countForUser(userId) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM search_history WHERE user_id = $1', [userId]);
      return result.rows[0].count;
    }
  };
}

module.exports = { createSearchHistoryRepository };
