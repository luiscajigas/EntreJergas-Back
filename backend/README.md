# EntreJergas API

API REST de EntreJergas con Express y PostgreSQL. Esta carpeta es autocontenida y puede ser la raíz de un repositorio independiente.

## Variables de entorno

Edita `.env` para desarrollo local y define `DATABASE_URL` con la cadena de conexión de PostgreSQL. Usa `PGSSLMODE=disable` para una base local sin TLS o `PGSSLMODE=require` al conectar desde tu PC a una base remota que exige SSL. No subas `.env` ni credenciales a Git.

En Render crea primero una base PostgreSQL y un servicio web a partir de este repositorio. El `render.yaml` pide `DATABASE_URL` y `CORS_ORIGIN`: usa la **Internal Database URL** de Render y el origen exacto de Vercel, por ejemplo `https://entrejergas.vercel.app`. Render asigna `PORT`; `NODE_ENV=production` habilita SSL en la conexión PostgreSQL. La conexión que usa pgAdmin desde tu PC es la externa; no uses el hostname interno de Render fuera de sus servicios.

La IA se ejecuta solo en el backend. Configura `LLM_API_KEY` en el entorno del servicio (localmente en `.env` o en Render), nunca en Angular ni en Vercel. El proveedor predeterminado es Gemini mediante su endpoint compatible con OpenAI, con el modelo `gemini-3.5-flash-lite`; puedes cambiar el endpoint con `LLM_API_URL` y el modelo con `LLM_MODEL`. Cada respuesta tiene un máximo de 400 tokens. Ante errores transitorios (`503`, timeouts o fallos de red), se reintenta hasta dos veces con espera exponencial. Los errores `429` se devuelven sin reintentar para no aumentar el consumo al alcanzar la cuota. La API distingue una clave ausente, una respuesta inválida, un límite de cuota y un fallo temporal; en todos esos casos confirma que la expresión no se agregó.

## Estructura

```text
openapi.yaml        Contrato de la API: se edita primero
src/app.js          Crea las piezas y conecta sus dependencias
src/routes/         Reciben la solicitud, validan y responden
src/repositories/   Únicas capas con consultas SQL
src/auth/           Contraseñas, sesiones y middleware
src/ai-provider.js  Cliente de Gemini: definiciones y traducciones
src/types/          Tipos generados desde el contrato
```

## Contrato y tipos

1. Cambia `openapi.yaml`.
2. Ejecuta `npm run contract:types` para generar `src/types/contract.d.ts`.
3. Ejecuta `npm run typecheck`: las respuestas pasan por `reply()`, así que un cuerpo que no cumpla el contrato no compila.
4. En el frontend ejecuta `npm run api:types` para actualizar sus tipos.

El código sigue en JavaScript con JSDoc y `checkJs`: Render no necesita un paso de compilación. `test/contract.test.js` comprueba además, con las respuestas reales, que el servidor cumple el contrato.

## Límites

- Cada cuenta puede hacer 30 llamadas a la IA por minuto; las palabras ya guardadas y las traducciones conservadas no cuentan.
- Un correo se bloquea 15 minutos tras 10 intentos fallidos de ingreso. El conteo es por correo porque el proxy oculta la IP real, así que alguien podría bloquear temporalmente una cuenta ajena.
- Los contadores están en memoria: sirven con una sola instancia y se reinician al desplegar.

## Desarrollo y despliegue

```sh
npm install
npm run dev
```

El servidor escucha en `http://localhost:3000`. Para Render, los comandos configurados en `render.yaml` son `npm install` y `npm start`. En el primer arranque se crean `users`, `user_sessions`, `expressions` y `search_history`, y se insertan expresiones semilla sin duplicarlas. En bases existentes se agrega `search_history.user_id` para asociar las consultas nuevas con su cuenta.

## Qué se guarda

La IA extrae hasta tres expresiones del texto y las clasifica, pero la decisión es del código. Una expresión se agrega al diccionario compartido solo si cumple todo esto:

1. Aparece en el texto del usuario.
2. No difiere en una sola letra de otra que ya exista; en ese caso se sugiere la correcta.
3. Es regional, con confianza alta y al menos un país válido.
4. Una segunda consulta independiente a la IA confirma que existe.

Lo demás se explica sin guardarse, como `mochila`. Si la verificación rechaza una expresión, no se muestra su definición y se informa como no reconocida. Es una reducción del riesgo y no una garantía: la IA aún puede equivocarse, y por eso estas entradas quedan marcadas con `source: "ai"`.

## Contrato

- `GET /api/health`: confirma que API y PostgreSQL responden.
- `POST /api/auth/register` con `{ "name", "email", "password" }`: crea una cuenta y abre una sesión.
- `POST /api/auth/login` con `{ "email", "password" }`: valida las credenciales y abre una sesión.
- `GET /api/auth/me`: devuelve la cuenta de la sesión actual.
- `POST /api/auth/logout`: revoca la sesión actual.
- `POST /api/lookup` con `{ "expression": "qué significa boludo" }`: requiere sesión y acepta hasta 300 caracteres. Si el texto completo está en el diccionario, responde sin consultar la IA. Si no, sigue las reglas de la sección *Qué se guarda*. Devuelve una ficha por expresión en `entries` y las no resueltas en `unresolved`; `entry` se conserva por compatibilidad. El historial registra cada expresión por separado.
- `POST /api/translate` con `{ "id" }` o, para respuestas temporales, con la definición completa: requiere sesión y devuelve la definición en inglés. Las traducciones de expresiones guardadas se conservan en `expression_translations`, así que la IA solo se consulta una vez por expresión; el texto original en español no cambia.
- `GET /api/expressions?q=&country=&page=&pageSize=`: requiere sesión y recorre el diccionario con búsqueda, filtro por país y paginación.
- `GET /api/game/round?exclude=` y `POST /api/game/answer` con `{ "id", "country" }`: requieren sesión y sirven para el juego ¿De qué país es?. La ronda no incluye la respuesta, y solo participan las expresiones con países conocidos.
- `GET /api/history`: requiere sesión y devuelve las últimas 30 búsquedas de esa cuenta.
- `GET /api/dashboard`: requiere sesión y devuelve métricas del diccionario y consultas de esa cuenta.

Las contraseñas se guardan con `scrypt`; el navegador recibe una cookie de sesión `HttpOnly`, mientras PostgreSQL conserva solo el hash del token. Las sesiones vencen en siete días. Si no hay definición, la búsqueda responde `found: false` con `reason`, un código estable, y `message`, una explicación en español.

## Pruebas

```sh
npm test
```

Para revisar los tipos: `npm run typecheck`. Las pruebas no necesitan credenciales ni una instancia local: usan `pg-mem`, un PostgreSQL emulado, y PGlite, un PostgreSQL real en memoria, para la migración y las consultas que `pg-mem` no soporta.
