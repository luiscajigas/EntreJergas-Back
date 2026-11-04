/**
 * Limitador de ventana fija en memoria. Sirve porque hay una sola instancia del
 * servidor; con varias instancias habría que compartir el conteo, por ejemplo en Redis.
 *
 * @param {{ max: number, windowMs: number, now?: () => number }} options
 */
function createRateLimiter({ max, windowMs, now = Date.now }) {
  /** @type {Map<string | number, { count: number, resetsAt: number }>} */
  const windows = new Map();

  /** @param {string | number} key */
  const current = (key) => {
    const entry = windows.get(key);
    return entry && entry.resetsAt > now() ? entry : null;
  };

  /** @param {string | number} key */
  const isLimited = (key) => (current(key)?.count ?? 0) >= max;

  /** @param {string | number} key */
  const record = (key) => {
    const entry = current(key);
    if (entry) {
      entry.count += 1;
      return;
    }
    if (windows.size > 10000) {
      for (const [storedKey, stored] of windows) {
        if (stored.resetsAt <= now()) windows.delete(storedKey);
      }
    }
    windows.set(key, { count: 1, resetsAt: now() + windowMs });
  };

  return {
    isLimited,
    record,
    /** @param {string | number} key */
    reset: (key) => { windows.delete(key); },
    /**
     * Comprueba el límite y, si hay cupo, cuenta este uso.
     * @param {string | number} key
     */
    tryConsume(key) {
      if (isLimited(key)) return false;
      record(key);
      return true;
    }
  };
}

module.exports = { createRateLimiter };
