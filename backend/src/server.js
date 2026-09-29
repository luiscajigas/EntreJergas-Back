require('dotenv').config();

const { createApp } = require('./app');
const { initializeDatabase, pool } = require('./database');

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  try {
    await initializeDatabase();
    const app = createApp(pool);
    app.listen(port, () => {
      console.log(`EntreJergas API escuchando en el puerto ${port}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar EntreJergas API:', error.message);
    await pool.end();
    process.exitCode = 1;
  }
}

void startServer();