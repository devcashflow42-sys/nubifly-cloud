'use strict';

/**
 * functions/api/_middleware.js
 *
 * Middleware global para todas las rutas /api/*.
 *
 * Capas de seguridad (en orden de ejecución):
 *   0. CORS preflight
 *   1. Detección de payloads maliciosos (SQLi, XSS, path traversal…)
 *   2. Validación de variables de entorno requeridas
 *   3. Conexión a PostgreSQL (context.data.sql)
 *   4. Detección de bots y herramientas de ataque
 *   5. Rate limiting por IP (auth y admin — PostgreSQL)
 *   6. Validación de firma HMAC-SHA256
 *   7. Routing → handler
 *   8. Cabeceras de seguridad en la respuesta final
 *
 * Variables de entorno requeridas:
 *   DATABASE_URL  — cadena de conexión PostgreSQL
 *   JWT_SECRET    — firma del accessToken
 *   APP_SECRET    — clave HMAC para verificar peticiones (Capa 6)
 *
 * Opcionales:
 *   JWT_REFRESH_SECRET   — firma del refreshToken
 *   ADMIN_EMAIL          — correo del administrador (rol admin automático)
 *   SKIP_REQUEST_SIGNING — 'true' para desactivar Capa 6 (solo desarrollo)
 */

import { getDb, endDb }                        from '../_lib/db.js';
import { validateRequest }                     from '../_lib/request-validator.js';
import { CORS_HEADERS }                        from '../_lib/response.js';
import {
  SEC_HEADERS,
  withSecurityHeaders,
  deny,
  analyzeUA,
  detectMaliciousInput,
  checkRateLimit,
  logSec,
  persistSecEvent,
  clientIP,
  requestId as getRequestId,
} from '../_lib/security.js';

// ── Rutas exentas de firma HMAC (Capa 6) ─────────────────────────────────────
const SIGNING_EXEMPT_PATHS = [
  '/api/login',
  '/api/register',
  '/api/auth/refresh',
  '/api/auth/google',
  '/api/auth/github',
  '/api/auth/guest',
  '/api/health',
  '/api/health/',
  '/api/admin',
  '/api/users',
  '/api/app',
  '/api/payment/webhook',
  '/api/payment/checkout',
  '/api/payment/session',
];

