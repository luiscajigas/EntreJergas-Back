const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createAiAnalyzer, createAiTranslator, createAiVerifier } = require('../src/ai-provider');
const { initializeDatabase } = require('../src/database');
const { errorHandler } = require('../src/error-handler');
const { stripWrappingQuotes } = require('../src/expression-text');
const { seedExpressions } = require('../src/seed-expressions');
const { createRealPool } = require('../test-support/real-database');
const { differsByOneEdit } = require('../src/text-distance');
const { createRateLimiter } = require('../src/rate-limiter');

let pool;
let server;
let baseUrl;
let userSequence = 0;

/** Expresión como la devolvería el analizador. */
function analyzed(text, overrides = {}) {
  return {
    text,
    type: 'regional',
    confidence: 'high',
    suggestion: null,
    countries: ['AR'],
    register: 'informal',
    definition: {
      expression: text,
      meaning: 'Expresión de prueba.',
      region: 'Argentina',
      context: 'Uso coloquial.',
      equivalent: 'equivalente',
      example: `Dijo: ${text}.`
    },
    ...overrides
  };
}

const analysisContent = (text, fields = {}) =>
  JSON.stringify({
    expressions: [
      {
        text,
        type: 'regional',
        confidence: 'high',
        suggestion: null,
        countries: ['AR'],
        register: 'informal',
        meaning: 'Significado',
        region: 'Región',
        context: 'Contexto',
        equivalent: 'Equivalente',
        example: 'Ejemplo',
        ...fields
      }
    ]
  });

before(async () => {
  ({ pool } = createRealPool());
  await initializeDatabase(pool);
  server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

async function registerUser(name = 'Test User') {
  userSequence += 1;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      email: `test${userSequence}@example.com`,
      password: 'password123'
    })
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  return { response, cookie };
}

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  await pool?.end();
});

test('health confirma que la base PostgreSQL responde', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'entrejergas-api' });
});

test('registro, login, sesión HttpOnly y logout funcionan', async () => {
  const registration = await registerUser('Ana Prueba');
  assert.equal(registration.response.status, 201);
  assert.match(registration.response.headers.get('set-cookie'), /HttpOnly/);
  const { user } = await registration.response.json();
  assert.equal(user.name, 'Ana Prueba');
  assert.equal(user.email, 'test1@example.com');
  assert.equal('password_hash' in user, false);

  const duplicateRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: user.name, email: user.email, password: 'password123' })
  });
  assert.equal(duplicateRegistration.status, 409);

  const currentUser = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: registration.cookie }
  });
  assert.equal(currentUser.status, 200);
  assert.deepEqual((await currentUser.json()).user, user);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'incorrecta' })
  });
  assert.equal(invalidLogin.status, 401);

  const validLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'password123' })
  });
  assert.equal(validLogin.status, 200);
  assert.match(validLogin.headers.get('set-cookie'), /HttpOnly/);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: registration.cookie }
  });
  assert.equal(logout.status, 204);
  const expiredSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: registration.cookie }
  });
  assert.equal(expiredSession.status, 401);
});

