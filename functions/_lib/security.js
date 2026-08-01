'use strict';

/**
 * functions/_lib/security.js
 *
 * Sistema de seguridad avanzada para todas las rutas /api/*.
 * Compatible al 100% con la app Android y la web Nubifly.
 *
 * Capas:
 *   1. Cabeceras de seguridad HTTP (nunca expone tecnologías internas)
 *   2. Detección de herramientas de ataque y bots
 *   3. Detección de payloads maliciosos (SQLi, XSS, path traversal…)
 *   4. Rate limiting por IP respaldado en Firebase RTDB
 *   5. Registro privado de eventos de seguridad
 */

// Nota: el rate-limit y los eventos de seguridad se guardan en PostgreSQL
// (tablas security_rl y security_events). Se recibe el cliente `sql` por parámetro.

// ═══════════════════════════════════════════════════════════════
// ║  CABECERAS DE SEGURIDAD
// ═══════════════════════════════════════════════════════════════

export const SEC_HEADERS = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'X-XSS-Protection':         '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy':           'no-referrer',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=()',
  'Cache-Control':             'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma':                    'no-cache',
  'Server':                    'Nubifly',
  'X-Powered-By':              'Nubifly',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, X-Timestamp, X-Nonce, X-Signature',
  'Access-Control-Max-Age':       '86400',
};

/** Agrega cabeceras de seguridad a una Response existente. */
export function withSecurityHeaders(response, requestId) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
  if (requestId) headers.set('X-Request-ID', requestId);
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers
  });
}

