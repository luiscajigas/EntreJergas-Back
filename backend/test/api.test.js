const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { newDb } = require('pg-mem');
const { createApp } = require('../src/app');
const { createAiProvider, createAiTranslator } = require('../src/ai-provider');
const { initializeDatabase } = require('../src/database');
const { createRateLimiter } = require('../src/rate-limiter');

let pool;
let server;
let baseUrl;
let userSequence = 0;

before(async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  pool = new Pool();
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
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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

test('lookup prioriza el diccionario y usa IA para expresiones que no existen', async () => {
  const { cookie } = await registerUser();
  let generatedCount = 0;
  const aiServer = createApp(pool, {
    generateDefinition: async (expression) => {
      generatedCount += 1;
      return {
        expression,
        meaning: 'Expresión de prueba.',
        region: 'No identificada con certeza',
        context: 'Uso coloquial; verifica el contexto local.',
        equivalent: 'frase equivalente',
        example: `Dijo: ${expression}.`
      };
    }
  }).listen(0);
  await new Promise((resolve) => aiServer.once('listening', resolve));
  const aiBaseUrl = `http://127.0.0.1:${aiServer.address().port}`;

  const knownResponse = await fetch(`${aiBaseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '¿Qué chimba?' })
  });
  const known = await knownResponse.json();
  assert.equal(known.found, true);
  assert.equal(known.entry.expression, 'qué chimba');
  assert.equal(known.entry.source, 'database');
  assert.equal(generatedCount, 0);

  const missingResponse = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'una frase nueva' })
  });
  const missing = await missingResponse.json();
  assert.equal(missing.found, false);
  assert.equal(missing.entry, null);

  const aiResponse = await fetch(`${aiBaseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'una frase nueva' })
  });
  const aiResult = await aiResponse.json();
  assert.equal(aiResult.found, true);
  assert.equal(aiResult.entry.source, 'ai');
  assert.equal(aiResult.entry.id, null);
  assert.equal(generatedCount, 1);

  const quotedResponse = await fetch(`${aiBaseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '“una frase nueva”' })
  });
  const quotedResult = await quotedResponse.json();
  assert.equal(quotedResult.entry.expression, 'una frase nueva');
  assert.equal(quotedResult.entry.source, 'ai');
  assert.ok(quotedResult.entry.id);
  assert.equal(generatedCount, 2);

  const savedResponse = await fetch(`${aiBaseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'una frase nueva' })
  });
  const savedResult = await savedResponse.json();
  assert.equal(savedResult.entry.source, 'ai');
  assert.equal(generatedCount, 2);
  await new Promise((resolve, reject) => aiServer.close((error) => error ? reject(error) : resolve()));

  const history = await fetch(`${baseUrl}/api/history`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(history.items.length, 5);
  assert.equal(history.items[0].expression, 'una frase nueva');
  assert.equal(history.items[0].source, 'ai_saved');
  assert.equal(history.items[1].source, 'ai_saved');
  assert.equal(history.items[2].source, 'ai');
  assert.equal(history.items[3].source, 'not_found');
  assert.equal(history.items[4].source, 'database');

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(dashboard.expressions, 17);
  assert.equal(dashboard.searches, 5);
  assert.ok(dashboard.regions.every((region) => Number.isInteger(region.count)));
});

test('lookup valida longitud y atiende consultas simultáneas', async () => {
  const { cookie } = await registerUser();
  const invalid = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'x'.repeat(101) })
  });
  assert.equal(invalid.status, 400);

  const emptyQuoted = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '"   "' })
  });
  assert.equal(emptyQuoted.status, 400);

  const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: 'parcero' })
  })));
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

  const migration = statements.find((statement) => statement.includes('ALTER TABLE search_history'));
  assert.match(migration, /ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users\(id\) ON DELETE SET NULL/i);
  assert.match(statements.join('\n'), /ADD COLUMN IF NOT EXISTS result_source TEXT NOT NULL DEFAULT 'not_found'/i);
});

test('proveedor IA valida JSON y usa Gemini con respuestas acotadas por defecto', async () => {
  let requestedUrl;
  let requestedBody;
  const generateDefinition = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async (url, options) => {
      requestedUrl = url;
      requestedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            meaning: 'Significado',
            region: 'Región',
            context: 'Contexto',
            equivalent: 'Equivalente',
            example: 'Ejemplo'
          }) } }]
        })
      };
    }
  });

  const definition = await generateDefinition('palabra nueva');
  assert.equal(requestedUrl, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(requestedBody.model, 'gemini-3.5-flash-lite');
  assert.equal(requestedBody.max_tokens, 400);
  assert.equal(definition.expression, 'palabra nueva');
  assert.equal(definition.meaning, 'Significado');
});

