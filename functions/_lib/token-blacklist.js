/**
 * functions/_lib/token-blacklist.js
 * Blacklist de refresh tokens revocados en PostgreSQL
 * (tablas token_blacklist y user_token_revoke). Recibe el cliente `sql`.
 */

import { b64urlDecode } from './crypto.js';

function deriveTokenKey(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return token.slice(-32).replace(/[^a-zA-Z0-9]/g, '');
  return parts[2].slice(0, 32).replace(/[^a-zA-Z0-9\-_]/g, '');
}

function getTokenExpiry(token) {
  try {
    const parts   = token.split('.');
    if (parts.length !== 3) return Date.now() + 86_400_000 * 30;
    const raw     = b64urlDecode(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(raw));
    if (payload.exp) return payload.exp * 1000;
  } catch { /* fallback */ }
  return Date.now() + 86_400_000 * 30;
}

export async function blacklistToken(refreshToken, sql) {
  const key = deriveTokenKey(refreshToken);
  if (!key) throw new Error('Token inválido para blacklist');
  const exp = getTokenExpiry(refreshToken);
  await sql`insert into token_blacklist (token_key, exp) values (${key}, ${exp})
            on conflict (token_key) do update set exp = ${exp}`;
}

export async function isTokenBlacklisted(refreshToken, sql) {
  try {
    const key = deriveTokenKey(refreshToken);
    if (!key) return true;
    const rows = await sql`select 1 from token_blacklist where token_key = ${key} and exp > ${Date.now()}`;
    return rows.length > 0;
  } catch (e) {
    console.warn('[token-blacklist] No se pudo consultar blacklist:', e.message);
    return false;
  }
}

export async function cleanupExpiredBlacklist(sql) {
  try {
    const res = await sql`delete from token_blacklist where exp < ${Date.now()}`;
    return res.count || 0;
  } catch (e) {
    console.warn('[token-blacklist] Error en cleanup:', e.message);
    return 0;
  }
}

export async function blacklistAllUserTokens(uid, sql) {
  await sql`insert into user_token_revoke (uid, revoked_at) values (${uid}, ${Date.now()})
            on conflict (uid) do update set revoked_at = ${Date.now()}`;
}

export async function isUserTokensRevoked(uid, issuedAt, sql) {
  try {
    const rows = await sql`select revoked_at from user_token_revoke where uid = ${uid}`;
    if (!rows.length) return false;
    return (issuedAt * 1000) < rows[0].revoked_at;
  } catch {
    return false;
  }
}
