require('dotenv').config();

const { createApp } = require('./app');
const { initializeDatabase, pool } = require('./database');
const { ensureDemoAccount } = require('./demo-account');
const { createUserRepository } = require('./repositories/users');

const port = Number(process.env.PORT) || 3000;

/** @param {import('node:http').Server} server */
function closeOnSignal(server) {
  const shutdown = () => {
    server.close(() => {
      void pool.end();
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function startServer() {
  try {
    await initializeDatabase();
    await ensureDemoAccount(createUserRepository(pool));
    const server = createApp(pool).listen(port, () => {
      console.log(`EntreJergas API escuchando en el puerto ${port}`);
    });
    closeOnSignal(server);
  } catch (error) {
    console.error('No se pudo iniciar EntreJergas API:', /** @type {Error} */ (error).message);
    await pool.end();
    process.exitCode = 1;
  }
}

void startServer();