test('proveedor IA desactivado sin clave y descarta respuestas incompletas', async () => {
  const disabledProvider = createAiProvider({ apiKey: '' });
  await assert.rejects(disabledProvider('palabra'), { code: 'AI_NOT_CONFIGURED' });

  const invalidProvider = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"meaning":"Solo esto"}' } }] })
    })
  });
  await assert.rejects(invalidProvider('palabra'), { code: 'AI_INVALID_RESPONSE' });
});

test('lookup explica cuando falta LLM_API_KEY y no guarda la expresión citada', async () => {
  const { cookie } = await registerUser();
  const unavailableServer = createApp(pool, {
    generateDefinition: createAiProvider({ apiKey: '' })
  }).listen(0);
  await new Promise((resolve) => unavailableServer.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ expression: '“cachon”' })
  });
  const result = await response.json();
  await new Promise((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()));

  assert.equal(result.found, false);
  assert.match(result.message, /LLM_API_KEY/);
});

test('proveedor IA reintenta ante 503 y completa la definición', async () => {
  let calls = 0;
  const generateDefinition = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({ error: { message: 'UNAVAILABLE' } }) };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          meaning: 'Significado',
          region: 'Región',
          context: 'Contexto',
          equivalent: 'Equivalente',
          example: 'Ejemplo'
        }) } }] })
      };
    }
  });

  const definition = await generateDefinition('palabra nueva');
  assert.equal(calls, 2);
  assert.equal(definition.meaning, 'Significado');
});

test('un 503 de Gemini explica el fallo y no guarda la expresión citada', async () => {
  const { cookie } = await registerUser();
  const unavailableServer = createApp(pool, {
    generateDefinition: async () => {
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
  const saved = await pool.query(
    'SELECT id FROM expressions WHERE normalized_expression = $1',
    ['cachon']
  );
  await new Promise((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()));

  assert.equal(result.found, false);
  assert.match(result.message, /Gemini no pudo responder.*503.*no se agregó/);
  assert.equal(saved.rows.length, 0);
});

test('un 429 explica que se alcanzó la cuota y no agrega la expresión', async () => {
  const { cookie } = await registerUser();
  const limitedServer = createApp(pool, {
    generateDefinition: async () => {
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
  const saved = await pool.query(
    'SELECT id FROM expressions WHERE normalized_expression = $1',
    ['palabra con cuota']
  );
  await new Promise((resolve, reject) => limitedServer.close((error) => error ? reject(error) : resolve()));

  assert.equal(result.found, false);
  assert.match(result.message, /límite de solicitudes de este proyecto/);
  assert.equal(saved.rows.length, 0);
});

test('proveedor IA limita los reintentos y usa espera exponencial', async () => {
  let calls = 0;
  const waits = [];
  const generateDefinition = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({ error: { message: 'UNAVAILABLE' } }) };
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds),
    randomImplementation: () => 0
  });

  await assert.rejects(generateDefinition('palabra nueva'), { status: 503 });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('proveedor IA no reintenta un 429 de cuota', async () => {
  let calls = 0;
  const waits = [];
  const generateDefinition = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      return { ok: false, status: 429, json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } }) };
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds)
  });

  await assert.rejects(generateDefinition('palabra nueva'), { status: 429 });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('proveedor IA reintenta los timeouts y termina con error 504', async () => {
  let calls = 0;
  const waits = [];
  const generateDefinition = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => {
      calls += 1;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    waitImplementation: async (milliseconds) => waits.push(milliseconds),
    randomImplementation: () => 0
  });

  await assert.rejects(generateDefinition('palabra nueva'), {
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
    generateDefinition: async () => null,
    translateDefinition: async (definition) => {
      calls += 1;
      assert.equal(definition.expression, 'parcero');
      return { expression: definition.expression, meaning: 'A close friend', region: 'Antioquia', context: 'Informal', equivalent: 'buddy', example: 'My parcero helped me.' };
    }
  }).listen(0);
  await new Promise((resolve) => translatingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${translatingServer.address().port}/api`;
  const headers = { 'content-type': 'application/json', cookie };

  const lookup = await fetch(`${url}/lookup`, { method: 'POST', headers, body: JSON.stringify({ expression: 'parcero' }) });
  const { entry } = await lookup.json();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${url}/translate`, { method: 'POST', headers, body: JSON.stringify({ id: entry.id }) });
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
    generateDefinition: async () => null,
    translateDefinition: async (definition) => {
      received = definition;
      return { ...definition, meaning: 'Translated' };
    }
  }).listen(0);
  await new Promise((resolve) => translatingServer.once('listening', resolve));
  const url = `http://127.0.0.1:${translatingServer.address().port}/api/translate`;
  const headers = { 'content-type': 'application/json', cookie };
  const temporary = { id: null, expression: 'estar tragado', meaning: 'Enamorado', region: 'Colombia', context: 'Informal', equivalent: 'enamorado', example: 'Está tragado.' };

  const translated = await fetch(url, { method: 'POST', headers, body: JSON.stringify(temporary) });
  assert.equal(translated.status, 200);
  assert.equal((await translated.json()).translation.meaning, 'Translated');
  assert.equal(received.expression, 'estar tragado');

  const incomplete = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ expression: 'estar tragado' }) });
  assert.equal(incomplete.status, 400);

  const missing = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ id: 999999 }) });
  assert.equal(missing.status, 404);

  const anonymous = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(temporary) });
  assert.equal(anonymous.status, 401);

  await new Promise((resolve) => translatingServer.close(resolve));
});

