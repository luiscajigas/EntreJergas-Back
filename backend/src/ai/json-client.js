const defaultModel = 'gemini-3.5-flash-lite';
const defaultEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const maxAttempts = 3;
const requestTimeoutMs = 7000;
const baseBackoffMs = 1000;
const maxJitterMs = 250;
const maxRetryAfterMs = 5000;

class AiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: 'AI_NOT_CONFIGURED' | 'AI_INVALID_RESPONSE', status: number }} details
   */
  constructor(message, { code, status }) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @typedef {object} AiOptions
 * @property {string} [apiKey]
 * @property {string} [endpoint]
 * @property {string} [model]
 * @property {typeof fetch} [fetchImplementation]
 * @property {(milliseconds: number) => Promise<unknown>} [waitImplementation]
 * @property {() => number} [randomImplementation]
 */

/** @param {number} status */
const isTransientStatus = (status) => status === 408 || status >= 500;

/** @param {Response} response */
async function readProviderMessage(response) {
  try {
    const payload = /** @type {{ error?: { message?: string } }} */ (await response.json());
    return payload.error?.message || '';
  } catch {
    return ''; // El proveedor puede responder con un cuerpo no JSON.
  }
}

/**
 * Cliente de la API de Gemini: reintenta los fallos pasajeros con espera exponencial,
 * pero nunca un 429, para no gastar más cuota cuando ya se agotó.
 * @param {AiOptions} [options]
 */
function createJsonClient({
  apiKey = process.env.LLM_API_KEY,
  endpoint = process.env.LLM_API_URL || defaultEndpoint,
  model = process.env.LLM_MODEL || defaultModel,
  fetchImplementation = fetch,
  waitImplementation = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  randomImplementation = Math.random
} = {}) {
  /** @param {number} attempt */
  const backoffMs = (attempt) =>
    baseBackoffMs * 2 ** attempt + Math.floor(randomImplementation() * maxJitterMs);

  /** @param {{ system: string, user: string, maxTokens: number }} request */
  const send = async ({ system, user, maxTokens }) => {
    for (let attempt = 0; ; attempt += 1) {
      const hasRetriesLeft = attempt < maxAttempts - 1;
      let response;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          }),
          signal: AbortSignal.timeout(requestTimeoutMs)
        });
      } catch (fetchError) {
        const errorName = /** @type {Error} */ (fetchError).name;
        const timedOut = errorName === 'TimeoutError' || errorName === 'AbortError';
        if ((timedOut || errorName === 'TypeError') && hasRetriesLeft) {
          await waitImplementation(backoffMs(attempt));
          continue;
        }
        throw new AiError(
          timedOut ? 'Gemini agotó el tiempo de espera.' : 'No fue posible conectar con Gemini.',
          {
            status: timedOut ? 504 : 502
          }
        );
      }

      if (response.ok)
        return /** @type {{ choices?: { message?: { content?: unknown } }[] }} */ (
          await response.json()
        );

      const providerMessage = await readProviderMessage(response);
      if (!isTransientStatus(response.status) || !hasRetriesLeft) {
        throw new AiError(
          `El proveedor de IA respondió ${response.status}${providerMessage ? `: ${providerMessage}` : '.'}`,
          {
            status: response.status
          }
        );
      }

      const retryAfterMs = Number(response.headers?.get('retry-after')) * 1000;
      await waitImplementation(
        retryAfterMs > 0 ? Math.min(retryAfterMs, maxRetryAfterMs) : backoffMs(attempt)
      );
    }
  };

  /** @param {{ system: string, user: string, maxTokens: number }} request */
  return async (request) => {
    if (!apiKey) {
      throw new AiError('Falta configurar LLM_API_KEY en el backend.', {
        code: 'AI_NOT_CONFIGURED',
        status: 503
      });
    }

    const content = (await send(request)).choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AiError('Gemini respondió sin contenido de texto.', {
        code: 'AI_INVALID_RESPONSE',
        status: 502
      });
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new AiError('Gemini respondió un JSON inválido.', {
        code: 'AI_INVALID_RESPONSE',
        status: 502
      });
    }
  };
}

module.exports = { AiError, createJsonClient };
