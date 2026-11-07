const { createHash, randomBytes } = require('node:crypto');
const { sessionDurationMs } = require('./session-cookie');

/** @param {string} token */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** @param {import('pg').Pool} pool */
function createSessionStore(pool) {
  return {
    /**
     * Crea la sesión y devuelve su token; en la base de datos solo queda el hash.
     * @param {number} userId
     */
    async start(userId) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();

      await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
      await pool.query(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
      `, [hashToken(token), userId, expiresAt]);

      return token;
    },

    /**
     * @param {string} token
     * @returns {Promise<import('../types/app').Schemas['User'] | null>}
     */
    async findUser(token) {
      const result = await pool.query(`
        SELECT users.id, users.email, users.display_name AS name
        FROM user_sessions
        JOIN users ON users.id = user_sessions.user_id
        WHERE user_sessions.token_hash = $1
          AND user_sessions.expires_at > NOW()
      `, [hashToken(token)]);
      const row = result.rows[0];
      return row ? { id: Number(row.id), email: row.email, name: row.name } : null;
    },

    /** @param {string} token */
    async end(token) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
    }
  };
}

module.exports = { createSessionStore };
