const { hashPassword } = require('./auth/passwords');

/**
 * Cuenta pública para que cualquiera pueda probar la aplicación sin registrarse.
 * Su contraseña se muestra en la pantalla de ingreso, así que no debe guardar nada privado.
 */
const demoAccount = { email: 'test@gmail.com', password: '12345677', name: 'Cuenta de prueba' };

/**
 * Se ejecuta al arrancar: crea la cuenta y, si ya existe, restablece su contraseña.
 * @param {import('./types/app').UserRepository} users
 */
async function ensureDemoAccount(users) {
  const { email, name, password } = demoAccount;
  await users.createOrResetPassword({ email, name, passwordHash: await hashPassword(password) });
}

module.exports = { demoAccount, ensureDemoAccount };