test('lookup prioriza el diccionario y solo guarda lo regional con confianza alta', async () => {
  const { cookie } = await registerUser();
  let calls = 0;
  const aiServer = createApp(pool, {
    verifyExpression: async () => true,
    analyzeText: async (text) => {
      calls += 1;
      return text === 'palabra dudosa'
        ? [analyzed(text, { confidence: 'medium' })]
        : [analyzed(text)];
    }
  }).listen(0);
  await new Promise((resolve) => aiServer.once('listening', resolve));
  const url = `http://127.0.0.1:${aiServer.address().port}/api`;
  const lookup = async (expression) =>
    (
      await fetch(`${url}/lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ expression })
      })
    ).json();

  const known = await lookup('¿Qué chimba?');
  assert.equal(known.found, true);
  assert.equal(known.entries[0].expression, 'qué chimba');
  assert.equal(known.entries[0].source, 'database');
  assert.deepEqual(known.entries[0].countries, ['CO']);
  assert.equal(calls, 0);

  const saved = await lookup('una jerga nueva');
  assert.equal(saved.entries[0].source, 'ai');
  assert.ok(saved.entries[0].id);
  assert.deepEqual(saved.entries[0].countries, ['AR']);
  assert.equal(saved.entries[0].register, 'informal');
  assert.equal(calls, 1);

  const repeated = await lookup('«una jerga nueva»');
  assert.equal(repeated.entries[0].id, saved.entries[0].id);
  assert.equal(calls, 1);

  const doubtful = await lookup('palabra dudosa');
  assert.equal(doubtful.entries[0].id, null);
  assert.equal(doubtful.entries[0].classification, 'regional');
  await new Promise((resolve, reject) =>
    aiServer.close((error) => (error ? reject(error) : resolve()))
  );

  const history = await fetch(`${baseUrl}/api/history`, { headers: { cookie } }).then((response) =>
    response.json()
  );
  assert.deepEqual(
    history.items.map((item) => item.source),
    ['ai', 'ai_saved', 'ai_saved', 'database']
  );

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } }).then(
    (response) => response.json()
  );
  assert.ok(dashboard.expressions > seedExpressions.length);
  assert.equal(dashboard.searches, 4);
  assert.ok(dashboard.countries.some(({ country, count }) => country === 'CO' && count > 0));
  assert.ok(dashboard.countries.some(({ country }) => country === 'MX'));
});

test('una frase devuelve una ficha por expresión y decide cuál se guarda', async () => {
  const { cookie } = await registerUser();
  const sentence =
    'hola como estas quiero saber que significa parcero ya que estoy en colombia y que significa mochila, parzero, asdfgh y mi jerga rara';
  const server = createApp(pool, {
    analyzeText: async () => [
      analyzed('parcero', { countries: ['CO'] }),
      analyzed('mochila', { type: 'common', countries: [] }),
      analyzed('parzero', { type: 'typo', suggestion: 'parcero', definition: null })
    ]
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: sentence })
  }).then((response) => response.json());
  await new Promise((resolve) => server.close(resolve));

  assert.deepEqual(
    result.entries.map((entry) => entry.expression),
    ['parcero', 'mochila']
  );
  assert.equal(result.entries[0].source, 'database');
  assert.equal(result.entries[1].id, null);
  assert.equal(result.entries[1].classification, 'common');
  assert.deepEqual(result.unresolved, [{ text: 'parzero', reason: 'typo', suggestion: 'parcero' }]);

  const stored = await pool.query(
    "SELECT id FROM expressions WHERE normalized_expression IN ('mochila', 'parzero')"
  );
  assert.equal(stored.rows.length, 0);
  const sentenceStored = await pool.query(
    'SELECT id FROM expressions WHERE normalized_expression LIKE $1',
    ['hola como%']
  );
  assert.equal(sentenceStored.rows.length, 0);

  const history = await fetch(`${baseUrl}/api/history`, { headers: { cookie } }).then((response) =>
    response.json()
  );
  assert.deepEqual(history.items.map((item) => item.expression).sort(), [
    'mochila',
    'parcero',
    'parzero'
  ]);
});

test('nunca guarda lo que no cumple la regla ni lo que la IA no sacó del texto', async () => {
  const { cookie } = await registerUser();
  const cases = {
    'jerga sin pais': [analyzed('jerga sin pais', { countries: [] })],
    'jerga baja': [analyzed('jerga baja', { confidence: 'low' })],
    'palabra comun': [analyzed('palabra comun', { type: 'common' })],
    'qwerty raro': [analyzed('qwerty raro', { type: 'unknown', definition: null })],
    'texto cualquiera': [analyzed('palabra inventada por la ia')]
  };
  const server = createApp(pool, {
    verifyExpression: async () => true,
    analyzeText: async (text) => cases[text]
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  for (const expression of Object.keys(cases)) {
    await fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ expression })
    });
  }
  await new Promise((resolve) => server.close(resolve));

  const names = [...Object.keys(cases), 'palabra inventada por la ia'];
  const stored = await pool.query(
    `SELECT id FROM expressions WHERE normalized_expression IN (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
    names
  );
  assert.equal(stored.rows.length, 0);
});

test('el analizador descarta datos inválidos y limita las expresiones', async () => {
  const respond = (expressions) =>
    createAiAnalyzer({
      apiKey: 'test-key',
      fetchImplementation: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ expressions }) } }] })
      })
    })('texto');
  const base = JSON.parse(analysisContent('uno')).expressions[0];

  const [first] = await respond([
    { ...base, countries: ['ar', 'XX', 'AR', 5], register: 'raro', confidence: 'segura' }
  ]);
  assert.deepEqual(first.countries, ['AR']);
  assert.equal(first.register, null);
  assert.equal(first.confidence, 'low');

  const many = await respond(['uno', 'dos', 'tres', 'cuatro'].map((text) => ({ ...base, text })));
  assert.equal(many.length, 3);

  assert.deepEqual(await respond([]), []);
  await assert.rejects(respond([{ text: 'x', type: 'desconocido' }]), {
    code: 'AI_INVALID_RESPONSE'
  });
  await assert.rejects(respond([{ text: 'x', type: 'regional' }]), { code: 'AI_INVALID_RESPONSE' });
});

