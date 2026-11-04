/**
 * Indica si dos textos difieren como máximo en un carácter (cambio, inserción o eliminación).
 * @param {string} left
 * @param {string} right
 */
function differsByOneEdit(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;

  let start = 0;
  while (start < left.length && left[start] === right[start]) start += 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  return shorter.length === longer.length
    ? shorter.slice(start + 1) === longer.slice(start + 1)
    : shorter.slice(start) === longer.slice(start + 1);
}

module.exports = { differsByOneEdit };
