const express = require('express');
const { normalizeExpression } = require('../expression-text');
const { reply, replyError } = require('../http-reply');

const defaultPageSize = 20;
const maxPageSize = 50;
const maxQueryLength = 100;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number | null} null si no es un entero positivo
 */
function readPositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * @param {{
 *   expressions: import('../types/app').ExpressionRepository,
 *   requireAuthentication: import('express').RequestHandler
 * }} dependencies
 */
function createDictionaryRouter({ expressions, requireAuthentication }) {
  const router = express.Router();

  router.get('/expressions', requireAuthentication, async (request, response) => {
    const { q, country, page: rawPage, pageSize: rawPageSize } = request.query;
    const text = typeof q === 'string' ? q : '';
    const page = readPositiveInteger(rawPage, 1);
    const pageSize = readPositiveInteger(rawPageSize, defaultPageSize);
    const validCountry = country === undefined || (typeof country === 'string' && /^[A-Z]{2}$/.test(country));

    if (text.length > maxQueryLength || !page || !pageSize || pageSize > maxPageSize || !validCountry) {
      replyError(response, 400, 'Los filtros de búsqueda no son válidos.');
      return;
    }

    const { items, total } = await expressions.search({
      text: normalizeExpression(text),
      country: /** @type {string | undefined} */ (country) ?? null,
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    reply(response, 'ExpressionPage', { items, total, page, pageSize });
  });

  return router;
}

module.exports = { createDictionaryRouter };
