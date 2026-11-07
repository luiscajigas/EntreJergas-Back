const { replyError } = require('./http-reply');

/**
 * El parámetro next es obligatorio: Express reconoce a este manejador porque recibe cuatro.
 * @type {import('express').ErrorRequestHandler}
 */
function errorHandler(error, _request, response, next) {
  // Con la respuesta ya empezada no se puede enviar otra: Express cierra la conexión.
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error.status >= 400 && error.status < 500) {
    replyError(response, error.status, 'La solicitud no es válida.');
    return;
  }
  console.error(error);
  replyError(response, 500, 'Ocurrió un error inesperado en el servidor.');
}

/**
 * @param {import('express').Request} _request
 * @param {import('express').Response} response
 */
function notFoundHandler(_request, response) {
  replyError(response, 404, 'La ruta no existe.');
}

module.exports = { errorHandler, notFoundHandler };