test('una palabra a una letra de otra del diccionario se trata como error, aunque la IA la dé por real', async () => {
  const { cookie } = await registerUser();
  const server = createApp(pool, {
    verifyExpression: async () => true,
    analyzeText: async (text) => [analyzed(text, { countries: ['MX'] })]
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const lookup = async (expression) =>
    (
      await fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ expression })
      })
    ).json();

  const typo = await lookup('parzero');
  assert.deepEqual(typo.entries, []);
  assert.deepEqual(typo.unresolved, [{ text: 'parzero', reason: 'typo', suggestion: 'parcero' }]);
  const stored = await pool.query(
    "SELECT id FROM expressions WHERE normalized_expression = 'parzero'"
  );
  assert.equal(stored.rows.length, 0);

  assert.ok((await lookup('jerga bien distinta')).entries[0].id);
  await new Promise((resolve) => server.close(resolve));
});

test('la distancia de texto solo acepta una diferencia', () => {
  assert.equal(differsByOneEdit('parzero', 'parcero'), true);
  assert.equal(differsByOneEdit('parcro', 'parcero'), true);
  assert.equal(differsByOneEdit('parceroo', 'parcero'), true);
  assert.equal(differsByOneEdit('parcero', 'parcero'), false);
  assert.equal(differsByOneEdit('parce', 'parcero'), false);
  assert.equal(differsByOneEdit('pxrzero', 'parcero'), false);
});

test('lo que el revisor rechaza no se muestra y, si no puede revisar, se explica sin guardar', async () => {
  const { cookie } = await registerUser();
  const verifications = {
    'jerga rechazada': async () => false,
    'jerga sin verificar': async () => {
      throw new Error('UNAVAILABLE');
    }
  };
  const server = createApp(pool, {
    analyzeText: async (text) => [analyzed(text)],
    verifyExpression: (item) => verifications[item.text]()
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const lookup = (expression) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ expression })
    }).then((response) => response.json());

  const rejected = await lookup('jerga rechazada');
  assert.deepEqual(rejected.entries, []);
  assert.deepEqual(rejected.unresolved, [
    { text: 'jerga rechazada', reason: 'unknown', suggestion: null }
  ]);

  const unavailable = await lookup('jerga sin verificar');
  assert.equal(unavailable.entries[0].id, null);
  assert.equal(unavailable.entries[0].classification, 'regional');

  const stored = await pool.query(
    "SELECT id FROM expressions WHERE normalized_expression IN ('jerga rechazada', 'jerga sin verificar')"
  );
  assert.equal(stored.rows.length, 0);
  await new Promise((resolve) => server.close(resolve));
});

test('el verificador solo acepta un sí explícito', async () => {
  const answer = (content) =>
    createAiVerifier({
      apiKey: 'test-key',
      fetchImplementation: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] })
      })
    })(analyzed('palabra'));

  assert.equal(await answer('{"verified":true}'), true);
  assert.equal(await answer('{"verified":false}'), false);
  assert.equal(await answer('{"verified":"true"}'), false);
  assert.equal(await answer('{}'), false);
});

