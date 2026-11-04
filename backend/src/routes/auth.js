const express = require('express');
const { hashPassword, verifyPassword } = require('../auth/passwords');
const { clearSessionCookie, readToken } = require('../auth/sessions');

const uniqueViolation = '23505';

const readText = (value) => typeof value === 'string' ? value : '';

function validateRegistration({ name, email, password }) {
  if (name.length < 2 || name.length > 80) return 'El nombre debe tener entre 2 y 80 caracteres.';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Escribe un correo electrónico válido.';
  if (password.length < 8 || password.length > 128) return 'La contraseña debe tener entre 8 y 128 caracteres.';
  return null;
}

function createAuthRouter({ users, sessions, loginLimiter, requireAuthentication }) {
  const router = express.Router();

  router.post('/register', async (request, response) => {
    const name = readText(request.body?.name).trim();
    const email = readText(request.body?.email).trim().toLowerCase();
    const password = readText(request.body?.password);

    const invalid = validateRegistration({ name, email, password });
    if (invalid) {
      response.status(400).json({ error: invalid });
      return;
    }

    let user;
    try {
      user = await users.create({ email, name, passwordHash: await hashPassword(password) });
    } catch (error) {
      if (error.code !== uniqueViolation) throw error;
      response.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
      return;
    }

    await sessions.start(user.id, response);
    response.status(201).json({ user });
  });

  router.post('/login', async (request, response) => {
    const email = readText(request.body?.email).trim().toLowerCase();
    const password = readText(request.body?.password);

    if (loginLimiter.isLimited(email)) {
      response.status(429).json({ error: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', code: 'rate_limited' });
      return;
    }

    const credentials = await users.findCredentials(email);
    if (!credentials || !await verifyPassword(password, credentials.passwordHash)) {
      loginLimiter.record(email);
      response.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }

    loginLimiter.reset(email);
    await sessions.start(credentials.user.id, response);
    response.json({ user: credentials.user });
  });

  router.get('/me', requireAuthentication, (request, response) => {
    response.json({ user: request.user });
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
