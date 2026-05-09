/**
 * functions/api/_middleware.js
 *
 * Middleware global para todas las rutas /api/*.
 *
 * Responsabilidades:
 *   1. Responder a preflight OPTIONS con headers CORS.
 *   2. Validar variables de entorno requeridas.
 *   3. Resolver el token Firebase (Database Secret u OAuth2) UNA sola vez
 *      por petición y exponerlo a las rutas vía context.data.tok / context.data.db.
 *   4. Atrapar excepciones no controladas en las rutas y devolver JSON 500.
 *
 * Las rutas reciben:
 *   context.data.tok  — token Firebase listo para fbGet/fbSet/etc
 *   context.data.db   — URL de la Realtime Database (sin slash final)
 */
import { getFirebaseToken } from '../_lib/firebase.js';
import { jsonRes, fail, CORS_HEADERS } from '../_lib/response.js';

export async function onRequest(context) {
  const { request, env } = context;

  // ── Preflight CORS ────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── Validar env vars críticas ─────────────────────────────
  if (!env.FIREBASE_DATABASE_URL) return jsonRes(fail('FIREBASE_DATABASE_URL no configurado.', 'CONFIG_ERROR'), 503);
  if (!env.JWT_SECRET)            return jsonRes(fail('JWT_SECRET no configurado.', 'CONFIG_ERROR'), 503);

  // ── Auth Firebase: prioridad DB Secret → Service Account ──
  let tok;
  if (env.FIREBASE_DB_SECRET) {
    tok = `secret:${env.FIREBASE_DB_SECRET}`;
  } else {
    if (!env.FIREBASE_SERVICE_ACCOUNT) {
      return jsonRes(fail('Configura FIREBASE_DB_SECRET o FIREBASE_SERVICE_ACCOUNT.', 'CONFIG_ERROR'), 503);
    }
    let sa;
    try {
      sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    } catch {
      return jsonRes(fail('FIREBASE_SERVICE_ACCOUNT debe ser un JSON válido.', 'CONFIG_ERROR'), 503);
    }
    try { tok = await getFirebaseToken(sa); }
    catch (e) { return jsonRes(fail('No se pudo autenticar con Firebase: ' + e.message, 'FIREBASE_ERROR'), 503); }
  }

  // ── Inyectar contexto en data y delegar a la ruta ─────────
  context.data.tok = tok;
  context.data.db  = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');

  try {
    return await context.next();
  } catch (err) {
    console.error('[api/_middleware] Error no controlado:', err);
    return jsonRes(fail('Error interno del servidor.', 'SERVER_ERROR'), 500);
  }
}
