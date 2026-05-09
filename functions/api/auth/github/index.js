/**
 * GET /api/auth/github
 *
 * Inicia el flujo OAuth con GitHub: redirige al consent screen.
 */
import { jsonRes, fail } from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return jsonRes(fail('GITHUB_CLIENT_ID no configurado.', 'CONFIG_ERROR'), 503);

  const url = new URL(request.url);
  const redirectUri = env.GITHUB_REDIRECT_URI || `${url.origin}/api/auth/github/callback`;

  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: redirectUri,
    scope:        'user:email read:user'
  });

  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
}
