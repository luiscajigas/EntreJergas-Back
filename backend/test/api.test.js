const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { newDb } = require('pg-mem');
const { createApp } = require('../src/app');
const { createAiProvider } = require('../src/ai-provider');
const { initializeDatabase } = require('../src/database');

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
  await new Promise((resolve, reject) => aiServer.close((error) => error ? reject(error) : resolve()));

  const history = await fetch(`${baseUrl}/api/history`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(history.items.length, 3);
  assert.equal(history.items[0].expression, 'una frase nueva');
  assert.equal(history.items[0].source, 'ai');
  assert.equal(history.items[1].source, 'not_found');
  assert.equal(history.items[2].source, 'database');

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(dashboard.expressions, 16);
  assert.equal(dashboard.searches, 3);
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
  assert.equal(requestedBody.model, 'gemini-3.8-flash');
  assert.equal(requestedBody.max_tokens, 400);
  assert.equal(definition.expression, 'palabra nueva');
  assert.equal(definition.meaning, 'Significado');
});

test('proveedor IA desactivado sin clave y descarta respuestas incompletas', async () => {
  const disabledProvider = createAiProvider({ apiKey: '' });
  assert.equal(await disabledProvider('palabra'), null);

  const invalidProvider = createAiProvider({
    apiKey: 'test-key',
    fetchImplementation: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"meaning":"Solo esto"}' } }] })
    })
  });
  assert.equal(await invalidProvider('palabra'), null);
});