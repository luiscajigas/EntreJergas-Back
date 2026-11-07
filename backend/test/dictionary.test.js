const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');
const { buildRound } = require('../src/game');
const { seedExpressions } = require('../src/seed-expressions');
const { createRealPool } = require('../test-support/real-database');

let pool;
let server;
let baseUrl;
let headers;

before(async () => {
  ({ pool } = createRealPool());
  await initializeDatabase(pool);
  await pool.query(`
    INSERT INTO expressions (normalized_expression, expression, meaning, region, context, equivalent, example)
    VALUES ('100%_real', '100%_real', 'm', 'r', 'c', 'e', 'x')
  `);
  server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const registered = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ana', email: 'diccionario@example.com', password: 'password123' })
  });
  headers = {
    'content-type': 'application/json',
    cookie: registered.headers.get('set-cookie').split(';')[0]
  };
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const search = async (query) => {
  const response = await fetch(`${baseUrl}/expressions?${query}`, { headers });
  return { status: response.status, body: await response.json() };
};

test('recorre el diccionario en orden y por páginas', async () => {
  const first = await search('pageSize=5');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 5);
  assert.equal(first.body.total, seedExpressions.length + 1);
  assert.equal(first.body.page, 1);

  const second = await search('pageSize=5&page=2');
  assert.notEqual(second.body.items[0].id, first.body.items[0].id);

  const names = first.body.items.map((item) => item.expression);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b))
  );

  const beyond = await search('page=99');
  assert.deepEqual(beyond.body.items, []);
  assert.equal(beyond.body.total, seedExpressions.length + 1);
});

test('busca sin importar tildes ni mayúsculas', async () => {
  const { body } = await search(`q=${encodeURIComponent('GÜEY')}`);
  assert.deepEqual(
    body.items.map((item) => item.expression),
    ['güey']
  );
  const accent = await search(`q=${encodeURIComponent('Chévere')}`);
  assert.deepEqual(
    accent.body.items.map((item) => item.expression),
    ['chévere']
  );
  const partial = await search('q=parc');
  assert.deepEqual(
    partial.body.items.map((item) => item.expression),
    ['parce', 'parcero']
  );
});

test('filtra por país y combina el filtro con la búsqueda', async () => {
  const argentina = await search('country=AR');
  assert.ok(argentina.body.items.length >= 3);
  assert.ok(argentina.body.items.every((item) => item.countries.includes('AR')));

  const combined = await search('country=AR&q=bol');
  assert.deepEqual(
    combined.body.items.map((item) => item.expression),
    ['boludo']
  );
  assert.equal((await search('country=MX&q=bol')).body.total, 0);
});

test('trata los comodines de SQL como texto normal', async () => {
  assert.deepEqual(
    (await search(`q=${encodeURIComponent('%')}`)).body.items.map((item) => item.expression),
    ['100%_real']
  );
  assert.deepEqual(
    (await search('q=_')).body.items.map((item) => item.expression),
    ['100%_real']
  );
  assert.equal((await search(`q=${encodeURIComponent("' OR 1=1 --")}`)).body.total, 0);
});

test('rechaza filtros inválidos y exige sesión', async () => {
  for (const query of [
    'page=0',
    'page=abc',
    'pageSize=51',
    'country=argentina',
    'country=ar',
    `q=${'x'.repeat(101)}`
  ]) {
    assert.equal((await search(query)).status, 400, query);
  }
  assert.equal((await fetch(`${baseUrl}/expressions`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/game/round`)).status, 401);
});

test('la ronda sale del diccionario, no incluye la respuesta y tiene una sola opción correcta', async () => {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { round } = await (await fetch(`${baseUrl}/game/round`, { headers })).json();
    assert.deepEqual(Object.keys(round).sort(), ['expression', 'id', 'options']);
    assert.equal(round.options.length, 4);
    assert.equal(new Set(round.options).size, 4);

    const results = [];
    for (const country of round.options) {
      const answer = await fetch(`${baseUrl}/game/answer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: round.id, country })
      });
      results.push((await answer.json()).correct);
    }
    assert.equal(results.filter(Boolean).length, 1, round.expression);
  }
});

test('la respuesta devuelve la ficha y valida los datos', async () => {
  const { round } = await (await fetch(`${baseUrl}/game/round`, { headers })).json();
  const post = (body) =>
    fetch(`${baseUrl}/game/answer`, { method: 'POST', headers, body: JSON.stringify(body) });

  const answer = await (await post({ id: round.id, country: round.options[0] })).json();
  assert.equal(answer.entry.expression, round.expression);
  assert.ok(answer.entry.meaning);

  assert.equal((await post({ id: 999999, country: 'AR' })).status, 404);
  assert.equal((await post({ id: round.id, country: 'argentina' })).status, 400);
  assert.equal((await post({ country: 'AR' })).status, 400);
});

test('el juego excluye lo que se pide y solo usa palabras con país', async () => {
  const { rows } = await pool.query('SELECT id FROM expressions WHERE cardinality(countries) > 0');
  const others = rows.map((row) => Number(row.id));
  const keep = others.pop();
  const { round } = await (
    await fetch(`${baseUrl}/game/round?exclude=${others.join(',')}`, { headers })
  ).json();
  assert.equal(round.id, keep);
  const chichai = await pool.query(
    "SELECT id FROM expressions WHERE normalized_expression = 'chichai'"
  );
  assert.ok(!others.includes(Number(chichai.rows[0].id)));
});

const word = (id, countries) => ({ id, expression: `palabra${id}`, countries });

test('buildRound no repite si hay alternativas y reutiliza si se agotan', () => {
  const candidates = [word(1, ['AR']), word(2, ['MX'])];
  assert.equal(buildRound(candidates, { exclude: [1] }).id, 2);
  assert.ok([1, 2].includes(buildRound(candidates, { exclude: [1, 2] }).id));
  assert.equal(buildRound([]), null);
});

test('buildRound completa las opciones aunque el diccionario tenga un solo país', () => {
  const round = buildRound([word(1, ['CO'])], { random: () => 0.5 });
  assert.equal(round.options.length, 4);
  assert.equal(new Set(round.options).size, 4);
  assert.ok(round.options.includes('CO'));
});

test('buildRound nunca ofrece como incorrecto otro país de la misma palabra', () => {
  const countries = ['AR', 'UY', 'CL'];
  const candidates = [word(1, countries), word(2, ['MX']), word(3, ['ES']), word(4, ['PE'])];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { options, id } = buildRound(candidates, { exclude: [2, 3, 4] });
    assert.equal(id, 1);
    assert.equal(options.filter((option) => countries.includes(option)).length, 1);
  }
});

test('el identificador debe ser un número entero, no algo que se le parezca', async () => {
  const post = (route, body) =>
    fetch(`${baseUrl}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  for (const id of [[1], '1', true, 1.5, 0, -1]) {
    assert.equal(
      (await post('/game/answer', { id, country: 'AR' })).status,
      400,
      JSON.stringify(id)
    );
    assert.equal((await post('/translate', { id })).status, 400, JSON.stringify(id));
  }
});
