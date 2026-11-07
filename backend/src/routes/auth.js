const express = require('express');
const { hashPassword, verifyPassword } = require('../auth/passwords');
const { clearSessionCookie, readToken, setSessionCookie } = require('../auth/session-cookie');
const { demoAccount } = require('../demo-account');
const { reply, replyError } = require('../http-reply');

const uniqueViolation = '23505';
const maxEmailLength = 254;

/** @param {unknown} value */
const readText = (value) => typeof value === 'string' ? value : '';

/** @param {{ name: string, email: string, password: string }} data */
function validateRegistration({ name, email, password }) {
  if (name.length < 2 || name.length > 80) return 'El nombre debe tener entre 2 y 80 caracteres.';
  if (email.length > maxEmailLength || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Escribe un correo electrónico válido.';
  if (password.length < 8 || password.length > 128) return 'La contraseña debe tener entre 8 y 128 caracteres.';
  return null;
}

/**
 * @param {{
 *   users: import('../types/app').UserRepository,
 *   sessions: import('../types/app').SessionStore,
 *   loginLimiter: import('../types/app').RateLimiter,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createAuthRouter({ users, sessions, loginLimiter, requireAuthentication }) {
  const router = express.Router();

  router.post('/register', async (request, response) => {
    const name = readText(request.body?.name).trim();
    const email = readText(request.body?.email).trim().toLowerCase();
    const password = readText(request.body?.password);

    const invalid = validateRegistration({ name, email, password });
    if (invalid) {
      replyError(response, 400, invalid);
      return;
    }

    let user;
    try {
      user = await users.create({ email, name, passwordHash: await hashPassword(password) });
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error).code !== uniqueViolation) throw error;
      replyError(response, 409, 'Ya existe una cuenta con ese correo.');
      return;
    }

    setSessionCookie(response, await sessions.start(user.id));
    reply(response, 'AuthResponse', { user }, 201);
  });

  router.post('/login', async (request, response) => {
    const email = readText(request.body?.email).trim().toLowerCase();
    const password = readText(request.body?.password);

    // Ningún correo válido es tan largo: no gasta consulta ni ocupa memoria en el limitador.
    if (email.length > maxEmailLength) {
      replyError(response, 401, 'Correo o contraseña incorrectos.');
      return;
    }

    // Su contraseña es pública: bloquearla no protege nada y dejaría fuera a quien la esté probando.
    if (email !== demoAccount.email && loginLimiter.isLimited(email)) {
      replyError(response, 429, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', 'rate_limited');
      return;
    }

    const credentials = await users.findCredentials(email);
    if (!credentials || !await verifyPassword(password, credentials.passwordHash)) {
      loginLimiter.record(email);
      replyError(response, 401, 'Correo o contraseña incorrectos.');
      return;
    }

    loginLimiter.reset(email);
    setSessionCookie(response, await sessions.start(credentials.user.id));
    reply(response, 'AuthResponse', { user: credentials.user });
  });

  router.get('/me', requireAuthentication, (request, response) => {
    reply(response, 'AuthResponse', { user: request.user });
  });

  router.post('/logout', async (request, response) => {
    const token = readToken(request);
    if (token) await sessions.end(token);
    clearSessionCookie(response);
    response.status(204).end();
  });

  return router;
}

module.exports = { createAuthRouter };
