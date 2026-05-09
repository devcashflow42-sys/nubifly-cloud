/**
 * GET /api/auth/google
 *
 * Inicia el flujo OAuth con Google: redirige al consent screen.
 */
import { jsonRes, fail } from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonRes(fail('GOOGLE_CLIENT_ID no configurado.', 'CONFIG_ERROR'), 503);

  const url = new URL(request.url);
  const redirectUri = env.GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account'
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
