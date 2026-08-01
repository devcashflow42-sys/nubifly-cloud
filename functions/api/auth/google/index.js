/**
 * GET  /api/auth/google  — inicia el flujo OAuth (web)
 * POST /api/auth/google  — verifica un idToken de Google Sign-In (Android/iOS)
 *                          y devuelve un JWT propio de la app.  (PostgreSQL)
 */
import { signJwt }              from '../../../_lib/crypto.js';
import { upsertOAuthUser }      from '../../../_lib/oauth-user.js';
import { jsonRes, fail }        from '../../../_lib/response.js';

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const { sql } = context.data;

  let body;
  try { body = await request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { id_token } = body;
  if (!id_token) return jsonRes(fail('El campo id_token es requerido.', 'MISSING_TOKEN'), 400);

  // Verificar el id_token con Google
  let tokenInfo;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
    if (!res.ok) {
      console.error('[GoogleAuth] tokeninfo error:', res.status);
      return jsonRes(fail('Token de Google inválido o expirado.', 'INVALID_TOKEN'), 401);
    }
    tokenInfo = await res.json();
  } catch (e) {
    console.error('[GoogleAuth] tokeninfo network error:', e.message);
    return jsonRes(fail('Error verificando token con Google.', 'GOOGLE_VERIFY_ERROR'), 503);
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  if (clientId && tokenInfo.aud !== clientId && tokenInfo.azp !== clientId) {
    return jsonRes(fail('Token no pertenece a esta aplicación.', 'WRONG_AUDIENCE'), 401);
  }

  const { sub: googleId, email, name = '', picture: photo = '', email_verified } = tokenInfo;
  if (!email || !googleId) return jsonRes(fail('Token no contiene email o sub.', 'INVALID_TOKEN'), 401);
  if (email_verified !== 'true' && email_verified !== true)
    return jsonRes(fail('El email de Google no está verificado.', 'EMAIL_NOT_VERIFIED'), 401);

  const result = await upsertOAuthUser(sql, env, { email, name, photo });
  if (result.error) {
    const { code, message, status, reason } = result.error;
    return jsonRes(fail(message, code, reason ? { reason } : {}), status);
  }
  const { uid, user, isNew } = result;

  let token;
  try {
    token = await signJwt({ uid, username: user.username, email: user.email }, env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d');
  } catch (e) {
    return jsonRes(fail('Error generando sesión.', 'TOKEN_ERROR'), 500);
  }

  return jsonRes({
    success: true,
    message: isNew ? '✅ Cuenta creada con Google.' : '✅ Inicio de sesión con Google exitoso.',
    token,
    uid,
    isNew,
    user: { uid, email: user.email, name: user.name, username: user.username, photo: user.avatar || photo }
  }, isNew ? 201 : 200);
}
