const { createHash, randomBytes } = require('node:crypto');

const cookieName = 'entrejergas_session';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readToken(request) {
  const header = request.headers.cookie || '';
  const cookie = header.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`));
  return cookie ? cookie.slice(cookieName.length + 1) : null;
}

function writeCookie(response, attributes) {
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

function setSessionCookie(response, token) {
  writeCookie(response, [
    `${cookieName}=${token}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionDurationMs / 1000}`
  ]);
}

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

function createSessionStore(pool) {
  return {
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

    async findUser(token) {
      const result = await pool.query(`
        SELECT users.id, users.email, users.display_name AS name
        FROM user_sessions
        JOIN users ON users.id = user_sessions.user_id
        WHERE user_sessions.token_hash = $1
          AND user_sessions.expires_at > NOW()
      `, [hashToken(token)]);
      return result.rows[0] ?? null;
    },

    async end(token) {
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
    }
  };
}

module.exports = { clearSessionCookie, createSessionStore, readToken };
