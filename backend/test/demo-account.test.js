const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/passwords');
const { initializeDatabase } = require('../src/database');
const { demoAccount, ensureDemoAccount } = require('../src/demo-account');
const { createRateLimiter } = require('../src/rate-limiter');
const { createUserRepository } = require('../src/repositories/users');
const { createRealPool } = require('../test-support/real-database');

let pool;
let users;
let server;
let baseUrl;

before(async () => {
  ({ pool } = createRealPool());
  await initializeDatabase(pool);
  users = createUserRepository(pool);
  server = createApp(pool, { loginLimiter: createRateLimiter({ max: 2, windowMs: 60000 }) }).listen(
    0
  );
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const login = (password, email = demoAccount.email) =>
  fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

test('la cuenta de prueba cumple las reglas de registro y permite entrar', async () => {
  assert.ok(demoAccount.password.length >= 8);
  await ensureDemoAccount(users);
  const response = await login(demoAccount.password);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, demoAccount.email);
});

test('crearla varias veces no la duplica y restablece su contraseña', async () => {
  await users.createOrResetPassword({
    email: demoAccount.email,
    name: 'x',
    passwordHash: await hashPassword('otra-clave')
  });
  assert.equal((await login(demoAccount.password)).status, 401);

  await ensureDemoAccount(users);
  await ensureDemoAccount(users);
  assert.equal((await login(demoAccount.password)).status, 200);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [
    demoAccount.email
  ]);
  assert.equal(rows[0].count, 1);
});

test('los intentos fallidos no bloquean la cuenta de prueba, pero sí las demás', async () => {
  await ensureDemoAccount(users);
  for (let attempt = 0; attempt < 5; attempt += 1) await login('incorrecta');
  assert.equal((await login(demoAccount.password)).status, 200);

  await users.createOrResetPassword({
    email: 'otra@example.com',
    name: 'Otra',
    passwordHash: await hashPassword('password123')
  });
  for (let attempt = 0; attempt < 2; attempt += 1) await login('incorrecta', 'otra@example.com');
  assert.equal((await login('password123', 'otra@example.com')).status, 429);
});
