/**
 * @param {{ id: string | number, email: string, name: string }} row
 * @returns {import('../types/app').Schemas['User']}
 */
function serializeUser(row) {
  return { id: Number(row.id), email: row.email, name: row.name };
}

/** @param {import('pg').Pool} pool */
function createUserRepository(pool) {
  return {
    /** @param {{ email: string, name: string, passwordHash: string }} user */
    async create({ email, name, passwordHash }) {
      const result = await pool.query(
        `
        INSERT INTO users (email, display_name, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, email, display_name AS name
      `,
        [email, name, passwordHash]
      );
      return serializeUser(result.rows[0]);
    },

    /** @param {{ email: string, name: string, passwordHash: string }} user */
    async createOrResetPassword({ email, name, passwordHash }) {
      await pool.query(
        `
        INSERT INTO users (email, display_name, password_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `,
        [email, name, passwordHash]
      );
    },

    /** @param {string} email */
    async findCredentials(email) {
      const result = await pool.query(
        `
        SELECT id, email, display_name AS name, password_hash
        FROM users
        WHERE email = $1
      `,
        [email]
      );
      const row = result.rows[0];
      return row ? { user: serializeUser(row), passwordHash: row.password_hash } : null;
    }
  };
}

module.exports = { createUserRepository };
