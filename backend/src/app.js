const cors = require('cors');
const express = require('express');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);
const sessionCookieName = 'entrejergas_session';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

function normalizeExpression(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    source: 'database'
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readSessionToken(request) {
  const cookieHeader = request.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionCookieName}=`));
  return cookie ? cookie.slice(sessionCookieName.length + 1) : null;
}

function setSessionCookie(response, token) {
  const attributes = [
    `${sessionCookieName}=${token}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionDurationMs / 1000}`
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(response) {
  const attributes = [
    `${sessionCookieName}=`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function serializeUser(user) {
  return { id: Number(user.id), email: user.email, name: user.name };
}

async function createSession(pool, user, response) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();

  await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  await pool.query(`
    INSERT INTO user_sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, $3)
  `, [hashToken(token), user.id, expiresAt]);

  setSessionCookie(response, token);
}

function createApp(pool) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim());

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '10kb' }));

  const requireAuthentication = async (request, response, next) => {
    const token = readSessionToken(request);
    if (!token) {
      return response.status(401).json({ error: 'Inicia sesión para continuar.' });
    }

    const result = await pool.query(`
      SELECT users.id, users.email, users.display_name AS name
      FROM user_sessions
      JOIN users ON users.id = user_sessions.user_id
      WHERE user_sessions.token_hash = $1
        AND user_sessions.expires_at > NOW()
    `, [hashToken(token)]);
    const user = result.rows[0];

    if (!user) {
      clearSessionCookie(response);
      return response.status(401).json({ error: 'Tu sesión venció. Inicia sesión nuevamente.' });
    }

    request.user = serializeUser(user);
    return next();
  };

  app.get('/api/health', async (_request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', service: 'entrejergas-api' });
  });

  app.post('/api/auth/register', async (request, response) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';

    if (name.length < 2 || name.length > 80) {
      return response.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: 'Escribe un correo electrónico válido.' });
    }
    if (password.length < 8 || password.length > 128) {
      return response.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    }

    let user;
    try {
      const result = await pool.query(`
        INSERT INTO users (email, display_name, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, email, display_name AS name
      `, [email, name, await hashPassword(password)]);
      user = result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
      }
      throw error;
    }

    await createSession(pool, user, response);
    return response.status(201).json({ user: serializeUser(user) });
  });

  app.post('/api/auth/login', async (request, response) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';

    const result = await pool.query(`
      SELECT id, email, display_name AS name, password_hash
      FROM users
      WHERE email = $1
    `, [email]);
    const user = result.rows[0];

    if (!user || !await verifyPassword(password, user.password_hash)) {
      return response.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    await createSession(pool, user, response);
    return response.json({ user: serializeUser(user) });
  });

  app.get('/api/auth/me', requireAuthentication, (request, response) => {
    response.json({ user: request.user });
  });

  app.post('/api/auth/logout', async (request, response) => {
    const token = readSessionToken(request);
    if (token) await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
    clearSessionCookie(response);
    return response.status(204).end();
  });

  app.post('/api/lookup', requireAuthentication, async (request, response) => {
    const expression = typeof request.body?.expression === 'string'
      ? request.body.expression.trim()
      : '';

    if (!expression || expression.length > 100) {
      return response.status(400).json({
        error: 'La expresión debe tener entre 1 y 100 caracteres.'
      });
    }

    const normalized = normalizeExpression(expression);
    const result = await pool.query(
      'SELECT * FROM expressions WHERE normalized_expression = $1',
      [normalized]
    );
    const entry = result.rows[0] || null;

    await pool.query(`
      INSERT INTO search_history (user_id, searched_expression, normalized_expression, found)
      VALUES ($1, $2, $3, $4)
    `, [request.user.id, expression, normalized, Boolean(entry)]);

    return response.json({
      found: Boolean(entry),
      entry: entry ? serializeExpression(entry) : null,
      message: entry ? undefined : 'Todavía no tenemos esta expresión en el diccionario.'
    });
  });

  app.get('/api/history', requireAuthentication, async (request, response) => {
    const result = await pool.query(`
      SELECT id, searched_expression AS expression, found, created_at AS "createdAt"
      FROM search_history
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 30
    `, [request.user.id]);

    response.json({ items: result.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  });

  app.get('/api/dashboard', requireAuthentication, async (request, response) => {
    const [expressionsResult, searchesResult, regionsResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM expressions'),
      pool.query('SELECT COUNT(*)::int AS count FROM search_history WHERE user_id = $1', [request.user.id]),
      pool.query(`
        SELECT region, COUNT(*)::int AS count
        FROM expressions
        GROUP BY region
        ORDER BY count DESC, region ASC
      `)
    ]);

    response.json({
      expressions: expressionsResult.rows[0].count,
      searches: searchesResult.rows[0].count,
      regions: regionsResult.rows
    });
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
  });

  return app;
}

module.exports = { createApp };