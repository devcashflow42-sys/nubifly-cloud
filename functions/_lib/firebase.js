/**
 * functions/_lib/firebase.js
 *
 * Acceso a Firebase Realtime Database vía REST API y obtención de token
 * OAuth2 con service account (RS256). Sólo usa Web Crypto / fetch — apto
 * para Cloudflare Workers / Pages Functions.
 */
import { b64url, pemToBuffer } from './crypto.js';

// ─── FIREBASE OAUTH2 TOKEN — RS256 con service account ──────
let _fbToken = null;
let _fbExpiry = 0;

export async function getFirebaseToken(sa) {
  if (_fbToken && Date.now() < _fbExpiry) return _fbToken;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform'
  };
  const data = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }))}.${b64url(JSON.stringify(payload))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(sa.private_key.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(data));
  const jwt = `${data}.${b64url(sig)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const td = await resp.json();
  if (!td.access_token) throw new Error('Firebase OAuth2: ' + JSON.stringify(td));

  _fbToken = td.access_token;
  _fbExpiry = Date.now() + (td.expires_in - 60) * 1000;
  return _fbToken;
}

// Limpia el token cacheado (lo llama fbGet cuando recibe 401).
export function invalidateFirebaseToken() {
  _fbToken = null;
  _fbExpiry = 0;
}

// ─── FIREBASE REALTIME DATABASE — REST API ──────────────────
//
//   tok = "secret:XXX"  → usa ?auth=XXX (Database Secret)
//   tok = OAuth2 token  → usa Authorization: Bearer
function fbReq(baseUrl, tok) {
  if (tok.startsWith('secret:')) {
    const u = new URL(baseUrl);
    u.searchParams.set('auth', tok.slice(7));
    return { url: u.toString(), headers: {} };
  }
  return { url: baseUrl, headers: { Authorization: `Bearer ${tok}` } };
}

export async function fbGet(path, tok, db) {
  const { url, headers } = fbReq(`${db}/${path}.json`, tok);
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) invalidateFirebaseToken();
    throw new Error(`Firebase ${r.status}: ${body.error || r.statusText}`);
  }
  const v = await r.json();
  return v === null ? null : v;
}

export async function fbSet(path, value, tok, db) {
  const { url, headers } = fbReq(`${db}/${path}.json`, tok);
  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error(`Firebase PUT ${r.status}`);
}

export async function fbDelete(path, tok, db) {
  const { url, headers } = fbReq(`${db}/${path}.json`, tok);
  const r = await fetch(url, { method: 'DELETE', headers });
  if (!r.ok && r.status !== 404) throw new Error(`Firebase DELETE ${r.status}`);
}

export async function fbUpdate(updates, tok, db) {
  const { url, headers } = fbReq(`${db}/.json`, tok);
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Firebase PATCH ${r.status}: ${txt}`);
  }
}

export async function fbQuery(path, orderBy, equalTo, tok, db) {
  const { url: base, headers } = fbReq(`${db}/${path}.json`, tok);
  const u = new URL(base);
  u.searchParams.set('orderBy', `"${orderBy}"`);
  u.searchParams.set('equalTo', `"${equalTo}"`);
  const r = await fetch(u.toString(), { headers });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    console.warn(`[fbQuery] ${path} orderBy=${orderBy}: HTTP ${r.status} — ${body.error || r.statusText}`);
    return {};
  }
  return (await r.json()) || {};
}
