const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

/**
 * scrypt es costoso a propósito, pero Node lo ejecuta en su grupo de hilos (libuv):
 * el hilo principal sigue atendiendo otras solicitudes mientras tanto.
 * @type {(password: string, salt: string, length: number) => Promise<Buffer>}
 */
const scryptAsync = /** @type {any} */ (promisify(scrypt));

/** @param {string} password */
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

/**
 * @param {string} password
 * @param {string} storedHash
 */
async function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
