# EntreJergas API

API REST de EntreJergas con Express y PostgreSQL. Esta carpeta es autocontenida y puede ser la raíz de un repositorio independiente.

## Variables de entorno

Edita `.env` para desarrollo local y define `DATABASE_URL` con la cadena de conexión de PostgreSQL. Usa `PGSSLMODE=disable` para una base local sin TLS o `PGSSLMODE=require` al conectar desde tu PC a una base remota que exige SSL. No subas `.env` ni credenciales a Git.

En Render crea primero una base PostgreSQL y un servicio web a partir de este repositorio. El `render.yaml` pide `DATABASE_URL` y `CORS_ORIGIN`: usa la **Internal Database URL** de Render y el origen exacto de Vercel, por ejemplo `https://entrejergas.vercel.app`. Render asigna `PORT`; `NODE_ENV=production` habilita SSL en la conexión PostgreSQL. La conexión que usa pgAdmin desde tu PC es la externa; no uses el hostname interno de Render fuera de sus servicios.

El archivo incluye `LLM_API_KEY` como espacio reservado, pero la beta todavía no la utiliza. Cuando se integre un proveedor de IA, configura esa clave en el backend/Render, nunca en Angular ni en Vercel como variable expuesta al navegador.

## Desarrollo y despliegue

```sh
npm install
npm run dev
```

El servidor escucha en `http://localhost:3000`. Para Render, los comandos configurados en `render.yaml` son `npm install` y `npm start`. En el primer arranque se crean `users`, `user_sessions`, `expressions` y `search_history`, y se insertan expresiones semilla sin duplicarlas. En bases existentes se agrega `search_history.user_id` para asociar las consultas nuevas con su cuenta.

## Contrato

- `GET /api/health`: confirma que API y PostgreSQL responden.
- `POST /api/auth/register` con `{ "name", "email", "password" }`: crea una cuenta y abre una sesión.
- `POST /api/auth/login` con `{ "email", "password" }`: valida las credenciales y abre una sesión.
- `GET /api/auth/me`: devuelve la cuenta de la sesión actual.
- `POST /api/auth/logout`: revoca la sesión actual.
- `POST /api/lookup` con `{ "expression": "parcero" }`: requiere sesión, busca primero en `expressions` y guarda la consulta asociada al usuario.
- `GET /api/history`: requiere sesión y devuelve las últimas 30 búsquedas de esa cuenta.
- `GET /api/dashboard`: requiere sesión y devuelve métricas del diccionario y consultas de esa cuenta.

Las contraseñas se guardan con `scrypt`; el navegador recibe una cookie de sesión `HttpOnly`, mientras PostgreSQL conserva solo el hash del token. Las sesiones vencen en siete días. La búsqueda responde `{ "found": false, "entry": null, "message": "..." }` cuando la expresión no existe; no llama a IA. Se aceptan hasta 100 caracteres.

## Pruebas

```sh
npm test
```

Las pruebas usan `pg-mem`, un PostgreSQL emulado en memoria, por lo que no necesitan credenciales ni una instancia local.
