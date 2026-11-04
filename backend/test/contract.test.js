const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { default: Ajv } = require('ajv/dist/2020');
const { default: addFormats } = require('ajv-formats');
const { newDb } = require('pg-mem');
const YAML = require('yaml');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');

const contract = YAML.parse(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
ajv.addSchema(contract, 'contract');

function assertMatchesContract(schema, body) {
  const validate = ajv.compile({ $ref: `contract#/components/schemas/${schema}` });
  assert.ok(validate(body), `${schema}: ${JSON.stringify(validate.errors)}`);
}

const definition = { meaning: 'Significado', region: 'Colombia', context: 'Informal', equivalent: 'Algo', example: 'Un ejemplo.' };
const item = (text, overrides = {}) => ({
  text, type: 'regional', confidence: 'high', suggestion: null, countries: ['AR'], register: 'vulgar',
  definition: { expression: text, ...definition }, ...overrides
});
let pool;
let server;
let baseUrl;

before(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await initializeDatabase(pool);
  server = createApp(pool, {
    verifyExpression: async () => true,
    analyzeText: async (text) => {
      if (text === 'nada') return [];
      if (text === 'palabra temporal') return [item(text, { type: 'common', countries: [] })];
      if (text === 'typo') return [item(text, { type: 'typo', suggestion: 'parcero', definition: null })];
      return [item(text)];
    },
    translateDefinition: async ({ expression }) => ({ expression, ...definition, meaning: 'Meaning' })
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('todas las rutas del contrato existen en el servidor', async () => {
  for (const [route, operations] of Object.entries(contract.paths)) {
    for (const method of Object.keys(operations)) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: method.toUpperCase(),
        headers: { 'content-type': 'application/json' },
        body: method === 'get' ? undefined : '{}'
      });
      assert.notEqual(response.status, 404, `${method} ${route} no existe`);
    }
  }
});

test('las respuestas del servidor cumplen el contrato', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assertMatchesContract('HealthResponse', await health.json());

  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ana', email: 'contrato@example.com', password: 'password123' })
  });
  assert.equal(registered.status, 201);
  assertMatchesContract('AuthResponse', await registered.json());
  const headers = { 'content-type': 'application/json', cookie: registered.headers.get('set-cookie').split(';')[0] };

  const post = (route, body) => fetch(`${baseUrl}/api${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const lookups = [];
  for (const expression of ['parcero', 'palabra temporal', '"palabra guardada"', 'nada', 'typo']) {
    const body = await (await post('/lookup', { expression })).json();
    assertMatchesContract('LookupResponse', body);
    lookups.push(body);
  }
  assert.equal(lookups[1].entry.id, null);
  assert.equal(lookups[3].entry, null);
  assert.equal(lookups[4].unresolved[0].suggestion, 'parcero');

  const saved = await post('/translate', { id: lookups[0].entry.id });
  assertMatchesContract('TranslateResponse', await saved.json());
  const temporary = await post('/translate', lookups[1].entry);
  assertMatchesContract('TranslateResponse', await temporary.json());

  assertMatchesContract('AuthResponse', await (await fetch(`${baseUrl}/api/auth/me`, { headers })).json());
  assertMatchesContract('HistoryResponse', await (await fetch(`${baseUrl}/api/history`, { headers })).json());
  assertMatchesContract('DashboardResponse', await (await fetch(`${baseUrl}/api/dashboard`, { headers })).json());

  const invalid = await post('/lookup', { expression: '' });
  assert.equal(invalid.status, 400);
  assertMatchesContract('ErrorResponse', await invalid.json());
});
