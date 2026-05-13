/**
 * functions/api/auth/refresh.js
 * POST /api/auth/refresh — renueva el accessToken con el refreshToken
 */

import { verifyJwt, signJwt }                    from '../../_lib/crypto.js';
import { isTokenBlacklisted, blacklistToken,
         isUserTokensRevoked }                    from '../../_lib/token-blacklist.js';
import { fbGet }                                  from '../../_lib/firebase.js';
import { jsonRes, fail }                          from '../../_lib/response.js';

export async function onRequestGet() {
  return jsonRes({
    success: true,
    endpoint: 'POST /api/auth/refresh',
    campos:   { refreshToken: 'string' },
    nota:     'Renueva el accessToken usando un refreshToken válido.'
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { refreshToken } = body;
  if (!refreshToken)
    return jsonRes(fail('refreshToken es requerido.', 'TOKEN_MISSING'), 400);

  const REFRESH_SECRET = env.JWT_REFRESH_SECRET || (env.JWT_SECRET + '_refresh');
  let payload;
  try {
    payload = await verifyJwt(refreshToken, REFRESH_SECRET);
  } catch {
    return jsonRes(
      fail('Refresh token inválido o expirado. Inicia sesión de nuevo.', 'TOKEN_INVALID'),
      401
    );
  }

  if (payload.type !== 'refresh')
    return jsonRes(fail('Token de tipo incorrecto.', 'TOKEN_WRONG_TYPE'), 401);

  const blacklisted = await isTokenBlacklisted(refreshToken, tok, db);
  if (blacklisted)
    return jsonRes(fail('Refresh token revocado. Inicia sesión de nuevo.', 'TOKEN_REVOKED'), 401);

  const userRevoked = await isUserTokensRevoked(payload.uid, payload.iat || 0, tok, db);
  if (userRevoked)
    return jsonRes(fail('Sesión inválida. Por favor inicia sesión de nuevo.', 'SESSION_REVOKED'), 401);

  let user, control;
  try {
    [user, control] = await Promise.all([
      fbGet(`users/${payload.uid}`, tok, db),
      fbGet(`controlUsers/${payload.uid}`, tok, db)
    ]);
  } catch {
    return jsonRes(fail('Error conectando con la base de datos.', 'DB_ERROR'), 503);
  }

  if (!user || !control)
    return jsonRes(fail('Usuario no encontrado.', 'USER_NOT_FOUND'), 401);
  if (control.ban?.isBanned)
    return jsonRes(fail('Cuenta baneada permanentemente.', 'BANNED'), 403);
  if (control.suspension?.isSuspended) {
    const still = control.suspension.until === 0 || control.suspension.until > Date.now();
    if (still) return jsonRes(fail('Cuenta suspendida.', 'SUSPENDED'), 403);
  }
  if (control.accountStatus !== 'active')
    return jsonRes(fail('Cuenta no activa.', 'ACCOUNT_INACTIVE'), 403);

  // Token rotation — invalidar el usado
  blacklistToken(refreshToken, tok, db).catch(e => {
    console.warn('[refresh] No se pudo invalidar refreshToken:', e.message);
  });

  const tokenPayload = { uid: payload.uid, username: user.username, email: user.email };

  const newAccessToken  = await signJwt(tokenPayload, env.JWT_SECRET, '15m');
  const newRefreshToken = await signJwt(
    { ...tokenPayload, type: 'refresh' }, REFRESH_SECRET, '30d'
  );

  return jsonRes({
    success:      true,
    message:      'Token renovado exitosamente.',
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn:    900,
    user: {
      name:     user.name,
      username: user.username,
      email:    user.email,
      avatar:   user.avatar
    }
  });
}