function isExemptFromSigning(pathname) {
  return SIGNING_EXEMPT_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// ── Rutas de autenticación (rate limit estricto: 10 req/min) ─────────────────
const AUTH_PREFIXES = [
  '/api/login',
  '/api/register',
  '/api/auth/guest',
  '/api/auth/refresh',
];

// ── Rutas de administración (rate limit moderado: 30 req/min) ─────────────────
const ADMIN_PREFIXES = ['/api/admin'];

// ── Endpoints de pago públicos (sin login/firma) — limitar por IP ─────────────
const PAYMENT_PREFIXES = ['/api/payment/checkout', '/api/payment/session'];

function getRLType(pathname) {
  if (AUTH_PREFIXES.some(p    => pathname.startsWith(p))) return 'auth';
  if (ADMIN_PREFIXES.some(p   => pathname.startsWith(p))) return 'admin';
  if (PAYMENT_PREFIXES.some(p => pathname.startsWith(p))) return 'admin';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const url     = new URL(request.url);
  const rid     = getRequestId(request);   // X-Request-ID / CF-Ray
  const ip      = clientIP(request);

  // ── 0. CORS preflight ─────────────────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status:  204,
      headers: { ...CORS_HEADERS, ...SEC_HEADERS, 'X-Request-ID': rid }
    });
  }

  // ── 1. Detección de payloads maliciosos ───────────────────────────────────
  const threat = detectMaliciousInput(request);
  if (threat.suspicious) {
    logSec('high', 'MALICIOUS_INPUT', {
      ip, path: url.pathname,
      reason: threat.reason,
      ua: request.headers.get('User-Agent') || ''
    });
    return deny('ACCESS_DENIED', 'Solicitud inválida o acceso no autorizado.', 403, rid);
  }

  // ── 2. Validar variables de entorno críticas (mensajes específicos) ───────
  if (!env.DATABASE_URL) {
    console.error('[middleware] Falta DATABASE_URL');
    return deny('DB_NOT_CONFIGURED', 'Base de datos no configurada: falta DATABASE_URL en el servidor.', 503, rid);
  }
  if (!env.JWT_SECRET) {
    console.error('[middleware] Falta JWT_SECRET');
    return deny('JWT_NOT_CONFIGURED', 'Configuración incompleta: falta JWT_SECRET en el servidor.', 503, rid);
  }

  // ── 3. Conexión a PostgreSQL ──────────────────────────────────────────────
  let sql;
  try { sql = getDb(env); }
  catch (e) {
    console.error('[middleware] getDb:', e?.message);
    return deny('DB_INIT_ERROR', 'No se pudo inicializar la base de datos: ' + (e?.message || 'error'), 503, rid);
  }
  context.data.sql = sql;
  context.data.env = env;

  // Cerrar la conexión al terminar la petición (no bloquea la respuesta)
  const closeDb = () => { try { context.waitUntil(endDb(sql)); } catch { endDb(sql); } };

  // ── 4. Detección de bots / herramientas de ataque ─────────────────────────
  const ua         = request.headers.get('User-Agent') || '';
  const hasToken   = (request.headers.get('Authorization') || '').startsWith('Bearer ');
  const isAuthPath = AUTH_PREFIXES.some(p => url.pathname.startsWith(p));
  const uaResult   = analyzeUA(ua);

  if (uaResult.blocked) {
    logSec('critical', 'ATTACK_TOOL', { ip, tool: uaResult.tool, path: url.pathname, ua });
    persistSecEvent('ATTACK_TOOL', { ip, tool: uaResult.tool, path: url.pathname }, sql);
    closeDb();
    return deny('ACCESS_DENIED', 'Solicitud inválida o acceso no autorizado.', 403, rid);
  }

  if (!hasToken && uaResult.risk === 'medium') {
    if (isAuthPath) {
      logSec('high', 'AUTOMATION_BLOCKED', { ip, tool: uaResult.tool, path: url.pathname });
      closeDb();
      return deny('ACCESS_DENIED', 'Solicitud inválida o acceso no autorizado.', 403, rid);
    }
    logSec('medium', 'AUTOMATION_OBSERVED', { ip, tool: uaResult.tool, path: url.pathname });
  }

  // ── 5. Rate limiting ──────────────────────────────────────────────────────
  const rlType = getRLType(url.pathname);
  if (rlType) {
    let rl;
    try { rl = await checkRateLimit(ip, rlType, sql); }
    catch { rl = { limited: false }; }

    if (rl.limited) {
      logSec('high', 'RATE_LIMITED', { ip, path: url.pathname, type: rlType, retryAfter: rl.retryAfter });
      const res = deny('RATE_LIMITED', 'Demasiadas solicitudes. Inténtalo más tarde.', 429, rid);
      res.headers?.set?.('Retry-After', String(rl.retryAfter));
      closeDb();
      return res;
    }
  }

  // ── 6. Validar firma HMAC-SHA256 ──────────────────────────────────────────
  // Las peticiones que llevan un JWT (Authorization: Bearer) ya se autentican
  // en cada endpoint con requireAuth(), así que NO exigimos además firma HMAC:
  // el frontend web usa JWT y nunca firma. La firma sigue siendo obligatoria
  // para rutas no exentas SIN token (defensa anti-bots en superficies públicas).
  const skipSigning = env.SKIP_REQUEST_SIGNING === 'true';
  const isExempt    = isExemptFromSigning(url.pathname);

  if (!skipSigning && !isExempt && !hasToken) {
    const result = await validateRequest(request, env, sql);
    if (result.error) { closeDb(); return withSecurityHeaders(result.error, rid); }
  }

  // ── 7. Routing al handler + 8. Cabeceras de seguridad en la respuesta ────
  try {
    const response = await context.next();
    closeDb();
    return withSecurityHeaders(response, rid);
  } catch (err) {
    console.error('[middleware] unhandled:', err?.message || 'unknown');
    closeDb();
    return deny('SERVER_ERROR', 'Error procesando la solicitud.', 500, rid);
  }
}