/** Construye una respuesta JSON segura (CORS + security headers). */
export function secureRes(body, status = 200, requestId) {
  const headers = { ...CORS, ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8' };
  if (requestId) headers['X-Request-ID'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Respuesta de error estándar — nunca expone detalles internos. */
export function deny(code, message, status, requestId) {
  return secureRes({ success: false, status, code, message }, status, requestId);
}

// ═══════════════════════════════════════════════════════════════
// ║  DETECCIÓN DE BOTS Y HERRAMIENTAS DE ATAQUE
// ═══════════════════════════════════════════════════════════════

// Herramientas de ataque: bloqueo total, sin excepciones
const ATTACK_TOOLS = [
  'sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab',
  'dirbuster', 'dirb', 'gobuster', 'ffuf', 'wfuzz', 'feroxbuster',
  'nuclei', 'hydra', 'medusa', 'burp', 'acunetix',
  'nessus', 'openvas', 'metasploit', 'havij', 'w3af',
  'skipfish', 'commix', 'xsser', 'zaproxy', 'owasp zap',
  'jbrofuzz', 'paros', 'vega ', 'appscan', 'webinspect',
];

// Herramientas de automatización / scraping: bloquear en auth sin token
const AUTO_TOOLS = [
  'python-requests', 'python-urllib', 'python-httpx',
  'go-http-client', 'wget/', 'libcurl',
  'scrapy', 'mechanize', 'phantomjs', 'headlesschrome',
  'selenium', 'puppeteer', 'playwright',
];

// Siempre permitidos (navegadores + app Android)
const SAFE_SIGNATURES = [
  'mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera',
  'okhttp', 'dalvik', 'nubifly', 'retrofit', 'volley',
];

/**
 * Analiza el User-Agent y devuelve el nivel de riesgo.
 * risk: 'none' | 'low' | 'medium' | 'high' | 'critical'
 * blocked: true → rechazar de inmediato
 * reason: código legible de la causa
 */
export function analyzeUA(ua) {
  if (!ua || ua.trim().length < 4) {
    return { risk: 'high', blocked: true, reason: 'NO_UA' };
  }
  const low = ua.toLowerCase();

  // Herramientas de ataque confirmadas → bloqueo inmediato
  for (const sig of ATTACK_TOOLS) {
    if (low.includes(sig)) return { risk: 'critical', blocked: true, reason: 'ATTACK_TOOL', tool: sig };
  }

  // Clientes legítimos conocidos → siempre permitir
  for (const sig of SAFE_SIGNATURES) {
    if (low.includes(sig)) return { risk: 'none', blocked: false, reason: 'SAFE' };
  }

  // Herramientas de automatización → riesgo medio
  for (const sig of AUTO_TOOLS) {
    if (low.includes(sig)) return { risk: 'medium', blocked: false, reason: 'AUTOMATION', tool: sig };
  }

  // Herramientas de desarrollo (curl, postman…) → riesgo bajo
  if (low.includes('curl/'))    return { risk: 'low', blocked: false, reason: 'CLI', tool: 'curl' };
  if (low.includes('postman'))  return { risk: 'low', blocked: false, reason: 'DEV_TOOL', tool: 'postman' };
  if (low.includes('insomnia')) return { risk: 'low', blocked: false, reason: 'DEV_TOOL', tool: 'insomnia' };
  if (low.includes('httpie'))   return { risk: 'low', blocked: false, reason: 'DEV_TOOL', tool: 'httpie' };

  // UA desconocido pero no vacío → riesgo bajo
  return { risk: 'low', blocked: false, reason: 'UNKNOWN_UA' };
}

// ═══════════════════════════════════════════════════════════════
// ║  DETECCIÓN DE PAYLOADS MALICIOSOS
// ═══════════════════════════════════════════════════════════════

// Parámetros de debug/bypass que jamás deben existir en producción
const BAD_PARAM_NAMES = new Set([
  'debug', 'admin', 'test', 'bypass', 'hack', 'root', 'shell',
  'cmd', 'exec', 'eval', 'payload', 'inject', 'exploit',
]);

// Patrones de payload malicioso (URL completa + query string)
const MALICIOUS_RE = [
  /\.\.\//,                        // path traversal
  /%2e%2e/i,                       // path traversal encoded
  /%00/,                            // null byte
  /\x00/,                           // null byte literal
  /<\s*script[\s>]/i,               // XSS
  /javascript\s*:/i,                // XSS protocolo JS
  /vbscript\s*:/i,                  // XSS VBScript
  /data\s*:\s*text\/html/i,         // XSS data URI
  /on\w{1,20}\s*=/i,                // event handlers: onclick=, onerror=…
  /union[\s\+]+select/i,            // SQL injection
  /select[\s\+]+.{0,40}from[\s\+]/i,
  /insert[\s\+]+into[\s\+]/i,
  /drop[\s\+]+table/i,
  /exec[\s\(]+/i,                   // ejecución de código
  /expression\s*\(/i,               // CSS expression (IE XSS)
  /\bor\b.{0,10}=.{0,10}\bor\b/i,  // SQL OR 1=1
];

/**
 * Detecta inputs maliciosos en la URL, query string y ciertos headers.
 * Devuelve { suspicious: bool, reason, detail }
 */
export function detectMaliciousInput(request) {
  const url  = new URL(request.url);
  const scan = url.pathname + url.search;

  // Parámetros de debug/bypass
  for (const [key] of url.searchParams.entries()) {
    if (BAD_PARAM_NAMES.has(key.toLowerCase())) {
      return { suspicious: true, reason: 'DEBUG_PARAM', detail: key };
    }
  }

  // Patrones maliciosos en la URL
  for (const re of MALICIOUS_RE) {
    if (re.test(scan)) {
      return { suspicious: true, reason: 'MALICIOUS_PATTERN', detail: re.source.slice(0, 40) };
    }
  }

  // Header injection — valores en cabeceras no estándar
  for (const header of ['x-forwarded-host', 'x-host', 'x-rewrite-url', 'x-original-url']) {
    const val = request.headers.get(header) || '';
    if (val && MALICIOUS_RE.some(re => re.test(val))) {
      return { suspicious: true, reason: 'HEADER_INJECTION', detail: header };
    }
  }

  return { suspicious: false };
}

// ═══════════════════════════════════════════════════════════════
// ║  RATE LIMITING — Firebase RTDB
// ═══════════════════════════════════════════════════════════════

// Configuración por tipo de endpoint
const RL_CONFIG = {
  auth:  { max: 10,  windowMs: 60_000 },   // 10 req/min
  admin: { max: 30,  windowMs: 60_000 },   // 30 req/min
  api:   { max: 120, windowMs: 60_000 },   // 120 req/min (reservado, no usado en middleware)
};

// Tiempos de bloqueo progresivos: 1ª infracción → 15 min, 2ª → 1 h, 3ª → 6 h, 4ª+ → 24 h
const BLOCK_LADDER_MS = [
  15 * 60_000,      // 15 minutos
  60 * 60_000,      // 1 hora
  6  * 60 * 60_000, // 6 horas
  24 * 60 * 60_000, // 24 horas
];

async function ipHash(ip, salt = '') {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + salt));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica y actualiza el rate limit para una IP en un tipo de endpoint.
 *
 * @returns {{ limited: bool, remaining: int, retryAfter: int }}
 */
export async function checkRateLimit(ip, type, sql) {
  const cfg = RL_CONFIG[type] || RL_CONFIG.api;
  const key = await ipHash(ip, type);
  const now = Date.now();

  let data = null;
  try {
    const rows = await sql`select data from security_rl where rl_key = ${key}`;
    data = rows[0]?.data || null;
  } catch { /* no bloquear si la BD falla */ }

  const save = (payload) => {
    sql`insert into security_rl (rl_key, data, updated)
        values (${key}, ${sql.json(payload)}, ${now})
        on conflict (rl_key) do update set data = ${sql.json(payload)}, updated = ${now}`
      .catch(() => {});
  };

  // ── IP temporalmente bloqueada ─────────────────────────────────────────
  if (data?.blockedUntil && data.blockedUntil > now) {
    return { limited: true, remaining: 0, retryAfter: Math.ceil((data.blockedUntil - now) / 1000) };
  }

  // ── Contador en la ventana actual ──────────────────────────────────────
  const inWindow    = data?.windowStart && (now - data.windowStart < cfg.windowMs);
  const count       = inWindow ? (data.count || 0) + 1 : 1;
  const windowStart = inWindow ? data.windowStart : now;
  const violations  = data?.violations || 0;

  // ── Límite excedido → bloqueo progresivo ──────────────────────────────
  if (count > cfg.max) {
    const newViolations = violations + 1;
    const blockMs       = BLOCK_LADDER_MS[Math.min(newViolations - 1, BLOCK_LADDER_MS.length - 1)];
    const blockedUntil  = now + blockMs;
    save({ count, windowStart, violations: newViolations, blockedUntil });
    return { limited: true, remaining: 0, retryAfter: Math.ceil(blockMs / 1000) };
  }

  // ── Dentro del límite ─────────────────────────────────────────────────
  save({ count, windowStart, violations, blockedUntil: 0 });
  return { limited: false, remaining: cfg.max - count, retryAfter: 0 };
}

// ═══════════════════════════════════════════════════════════════
// ║  REGISTRO DE SEGURIDAD
// ═══════════════════════════════════════════════════════════════

/**
 * Log local (Cloudflare logs → visible en Workers dashboard).
 * Nunca expuesto al cliente.
 */
export function logSec(level, event, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...meta };
  const str   = JSON.stringify(entry);
  if (level === 'critical' || level === 'high') console.error('[SEC]', str);
  else console.warn('[SEC]', str);
}

/**
 * Persiste un evento de seguridad grave en PostgreSQL (best-effort).
 */
export function persistSecEvent(event, meta, sql) {
  if (!sql) return;
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sql`insert into security_events (event_id, kind, ip, details, ts)
      values (${id}, ${event}, ${meta?.ip || null}, ${sql.json(meta || {})}, ${Date.now()})`
    .catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// ║  UTILS
// ═══════════════════════════════════════════════════════════════

/** Extrae la IP del cliente con fallbacks de Cloudflare. */
export function clientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

/** Genera un request ID a partir del CF-Ray o un UUID corto. */
export function requestId(request) {
  return request.headers.get('CF-Ray')
    || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
