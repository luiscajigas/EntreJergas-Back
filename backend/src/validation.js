/**
 * El identificador debe ser un número: Number([1]) o Number(true) también darían 1.
 * @param {unknown} value
 * @returns {value is number}
 */
function isPositiveId(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;
}

module.exports = { isPositiveId };
