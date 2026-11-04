/** @typedef {import('./types/app').Schemas} Schemas */

/**
 * Envía una respuesta comprobando en compilación que cumple el esquema del contrato.
 *
 * @template {keyof Schemas} Name
 * @param {import('express').Response} response
 * @param {Name} _schema
 * @param {Schemas[Name]} body
 * @param {number} [status]
 */
function reply(response, _schema, body, status = 200) {
  response.status(status).json(body);
}

/**
 * @param {import('express').Response} response
 * @param {number} status
 * @param {string} error
 * @param {Schemas['ErrorResponse']['code']} [code]
 */
function replyError(response, status, error, code) {
  reply(response, 'ErrorResponse', code ? { error, code } : { error }, status);
}

module.exports = { reply, replyError };
