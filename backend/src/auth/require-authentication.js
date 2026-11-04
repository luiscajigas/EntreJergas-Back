const { clearSessionCookie, readToken } = require('./sessions');

function createRequireAuthentication(sessions) {
  return async (request, response, next) => {
    const token = readToken(request);
    if (!token) {
      response.status(401).json({ error: 'Inicia sesión para continuar.' });
      return;
    }

    const user = await sessions.findUser(token);
    if (!user) {
      clearSessionCookie(response);
      response.status(401).json({ error: 'Tu sesión venció. Inicia sesión nuevamente.' });
      return;
    }

    request.user = { id: Number(user.id), email: user.email, name: user.name };
    next();
  };
}

module.exports = { createRequireAuthentication };