test('lookup valida longitud y atiende consultas simultáneas', async () => {
  const { cookie } = await registerUser();
  const invalid = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'x'.repeat(301) })
  });
  assert.equal(invalid.status, 400);

  const emptyQuoted = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '"   "' })
  });
  assert.equal(emptyQuoted.status, 400);

  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      fetch(`${baseUrl}/api/lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ expression: 'parcero' })
      })
    )
  );
  assert.ok(responses.every((response) => response.status === 200));
});

test('el historial de una cuenta no es visible para otra', async () => {
  const firstUser = await registerUser('Primera cuenta');
  const secondUser = await registerUser('Segunda cuenta');
  await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: firstUser.cookie },
    body: JSON.stringify({ expression: 'parcero' })
  });

  const firstHistory = await fetch(`${baseUrl}/api/history`, {
    headers: { cookie: firstUser.cookie }
  }).then((response) => response.json());
  const secondHistory = await fetch(`${baseUrl}/api/history`, {
    headers: { cookie: secondUser.cookie }
  }).then((response) => response.json());

  assert.equal(firstHistory.items.length, 1);
  assert.equal(secondHistory.items.length, 0);
});

test('incluye migración idempotente para el historial de instalaciones existentes', async () => {
  const statements = [];
  const client = {
    query: async (statement) => {
      statements.push(statement);
      return { rows: [] };
    },
    release() {}
  };

  await initializeDatabase({ connect: async () => client });

  const migration = statements.find((statement) =>
    statement.includes('ALTER TABLE search_history')
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users\(id\) ON DELETE SET NULL/i
  );
  assert.match(
    statements.join('\n'),
    /ADD COLUMN IF NOT EXISTS result_source TEXT NOT NULL DEFAULT 'not_found'/i
  );
});

test('analizador IA valida JSON y usa Gemini con respuestas acotadas por defecto', async () => {
  let requestedUrl;
  let requestedBody;
  const analyzeText = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async (url, options) => {
      requestedUrl = url;
      requestedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: analysisContent('palabra nueva') } }]
        })
      };
    }
  });

  const [item] = await analyzeText('palabra nueva');
  assert.equal(
    requestedUrl,
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  );
  assert.equal(requestedBody.model, 'gemini-3.5-flash-lite');
  assert.equal(requestedBody.max_tokens, 1400);
  assert.equal(item.text, 'palabra nueva');
  assert.equal(item.definition.meaning, 'Significado');
});

test('analizador IA desactivado sin clave y descarta respuestas incompletas', async () => {
  const disabledProvider = createAiAnalyzer({ apiKey: '' });
  await assert.rejects(disabledProvider('palabra'), { code: 'AI_NOT_CONFIGURED' });

  const invalidProvider = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"meaning":"Solo esto"}' } }] })
    })
  });
  await assert.rejects(invalidProvider('palabra'), { code: 'AI_INVALID_RESPONSE' });
});

test('lookup explica cuando falta LLM_API_KEY y no guarda la expresión', async () => {
  const { cookie } = await registerUser();
  const unavailableServer = createApp(pool, {
    analyzeText: createAiAnalyzer({ apiKey: '' })
  }).listen(0);
  await new Promise((resolve) => unavailableServer.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '“cachon”' })
  });
  const result = await response.json();
  await new Promise((resolve, reject) =>
    unavailableServer.close((error) => (error ? reject(error) : resolve()))
  );

  assert.equal(result.found, false);
  assert.match(result.message, /LLM_API_KEY/);
});

test('analizador IA reintenta ante 503 y completa el análisis', async () => {
  let calls = 0;
  const analyzeText = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'UNAVAILABLE' } })
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: analysisContent('palabra nueva') } }]
        })
      };
    }
  });

  const [item] = await analyzeText('palabra nueva');
  assert.equal(calls, 2);
  assert.equal(item.definition.meaning, 'Significado');
});

test('un 503 de Gemini explica el fallo y no guarda la expresión', async () => {
  const { cookie } = await registerUser();
  const unavailableServer = createApp(pool, {
    analyzeText: async () => {
      const error = new Error('UNAVAILABLE');
      error.status = 503;
      throw error;
    }
  }).listen(0);
  await new Promise((resolve) => unavailableServer.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '“cachon”' })
  });
  const result = await response.json();
  const saved = await pool.query('SELECT id FROM expressions WHERE normalized_expression = $1', [
    'cachon'
  ]);
  await new Promise((resolve, reject) =>
    unavailableServer.close((error) => (error ? reject(error) : resolve()))
  );

  assert.equal(result.found, false);
  assert.match(result.message, /Gemini no pudo responder.*503.*no se agregó/);
  assert.equal(saved.rows.length, 0);
});

test('un 429 explica que se alcanzó la cuota y no agrega la expresión', async () => {
  const { cookie } = await registerUser();
  const limitedServer = createApp(pool, {
    analyzeText: async () => {
      const error = new Error('RESOURCE_EXHAUSTED');
      error.status = 429;
      throw error;
    }
  }).listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${limitedServer.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '“palabra con cuota”' })
  });
  const result = await response.json();
  const saved = await pool.query('SELECT id FROM expressions WHERE normalized_expression = $1', [
    'palabra con cuota'
  ]);
  await new Promise((resolve, reject) =>
    limitedServer.close((error) => (error ? reject(error) : resolve()))
  );

  assert.equal(result.found, false);
  assert.match(result.message, /límite de solicitudes de este proyecto/);
  assert.equal(saved.rows.length, 0);
});

test('analizador IA limita los reintentos y usa espera exponencial', async () => {
  let calls = 0;
  const waits = [];
  const analyzeText = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({ error: { message: 'UNAVAILABLE' } }) };
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds),
    randomImplementation: () => 0
  });

  await assert.rejects(analyzeText('palabra nueva'), { status: 503 });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('analizador IA no reintenta un 429 de cuota', async () => {
  let calls = 0;
  const waits = [];
  const analyzeText = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } })
      };
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds)
  });

  await assert.rejects(analyzeText('palabra nueva'), { status: 429 });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('analizador IA reintenta los timeouts y termina con error 504', async () => {
  let calls = 0;
  const waits = [];
  const analyzeText = createAiAnalyzer({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds),
    randomImplementation: () => 0
  });

  await assert.rejects(analyzeText('palabra nueva'), {
    status: 504,
    message: 'Gemini agotó el tiempo de espera.'
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});
test('translate traduce una expresión guardada una sola vez y luego usa la copia guardada', async () => {
  const { cookie } = await registerUser();
  let calls = 0;
  const translatingServer = createApp(pool, {
    analyzeText: async () => [],
    translateDefinition: async (definition) => {
      calls += 1;
      assert.equal(definition.expression, 'parcero');
      return {
        expression: definition.expression,
        meaning: 'A close friend',
        region: 'Antioquia',
        context: 'Informal',
        equivalent: 'buddy',
        example: 'My parcero helped me.'
      };
    }
  }).listen(0);
  await new Promise((resolve) => translatingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${translatingServer.address().port}/api`;
  const headers = { 'content-type': 'application/json', cookie };

  const lookup = await fetch(`${url}/lookup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: 'parcero' })
  });
  const {
    entries: [entry]
  } = await lookup.json();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${url}/translate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: entry.id })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).translation.meaning, 'A close friend');
  }
  assert.equal(calls, 1);

  const stored = await pool.query('SELECT meaning FROM expressions WHERE id = $1', [entry.id]);
  assert.notEqual(stored.rows[0].meaning, 'A close friend');

  await new Promise((resolve) => translatingServer.close(resolve));
});

test('translate acepta definiciones temporales, valida los datos y exige sesión', async () => {
  const { cookie } = await registerUser();
  let received;
  const translatingServer = createApp(pool, {
    analyzeText: async () => [],
    translateDefinition: async (definition) => {
      received = definition;
      return { ...definition, meaning: 'Translated' };
    }
  }).listen(0);
  await new Promise((resolve) => translatingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${translatingServer.address().port}/api/translate`;
  const headers = { 'content-type': 'application/json', cookie };
  const temporary = {
    id: null,
    expression: 'estar tragado',
    meaning: 'Enamorado',
    region: 'Colombia',
    context: 'Informal',
    equivalent: 'enamorado',
    example: 'Está tragado.'
  };

  const translated = await fetch(url, { method: 'POST', headers, body: JSON.stringify(temporary) });
  assert.equal(translated.status, 200);
  assert.equal((await translated.json()).translation.meaning, 'Translated');
  assert.equal(received.expression, 'estar tragado');

  const incomplete = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: 'estar tragado' })
  });
  assert.equal(incomplete.status, 400);

  const missing = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 999999 })
  });
  assert.equal(missing.status, 404);

  const anonymous = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(temporary)
  });
  assert.equal(anonymous.status, 401);

  await new Promise((resolve) => translatingServer.close(resolve));
});

