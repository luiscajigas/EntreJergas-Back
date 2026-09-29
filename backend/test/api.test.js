const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { newDb } = require('pg-mem');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');

let pool;
let server;
let baseUrl;

before(async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  pool = new Pool();
  await initializeDatabase(pool);
  server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool?.end();
});

test('health confirma que la base PostgreSQL responde', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'entrejergas-api' });
});

test('lookup normaliza tildes, registra búsquedas y conserva el contrato REST', async () => {
  const knownResponse = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expression: '¿Qué chimba?' })
  });
  const known = await knownResponse.json();
  assert.equal(known.found, true);
  assert.equal(known.entry.expression, 'qué chimba');
  assert.equal(known.entry.source, 'database');

  const missingResponse = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expression: 'una frase nueva' })
  });
  const missing = await missingResponse.json();
  assert.equal(missing.found, false);
  assert.equal(missing.entry, null);

  const history = await fetch(`${baseUrl}/api/history`).then((response) => response.json());
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].expression, 'una frase nueva');

  const dashboard = await fetch(`${baseUrl}/api/dashboard`).then((response) => response.json());
  assert.equal(dashboard.expressions, 16);
  assert.equal(dashboard.searches, 2);
  assert.ok(dashboard.regions.every((region) => Number.isInteger(region.count)));
});

test('lookup valida longitud y atiende consultas simultáneas', async () => {
  const invalid = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expression: 'x'.repeat(101) })
  });
  assert.equal(invalid.status, 400);

  const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expression: 'parcero' })
  })));
  assert.ok(responses.every((response) => response.status === 200));
});