/**
 * functions/api/_middleware.js
 *
 * Middleware global para todas las rutas /api/*.
 *
 * Responsabilidades:
 *   1. Responder a preflight OPTIONS con headers CORS.
 *   2. Validar variables de entorno requeridas.
 *   3. Resolver el token Firebase UNA sola vez por petición.
 *   4. [CAPA 3] Validar firma HMAC-SHA256 de la petición.
 *      → Exento: /api/login, /api/register, /api/auth/refresh,
 *                /api/auth/google, /api/auth/github, /api/health*
 *   5. Atrapar excepciones no controladas y devolver JSON 500.
 *
 * Variables de entorno requeridas:
 *   FIREBASE_DATABASE_URL  — URL de la Realtime Database
 *   JWT_SECRET             — firma del accessToken
 *   APP_SECRET             — clave HMAC para verificar peticiones (Capa 3)
 *
 * Opcionales:
 *   JWT_REFRESH_SECRET     — firma del refreshToken (default: JWT_SECRET + '_refresh')
 *   FIREBASE_DB_SECRET     — Database Secret (alternativa a Service Account)
 *   FIREBASE_SERVICE_ACCOUNT — JSON del Service Account
 *   SKIP_REQUEST_SIGNING   — 'true' para desactivar Capa 3 (solo desarrollo)
 */

import { getFirebaseToken }    from '../_lib/firebase.js';
import { validateRequest }     from '../_lib/request-validator.js';
import { jsonRes, fail,
         CORS_HEADERS }        from '../_lib/response.js';

// Rutas que NO requieren firma de petición (Capa 3)
const SIGNING_EXEMPT_PATHS = [
  '/api/login',
  '/api/register',
  '/api/auth/refresh',
  '/api/auth/google',
  '/api/auth/github',
  '/api/health',
  '/api/health/',
];

function isExemptFromSigning(pathname) {
  return SIGNING_EXEMPT_PATHS.some(exempt =>
    pathname === exempt || pathname.startsWith(exempt + '/')
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // ── Preflight CORS ────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── Validar env vars críticas ─────────────────────────────
  if (!env.FIREBASE_DATABASE_URL)
    return jsonRes(fail('FIREBASE_DATABASE_URL no configurado.', 'CONFIG_ERROR'), 503);
  if (!env.JWT_SECRET)
    return jsonRes(fail('JWT_SECRET no configurado.', 'CONFIG_ERROR'), 503);

  // ── Auth Firebase: DB Secret → Service Account ────────────
  let tok;
  if (env.FIREBASE_DB_SECRET) {
    tok = `secret:${env.FIREBASE_DB_SECRET}`;
  } else {
    if (!env.FIREBASE_SERVICE_ACCOUNT) {
      return jsonRes(
        fail('Configura FIREBASE_DB_SECRET o FIREBASE_SERVICE_ACCOUNT.', 'CONFIG_ERROR'),
        503
      );
    }
    let sa;
    try {
      sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    } catch {
      return jsonRes(fail('FIREBASE_SERVICE_ACCOUNT debe ser un JSON válido.', 'CONFIG_ERROR'), 503);
    }
    try { tok = await getFirebaseToken(sa); }
    catch (e) {
      return jsonRes(fail('No se pudo autenticar con Firebase: ' + e.message, 'FIREBASE_ERROR'), 503);
    }
  }

  // ── Inyectar contexto ─────────────────────────────────────
  context.data.tok = tok;
  context.data.db  = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');

  // ── CAPA 3: Validar firma de petición ─────────────────────
  const skipSigning = env.SKIP_REQUEST_SIGNING === 'true';
  const isExempt    = isExemptFromSigning(url.pathname);

  if (!skipSigning && !isExempt) {
    const result = await validateRequest(request, env, tok, context.data.db);
    if (result.error) return result.error;
  }

  // ── Delegar a la ruta ─────────────────────────────────────
  try {
    return await context.next();
  } catch (err) {
    console.error('[api/_middleware] Error no controlado:', err);
    return jsonRes(fail('Error interno del servidor.', 'SERVER_ERROR'), 500);
  }
}