test('translate responde 502 y no guarda nada si la IA falla', async () => {
  const { cookie } = await registerUser();
  const failingServer = createApp(pool, {
    analyzeText: async () => [],
    translateDefinition: async () => {
      throw new Error('UNAVAILABLE');
    }
  }).listen(0);
  await new Promise((resolve) => failingServer.once('listening', resolve));
  const row = (await pool.query("SELECT id FROM expressions WHERE normalized_expression = 'tinto'"))
    .rows[0];

  const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id: Number(row.id) })
  });
  assert.equal(response.status, 502);
  const stored = await pool.query(
    'SELECT 1 FROM expression_translations WHERE expression_id = $1',
    [row.id]
  );
  assert.equal(stored.rows.length, 0);

  await new Promise((resolve) => failingServer.close(resolve));
});

test('el traductor envía la definición como datos y valida la respuesta', async () => {
  let body;
  const translate = createAiTranslator({
    apiKey: 'test-key',
    fetchImplementation: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  meaning: 'Friend',
                  region: 'Antioquia',
                  context: 'Informal',
                  equivalent: 'buddy',
                  example: 'My parcero.'
                })
              }
            }
          ]
        })
      };
    }
  });
  const result = await translate({
    expression: 'parcero',
    meaning: 'Amigo',
    region: 'Antioquia',
    context: 'Informal',
    equivalent: 'amigo',
    example: 'Mi parcero.'
  });
  assert.equal(result.meaning, 'Friend');
  assert.equal(result.expression, 'parcero');
  assert.equal(JSON.parse(body.messages[1].content).meaning, 'Amigo');
  assert.equal(body.max_tokens, 800);

  await assert.rejects(createAiTranslator({ apiKey: '' })({ expression: 'x' }), {
    code: 'AI_NOT_CONFIGURED'
  });
});

