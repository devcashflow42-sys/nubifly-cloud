/**
 * ══════════════════════════════════════════════════════════════════════════
 *  /api/auth/github/index.js  —  PATCH para soportar móvil (Custom Tabs)
 *  Ruta: functions/api/auth/github/index.js
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  CAMBIOS respecto a la versión anterior:
 *    → Acepta query params `redirect` y `state` desde el cliente.
 *    → Empaqueta ambos en el `state` que se envía a GitHub para que
 *      vuelvan intactos en el callback.
 *    → Valida el `redirect` contra una lista blanca para prevenir
 *      open-redirect (vulnerabilidad clásica de OAuth).
 * ══════════════════════════════════════════════════════════════════════════
 */
import { jsonRes, fail } from '../../../_lib/response.js';

const DEFAULT_ALLOWED = [
  'nubifly://',         // Deep link de la app Android
];

function getAllowedPrefixes(env, origin) {
  const fromEnv = (env.GITHUB_ALLOWED_REDIRECTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED, ...fromEnv, `${origin}/`];
}

function isRedirectAllowed(redirect, allowedPrefixes) {
  if (!redirect) return false;
  return allowedPrefixes.some(p => redirect.startsWith(p));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return jsonRes(fail('GITHUB_CLIENT_ID no configurado.', 'CONFIG_ERROR'), 503);
  }

  const url    = new URL(request.url);
  const origin = url.origin;

  const clientRedirect = url.searchParams.get('redirect') || '';
  const clientState    = url.searchParams.get('state')    || '';

  const allowed = getAllowedPrefixes(env, origin);

  const finalRedirect = isRedirectAllowed(clientRedirect, allowed)
    ? clientRedirect
    : `${origin}/home`;

  const statePayload = JSON.stringify({
    r: finalRedirect,
    c: clientState,
    n: crypto.randomUUID().replace(/-/g, ''),
    t: Date.now()
  });
  const stateB64 = btoa(statePayload)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const redirectUri = env.GITHUB_REDIRECT_URI || `${origin}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: redirectUri,
    scope:        'user:email read:user',
    state:        stateB64
  });

  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
}
