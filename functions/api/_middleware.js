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
 *   3. Resolución del token Firebase
 *   4. Detección de bots y herramientas de ataque
 *   5. Rate limiting por IP (auth y admin — Firebase RTDB)
 *   6. Validación de firma HMAC-SHA256 (Capa 3 original)
 *   7. Routing → handler
 *   8. Cabeceras de seguridad en la respuesta final
 *
 * Variables de entorno requeridas:
 *   FIREBASE_DATABASE_URL  — URL de la Realtime Database
 *   JWT_SECRET             — firma del accessToken
 *   APP_SECRET             — clave HMAC para verificar peticiones (Capa 6)
 *
 * Opcionales:
 *   JWT_REFRESH_SECRET       — firma del refreshToken
 *   FIREBASE_DB_SECRET       — Database Secret (alternativa a Service Account)
 *   FIREBASE_SERVICE_ACCOUNT — JSON del Service Account
 *   SKIP_REQUEST_SIGNING     — 'true' para desactivar Capa 6 (solo desarrollo)
 */

import { getFirebaseToken }                    from '../_lib/firebase.js';
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
// El webhook queda fuera: lo llama Stripe y puede llegar en ráfagas.
const PAYMENT_PREFIXES = ['/api/payment/checkout', '/api/payment/session'];

function getRLType(pathname) {
  if (AUTH_PREFIXES.some(p    => pathname.startsWith(p))) return 'auth';
  if (ADMIN_PREFIXES.some(p   => pathname.startsWith(p))) return 'admin';
  if (PAYMENT_PREFIXES.some(p => pathname.startsWith(p))) return 'admin'; // cupo moderado
  return null; // sin Firebase RL para endpoints de usuario (evita latencia)
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

  // ── 2. Validar variables de entorno críticas ──────────────────────────────
  if (!env.FIREBASE_DATABASE_URL || !env.JWT_SECRET) {
    return deny('SERVICE_UNAVAILABLE', 'Servicio no disponible.', 503, rid);
  }

  // ── 3. Resolver token Firebase ────────────────────────────────────────────
  let tok;
  if (env.FIREBASE_DB_SECRET) {
    tok = `secret:${env.FIREBASE_DB_SECRET}`;
  } else {
    if (!env.FIREBASE_SERVICE_ACCOUNT) {
      return deny('SERVICE_UNAVAILABLE', 'Servicio no disponible.', 503, rid);
    }
    let sa;
    try {
      sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    } catch {
      return deny('SERVICE_UNAVAILABLE', 'Servicio no disponible.', 503, rid);
    }
    try { tok = await getFirebaseToken(sa); }
    catch {
      return deny('SERVICE_UNAVAILABLE', 'Servicio no disponible.', 503, rid);
    }
  }

  context.data.tok = tok;
  context.data.db  = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');

  // ── 4. Detección de bots / herramientas de ataque ─────────────────────────
  const ua         = request.headers.get('User-Agent') || '';
  const hasToken   = (request.headers.get('Authorization') || '').startsWith('Bearer ');
  const isAuthPath = AUTH_PREFIXES.some(p => url.pathname.startsWith(p));
  const uaResult   = analyzeUA(ua);

  if (uaResult.blocked) {
    // Herramienta de ataque confirmada — siempre bloquear
    logSec('critical', 'ATTACK_TOOL', { ip, tool: uaResult.tool, path: url.pathname, ua });
    persistSecEvent('ATTACK_TOOL', { ip, tool: uaResult.tool, path: url.pathname }, tok, context.data.db);
    return deny('ACCESS_DENIED', 'Solicitud inválida o acceso no autorizado.', 403, rid);
  }

  if (!hasToken && uaResult.risk === 'medium') {
    // Herramienta de automatización sin token — bloquear en auth, advertir en otros
    if (isAuthPath) {
      logSec('high', 'AUTOMATION_BLOCKED', { ip, tool: uaResult.tool, path: url.pathname });
      return deny('ACCESS_DENIED', 'Solicitud inválida o acceso no autorizado.', 403, rid);
    }
    logSec('medium', 'AUTOMATION_OBSERVED', { ip, tool: uaResult.tool, path: url.pathname });
  }

  // ── 5. Rate limiting ──────────────────────────────────────────────────────
  const rlType = getRLType(url.pathname);
  if (rlType) {
    let rl;
    try { rl = await checkRateLimit(ip, rlType, tok, context.data.db); }
    catch { rl = { limited: false }; } // no bloquear si Firebase falla en RL

    if (rl.limited) {
      logSec('high', 'RATE_LIMITED', { ip, path: url.pathname, type: rlType, retryAfter: rl.retryAfter });
      const res = deny('RATE_LIMITED', 'Demasiadas solicitudes. Inténtalo más tarde.', 429, rid);
      res.headers?.set?.('Retry-After', String(rl.retryAfter));
      return res;
    }
  }

  // ── 6. Validar firma HMAC-SHA256 (Capa 3 original) ───────────────────────
  const skipSigning = env.SKIP_REQUEST_SIGNING === 'true';
  const isExempt    = isExemptFromSigning(url.pathname);

  if (!skipSigning && !isExempt) {
    const result = await validateRequest(request, env, tok, context.data.db);
    if (result.error) return withSecurityHeaders(result.error, rid);
  }

  // ── 7. Routing al handler + 8. Cabeceras de seguridad en la respuesta ────
  try {
    const response = await context.next();
    return withSecurityHeaders(response, rid);
  } catch (err) {
    // Nunca exponer errores internos, stack traces ni rutas del servidor
    console.error('[middleware] unhandled:', err?.message || 'unknown');
    return deny('SERVER_ERROR', 'Error procesando la solicitud.', 500, rid);
  }
}
