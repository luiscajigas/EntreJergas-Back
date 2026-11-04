const { replyError } = require('./http-reply');

/** @type {import('express').ErrorRequestHandler} */
function errorHandler(error, _request, response, _next) {
  if (error.status >= 400 && error.status < 500) {
    replyError(response, error.status, 'La solicitud no es válida.');
    return;
  }
  console.error(error);
  replyError(response, 500, 'Ocurrió un error inesperado en el servidor.');
}

module.exports = { errorHandler };
