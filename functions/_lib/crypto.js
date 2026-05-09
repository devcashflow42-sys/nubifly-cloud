/**
 * functions/_lib/crypto.js
 *
 * Primitivas criptográficas basadas en Web Crypto API.
 * - base64url helpers
 * - hash y verificación de contraseñas (PBKDF2)
 * - firma y verificación de JWT (HS256)
 */

// ─── BASE64URL ──────────────────────────────────────────────
export function b64url(input) {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input)
    : input instanceof ArrayBuffer ? new Uint8Array(input)
    : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pemToBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN[^-]*-----/g, '')
    .replace(/-----END[^-]*-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// ─── CONTRASEÑAS — PBKDF2 (sin bcrypt) ──────────────────────
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key, 256
  );
  const out = new Uint8Array(16 + 32);
  out.set(salt);
  out.set(new Uint8Array(bits), 16);
  return 'pbkdf2$' + b64url(out);
}

export async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, legacy: false };
  if (stored.startsWith('$2')) return { ok: false, legacy: true }; // bcrypt legacy
  try {
    const raw = b64urlDecode(stored.slice(7));
    const salt = raw.slice(0, 16);
    const storedHash = raw.slice(16);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
      key, 256
    );
    const newHash = new Uint8Array(bits);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= newHash[i] ^ storedHash[i];
    return { ok: diff === 0, legacy: false };
  } catch {
    return { ok: false, legacy: false };
  }
}

// ─── JWT HS256 ──────────────────────────────────────────────
function parseDuration(d) {
  const m = String(d || '7d').match(/^(\d+)([smhd])$/);
  if (!m) return 604800;
  return parseInt(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

export async function signJwt(payload, secret, expiresIn = '7d') {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + parseDuration(expiresIn) };
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(full))}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Formato de token inválido');
  const data = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), new TextEncoder().encode(data));
  if (!valid) throw new Error('Firma inválida');
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expirado');
  return payload;
}