test('translate responde 502 y no guarda nada si la IA falla', async () => {
  const { cookie } = await registerUser();
  const failingServer = createApp(pool, {
    generateDefinition: async () => null,
    translateDefinition: async () => { throw new Error('UNAVAILABLE'); }
  }).listen(0);
  await new Promise((resolve) => failingServer.once('listening', resolve));
  const row = (await pool.query("SELECT id FROM expressions WHERE normalized_expression = 'tinto'")).rows[0];

  const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id: Number(row.id) })
  });
  assert.equal(response.status, 502);
  const stored = await pool.query('SELECT 1 FROM expression_translations WHERE expression_id = $1', [row.id]);
  assert.equal(stored.rows.length, 0);

  await new Promise((resolve) => failingServer.close(resolve));
});

test('el traductor envía la definición como datos y valida la respuesta', async () => {
  let body;
  const translate = createAiTranslator({
    apiKey: 'test-key',
    fetchImplementation: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ meaning: 'Friend', region: 'Antioquia', context: 'Informal', equivalent: 'buddy', example: 'My parcero.' }) } }] }) };
    }
  });
  const result = await translate({ expression: 'parcero', meaning: 'Amigo', region: 'Antioquia', context: 'Informal', equivalent: 'amigo', example: 'Mi parcero.' });
  assert.equal(result.meaning, 'Friend');
  assert.equal(result.expression, 'parcero');
  assert.equal(JSON.parse(body.messages[1].content).meaning, 'Amigo');
  assert.equal(body.max_tokens, 800);

  await assert.rejects(createAiTranslator({ apiKey: '' })({ expression: 'x' }), { code: 'AI_NOT_CONFIGURED' });
});

test('un JSON inválido o demasiado grande responde como error del cliente', async () => {
  const headers = { 'content-type': 'application/json' };
  const malformed = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers, body: '{ no es json' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'La solicitud no es válida.');

  const tooLarge = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'x'.repeat(20000) }) });
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
    const failingServer = createApp(pool, { generateDefinition: async () => { throw failure; } }).listen(0);
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
    generateDefinition: async () => { calls += 1; return null; },
    translateDefinition: async () => { throw new Error('no debería llamarse'); },
    aiLimiter: createRateLimiter({ max: 1, windowMs: 60000 })
  }).listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const url = `http://127.0.0.1:${limitedServer.address().port}/api`;
  const headers = { 'content-type': 'application/json', cookie };
  const lookup = async (expression) => (await fetch(`${url}/lookup`, { method: 'POST', headers, body: JSON.stringify({ expression }) })).json();

  assert.equal((await lookup('primera nueva')).reason, 'not_found');
  assert.equal((await lookup('segunda nueva')).reason, 'rate_limited');
  assert.equal(calls, 1);
  assert.equal((await lookup('parcero')).found, true);

  const translation = await fetch(`${url}/translate`, { method: 'POST', headers, body: JSON.stringify({ expression: 'x', meaning: 'a', region: 'b', context: 'c', equivalent: 'd', example: 'e' }) });
  assert.equal(translation.status, 429);
  assert.equal((await translation.json()).code, 'rate_limited');

  await new Promise((resolve) => limitedServer.close(resolve));
});