test('un JSON inválido o demasiado grande responde como error del cliente', async () => {
  const headers = { 'content-type': 'application/json' };
  const malformed = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers,
    body: '{ no es json'
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'La solicitud no es válida.');

  const tooLarge = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'x'.repeat(20000) })
  });
  assert.equal(tooLarge.status, 413);
});

test('lookup indica con un código el motivo por el que no hay definición', async () => {
  const { cookie } = await registerUser();
  const failures = [
    [Object.assign(new Error('x'), { code: 'AI_NOT_CONFIGURED' }), 'not_configured'],
    [Object.assign(new Error('x'), { code: 'AI_INVALID_RESPONSE' }), 'invalid_response'],
    [Object.assign(new Error('x'), { status: 429 }), 'quota_exceeded'],
    [Object.assign(new Error('x'), { status: 503 }), 'provider_unavailable']
  ];

  for (const [failure, reason] of failures) {
    const failingServer = createApp(pool, {
      analyzeText: async () => {
        throw failure;
      }
    }).listen(0);
    await new Promise((resolve) => failingServer.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ expression: 'palabra sin definicion' })
    });
    assert.equal((await response.json()).reason, reason);
    await new Promise((resolve) => failingServer.close(resolve));
  }
});

test('el limitador cuenta por clave y se reinicia al terminar la ventana', () => {
  let time = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 100, now: () => time });
  assert.equal(limiter.tryConsume('ana'), true);
  assert.equal(limiter.tryConsume('ana'), true);
  assert.equal(limiter.tryConsume('ana'), false);
  assert.equal(limiter.tryConsume('luis'), true);
  time = 101;
  assert.equal(limiter.tryConsume('ana'), true);
  limiter.tryConsume('ana');
  limiter.reset('ana');
  assert.equal(limiter.isLimited('ana'), false);
});

