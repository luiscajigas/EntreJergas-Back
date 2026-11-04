const { replyError } = require('../http-reply');
const { clearSessionCookie, readToken } = require('./sessions');

/**
 * @param {import('../types/app').SessionStore} sessions
 * @returns {import('express').RequestHandler}
 */
function createRequireAuthentication(sessions) {
  return async (request, response, next) => {
    const token = readToken(request);
    if (!token) {
      replyError(response, 401, 'Inicia sesión para continuar.');
      return;
    }

    const user = await sessions.findUser(token);
    if (!user) {
      clearSessionCookie(response);
      replyError(response, 401, 'Tu sesión venció. Inicia sesión nuevamente.');
      return;
    }

    request.user = user;
    next();
  };
}

module.exports = { createRequireAuthentication };
