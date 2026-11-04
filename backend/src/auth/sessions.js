const { createHash, randomBytes } = require('node:crypto');

const cookieName = 'entrejergas_session';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

/** @param {string} token */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** @param {import('express').Request} request */
function readToken(request) {
  const header = request.headers.cookie || '';
  const cookie = header.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`));
  return cookie ? cookie.slice(cookieName.length + 1) : null;
}

/**
 * @param {import('express').Response} response
 * @param {string[]} attributes
 */
function writeCookie(response, attributes) {
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

/**
 * @param {import('express').Response} response
 * @param {string} token
 */
function setSessionCookie(response, token) {
  writeCookie(response, [
    `${cookieName}=${token}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionDurationMs / 1000}`
  ]);
}

/** @param {import('express').Response} response */
function clearSessionCookie(response) {
  writeCookie(response, [
    `${cookieName}=`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ]);
}

/** @param {import('pg').Pool} pool */
function createSessionStore(pool) {
  return {
    /**
     * @param {number} userId
     * @param {import('express').Response} response
     */
    async start(userId, response) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();

      await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
      await pool.query(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
      `, [hashToken(token), userId, expiresAt]);

      setSessionCookie(response, token);
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

module.exports = { clearSessionCookie, createSessionStore, readToken };
