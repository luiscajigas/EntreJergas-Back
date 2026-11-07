/**
 * Limitador de ventana fija en memoria. Sirve porque hay una sola instancia del
 * servidor; con varias instancias habría que compartir el conteo, por ejemplo en Redis.
 *
 * @param {{ max: number, windowMs: number, maxKeys?: number, now?: () => number }} options
 */
function createRateLimiter({ max, windowMs, maxKeys = 10000, now = Date.now }) {
  /** @type {Map<string | number, { count: number, resetsAt: number }>} */
  const windows = new Map();

  /** @param {string | number} key */
  const current = (key) => {
    const entry = windows.get(key);
    return entry && entry.resetsAt > now() ? entry : null;
  };

  /** @param {string | number} key */
  const isLimited = (key) => (current(key)?.count ?? 0) >= max;

  /** Quita lo vencido y, si no alcanza, lo más antiguo: la memoria usada queda acotada. */
  const makeRoom = () => {
    for (const [key, entry] of windows) {
      if (entry.resetsAt <= now()) windows.delete(key);
    }
    const [oldest] = windows.keys();
    if (windows.size >= maxKeys && oldest !== undefined) windows.delete(oldest);
  };

  /** @param {string | number} key */
  const record = (key) => {
    const entry = current(key);
    if (entry) {
      entry.count += 1;
      return;
    }
    if (windows.size >= maxKeys) makeRoom();
    windows.set(key, { count: 1, resetsAt: now() + windowMs });
  };

  return {
    isLimited,
    record,
    /** @param {string | number} key */
    reset: (key) => {
      windows.delete(key);
    },
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