test('la IA tiene un límite por cuenta que no afecta las palabras del diccionario', async () => {
  const { cookie } = await registerUser();
  let calls = 0;
  const limitedServer = createApp(pool, {
    analyzeText: async () => {
      calls += 1;
      return [];
    },
    translateDefinition: async () => {
      throw new Error('no debería llamarse');
    },
    aiLimiter: createRateLimiter({ max: 1, windowMs: 60000 })
  }).listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${limitedServer.address().port}/api`;
  const headers = { 'content-type': 'application/json', cookie };
  const lookup = async (expression) =>
    (
      await fetch(`${url}/lookup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expression })
      })
    ).json();

  assert.equal((await lookup('primera nueva')).reason, 'not_found');
  assert.equal((await lookup('segunda nueva')).reason, 'rate_limited');
  assert.equal(calls, 1);
  assert.equal((await lookup('parcero')).found, true);

  const translation = await fetch(`${url}/translate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'x',
      meaning: 'a',
      region: 'b',
      context: 'c',
      equivalent: 'd',
      example: 'e'
    })
  });
  assert.equal(translation.status, 429);
  assert.equal((await translation.json()).code, 'rate_limited');

  await new Promise((resolve) => limitedServer.close(resolve));
});

test('el ingreso se bloquea tras varios intentos fallidos y un acierto reinicia la cuenta', async () => {
  const limitedServer = createApp(pool, {
    loginLimiter: createRateLimiter({ max: 2, windowMs: 60000 })
  }).listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${limitedServer.address().port}/api/auth`;
  const headers = { 'content-type': 'application/json' };
  const email = 'bloqueo@example.com';
  await fetch(`${url}/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Ana', email, password: 'password123' })
  });
  const login = (password) =>
    fetch(`${url}/login`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });

  assert.equal((await login('incorrecta')).status, 401);
  assert.equal((await login('password123')).status, 200);
  assert.equal((await login('incorrecta')).status, 401);
  assert.equal((await login('incorrecta')).status, 401);
  assert.equal((await login('password123')).status, 429);

  await new Promise((resolve) => limitedServer.close(resolve));
});

test('una palabra común a una letra de una jerga se explica y no se toma como error', async () => {
  const { cookie } = await registerUser();
  const server = createApp(pool, {
    analyzeText: async (text) => [analyzed(text, { type: 'common', countries: [] })]
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'rumbo' })
  }).then((response) => response.json());
  await new Promise((resolve) => server.close(resolve));

  assert.deepEqual(result.unresolved, []);
  assert.equal(result.entries[0].expression, 'rumbo');
  assert.equal(result.entries[0].classification, 'common');
});

test('solo se quitan las comillas que envuelven todo el texto', () => {
  assert.equal(stripWrappingQuotes('  "hacer vaca" '), 'hacer vaca');
  assert.equal(stripWrappingQuotes('«pana»'), 'pana');
  assert.equal(stripWrappingQuotes('"parcero" y "mochila"'), '"parcero" y "mochila"');
  assert.equal(stripWrappingQuotes('"'), '"');
  assert.equal(stripWrappingQuotes('parcero'), 'parcero');
});

test('las verificaciones cuentan para el límite y sin cupo la palabra se explica sin guardarse', async () => {
  const { cookie } = await registerUser();
  let verifications = 0;
  const server = createApp(pool, {
    analyzeText: async () => [analyzed('jerga uno'), analyzed('jerga dos')],
    verifyExpression: async () => {
      verifications += 1;
      return true;
    },
    aiLimiter: createRateLimiter({ max: 2, windowMs: 60000 })
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'jerga uno y jerga dos' })
  }).then((response) => response.json());
  await new Promise((resolve) => server.close(resolve));

  assert.equal(verifications, 1);
  assert.ok(result.entries[0].id);
  assert.equal(result.entries[1].id, null);
});

test('el limitador mantiene acotada la memoria y descarta primero lo más antiguo', () => {
  let time = 0;
  const limiter = createRateLimiter({ max: 1, windowMs: 100, maxKeys: 2, now: () => time });
  limiter.record('a');
  limiter.record('b');
  limiter.record('c');
  assert.equal(limiter.isLimited('a'), false);
  assert.equal(limiter.isLimited('b'), true);
  assert.equal(limiter.isLimited('c'), true);

  time = 200;
  limiter.record('d');
  assert.equal(limiter.isLimited('b'), false);
});

test('un correo demasiado largo se rechaza sin contar como intento', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x'.repeat(255), password: 'password123' })
  });
  assert.equal(response.status, 401);
});

test('una ruta inexistente responde JSON y el servidor no revela su tecnología', async () => {
  const response = await fetch(`${baseUrl}/api/no-existe`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /json/);
  assert.equal((await response.json()).error, 'La ruta no existe.');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('el manejador de errores delega si la respuesta ya empezó', () => {
  const failure = new Error('tarde');
  let delegated = null;
  errorHandler(failure, {}, { headersSent: true }, (error) => {
    delegated = error;
  });
  assert.equal(delegated, failure);
});
