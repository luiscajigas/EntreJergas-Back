# EntreJergas API

API REST de EntreJergas con Express y PostgreSQL. Esta carpeta es autocontenida y puede ser la raíz de un repositorio independiente.

## Variables de entorno

Edita `.env` para desarrollo local y define `DATABASE_URL` con la cadena de conexión de PostgreSQL. Usa `PGSSLMODE=disable` para una base local sin TLS o `PGSSLMODE=require` al conectar desde tu PC a una base remota que exige SSL. No subas `.env` ni credenciales a Git.

En Render crea primero una base PostgreSQL y un servicio web a partir de este repositorio. El `render.yaml` pide `DATABASE_URL` y `CORS_ORIGIN`: usa la **Internal Database URL** de Render y el origen exacto de Vercel, por ejemplo `https://entrejergas.vercel.app`. Render asigna `PORT`; `NODE_ENV=production` habilita SSL en la conexión PostgreSQL. La conexión que usa pgAdmin desde tu PC es la externa; no uses el hostname interno de Render fuera de sus servicios.

La IA se ejecuta solo en el backend. Configura `LLM_API_KEY` en el entorno del servicio (localmente en `.env` o en Render), nunca en Angular ni en Vercel. El proveedor predeterminado es Gemini mediante su endpoint compatible con OpenAI, con el modelo `gemini-3.8-flash`; puedes cambiar el endpoint con `LLM_API_URL` y el modelo con `LLM_MODEL`. Cada respuesta tiene un máximo de 400 tokens. Ante errores transitorios (`503`, timeouts o fallos de red), se reintenta hasta dos veces con espera exponencial. Los errores `429` se devuelven sin reintentar para no aumentar el consumo al alcanzar la cuota. La interfaz informa el fallo y confirma que la expresión no se agregó.

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
- `POST /api/lookup` con `{ "expression": "parcero" }`: requiere sesión y busca primero en `expressions`. Si la expresión no existe, solicita una definición a Gemini. La respuesta es temporal por defecto; para agregarla al diccionario compartido por todas las cuentas, el usuario debe enviar la expresión completa entre comillas, por ejemplo `{ "expression": "“hacer vaca”" }`. Las comillas no guardan una palabra citada dentro de una frase. Las entradas generadas se marcan `source: "ai"`, y el historial diferencia las temporales (`ai`) de las agregadas (`ai_saved`).
- `GET /api/history`: requiere sesión y devuelve las últimas 30 búsquedas de esa cuenta.
- `GET /api/dashboard`: requiere sesión y devuelve métricas del diccionario y consultas de esa cuenta.

Las contraseñas se guardan con `scrypt`; el navegador recibe una cookie de sesión `HttpOnly`, mientras PostgreSQL conserva solo el hash del token. Las sesiones vencen en siete días. Si la IA está disponible pero no puede construir una definición válida, la búsqueda responde `{ "found": false, "entry": null, "message": "..." }`. Se aceptan hasta 100 caracteres.

## Pruebas

```sh
npm test
```

Las pruebas usan `pg-mem`, un PostgreSQL emulado en memoria, por lo que no necesitan credenciales ni una instancia local.
