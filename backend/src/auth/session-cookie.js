const cookieName = 'entrejergas_session';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

/** @param {import('express').Request} request */
function readToken(request) {
  const header = request.headers.cookie || '';
  const cookie = header
    .split(';')
    .map((value) => value.trim())
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

module.exports = { clearSessionCookie, readToken, sessionDurationMs, setSessionCookie };
