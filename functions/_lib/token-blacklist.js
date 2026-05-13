/**
 * functions/_lib/token-blacklist.js
 * CAPA 4 — Blacklist de refresh tokens revocados en Firebase
 */

import { fbGet, fbSet, fbDelete } from './firebase.js';
import { b64urlDecode }           from './crypto.js';

const BLACKLIST_PATH = 'tokenBlacklist';

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

export async function blacklistToken(refreshToken, tok, db) {
  const key = deriveTokenKey(refreshToken);
  if (!key) throw new Error('Token inválido para blacklist');
  const exp = getTokenExpiry(refreshToken);
  await fbSet(`${BLACKLIST_PATH}/${key}`, { addedAt: Date.now(), exp }, tok, db);
}

export async function isTokenBlacklisted(refreshToken, tok, db) {
  try {
    const key   = deriveTokenKey(refreshToken);
    if (!key) return true;
    const entry = await fbGet(`${BLACKLIST_PATH}/${key}`, tok, db);
    return entry !== null;
  } catch (e) {
    console.warn('[token-blacklist] No se pudo consultar blacklist:', e.message);
    return false;
  }
}

export async function cleanupExpiredBlacklist(tok, db) {
  try {
    const all = await fbGet(BLACKLIST_PATH, tok, db);
    if (!all) return 0;
    const now     = Date.now();
    const expired = Object.entries(all)
      .filter(([, v]) => v && v.exp < now)
      .map(([k]) => k);
    if (expired.length === 0) return 0;
    await Promise.all(
      expired.map(k => fbDelete(`${BLACKLIST_PATH}/${k}`, tok, db).catch(() => {}))
    );
    return expired.length;
  } catch (e) {
    console.warn('[token-blacklist] Error en cleanup:', e.message);
    return 0;
  }
}

export async function blacklistAllUserTokens(uid, tok, db) {
  await fbSet(`userTokenRevoke/${uid}`, { revokedAt: Date.now() }, tok, db);
}

export async function isUserTokensRevoked(uid, issuedAt, tok, db) {
  try {
    const revoke = await fbGet(`userTokenRevoke/${uid}`, tok, db);
    if (!revoke) return false;
    return (issuedAt * 1000) < revoke.revokedAt;
  } catch {
    return false;
  }
}
