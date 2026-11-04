function errorHandler(error, _request, response, _next) {
  if (error.status >= 400 && error.status < 500) {
    response.status(error.status).json({ error: 'La solicitud no es válida.' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
}

module.exports = { errorHandler };
