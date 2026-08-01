/**
 * functions/_lib/request-validator.js
 * CAPA 3 — Validación de firma HMAC-SHA256 por petición
 */

import { jsonRes, fail }          from './response.js';

const TIMESTAMP_TOLERANCE_MS = 30_000;
const NONCE_TTL_MS           = 90_000;
const NONCE_CLEANUP_CHANCE   = 0.05;

async function verifyHmac(method, url, timestamp, nonce, signatureHex, secret) {
  const message = `${method.toUpperCase()}|${url}|${timestamp}|${nonce}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = hexToBytes(signatureHex);
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
}

export async function signRequest(method, url, timestamp, nonce, secret) {
  const message = `${method.toUpperCase()}|${url}|${timestamp}|${nonce}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeNonce(nonce) {
  return nonce.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
}

export async function validateRequest(request, env, sql) {
  const timestamp = request.headers.get('X-Timestamp');
  const nonce     = request.headers.get('X-Nonce');
  const signature = request.headers.get('X-Signature');

  if (!timestamp || !nonce || !signature) {
    return {
      error: jsonRes(
        fail('Firma de petición requerida. Incluye X-Timestamp, X-Nonce y X-Signature.', 'SIGNATURE_MISSING'),
        401
      )
    };
  }

  const ts  = parseInt(timestamp, 10);
  const now = Date.now();
  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_MS) {
    return {
      error: jsonRes(
        fail('Petición expirada. El timestamp está fuera del rango permitido (±30s).', 'TIMESTAMP_EXPIRED'),
        401
      )
    };
  }

  const safeNonce = sanitizeNonce(nonce);
  let existingNonce = null;

  try {
    const rows = await sql`select nonce from nonce_store where nonce = ${safeNonce} and exp > ${now}`;
    existingNonce = rows.length ? rows[0] : null;
  } catch (e) {
    console.error('[request-validator] Error consultando nonce:', e.message);
    return {
      error: jsonRes(fail('Error validando la petición.', 'NONCE_CHECK_ERROR'), 503)
    };
  }

  if (existingNonce !== null) {
    return {
      error: jsonRes(
        fail('Petición duplicada detectada (replay attack).', 'NONCE_REUSED'),
        401
      )
    };
  }

  const APP_SECRET = env.APP_SECRET;
  if (!APP_SECRET) {
    console.warn('[request-validator] ⚠️ APP_SECRET no configurado — SOLO DESARROLLO');
  } else {
    let valid = false;
    try {
      valid = await verifyHmac(request.method, request.url, timestamp, nonce, signature, APP_SECRET);
    } catch (e) {
      return {
        error: jsonRes(fail('Error procesando la firma.', 'SIGNATURE_ERROR'), 500)
      };
    }
    if (!valid) {
      return {
        error: jsonRes(fail('Firma de petición inválida.', 'SIGNATURE_INVALID'), 401)
      };
    }
  }

  sql`insert into nonce_store (nonce, ts, exp) values (${safeNonce}, ${now}, ${now + NONCE_TTL_MS})
      on conflict (nonce) do update set ts = ${now}, exp = ${now + NONCE_TTL_MS}`
    .catch(e => { console.warn('[request-validator] No se pudo guardar nonce:', e.message); });

  if (Math.random() < NONCE_CLEANUP_CHANCE) {
    cleanupExpiredNonces(sql);
  }

  return { ok: true };
}

export async function cleanupExpiredNonces(sql) {
  try {
    const res = await sql`delete from nonce_store where exp < ${Date.now()}`;
    return res.count || 0;
  } catch (e) {
    console.warn('[request-validator] Error en cleanup:', e.message);
    return 0;
  }
}
