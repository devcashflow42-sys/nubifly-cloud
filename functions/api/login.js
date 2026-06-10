/**
 * functions/api/login.js
 *
 * POST /api/login  — autentica al usuario
 * GET  /api/login  — info de uso
 *
 * Devuelve accessToken (15 min) + refreshToken (30 días).
 * El campo "token" legacy sigue presente por compatibilidad con clientes antiguos.
 */

import { verifyPassword, signJwt }  from '../_lib/crypto.js';
import { fbGet, fbUpdate }          from '../_lib/firebase.js';
import { syncFirebaseAuthUser }     from '../_lib/firebase-auth.js';
import { toEmailKey }               from '../_lib/helpers.js';
import { jsonRes, fail }            from '../_lib/response.js';

export async function onRequestGet() {
  return jsonRes({
    success: true,
    endpoint: 'POST /api/login',
    campos:   { email: 'string', password: 'string' },
    nota:     'Devuelve accessToken (15 min) y refreshToken (30 días).'
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { email, password } = body;
  if (!email || !password)
    return jsonRes(fail('Email y contraseña son requeridos.'), 400);

  const emailKey = toEmailKey(email);
  let uid;
  try {
    uid = await fbGet(`emails/${emailKey}`, tok, db);
  } catch (err) {
    console.error('[Login] Error leyendo Firebase:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503);
  }
  if (!uid) return jsonRes(fail('Credenciales inválidas.'), 401);

  let user, control;
  try {
    [user, control] = await Promise.all([
      fbGet(`users/${uid}`, tok, db),
      fbGet(`controlUsers/${uid}`, tok, db)
    ]);
  } catch (err) {
    console.error('[Login] Error cargando usuario:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503);
  }
  if (!user || !control) return jsonRes(fail('Credenciales inválidas.'), 401);

  const { ok: pwOk, legacy } = await verifyPassword(password, control.security?.passwordHash);
  if (legacy) {
    return jsonRes(
      fail('Cuenta creada en el servidor anterior. Por favor regístrate de nuevo.', 'LEGACY_ACCOUNT'),
      401
    );
  }
  if (!pwOk) {
    await fbUpdate({
      [`controlUsers/${uid}/security/loginAttempts`]:     (control.security?.loginAttempts || 0) + 1,
      [`controlUsers/${uid}/security/lastFailedAttempt`]: Date.now()
    }, tok, db).catch(() => {});
    return jsonRes(fail('Credenciales inválidas.'), 401);
  }

  if (control.ban?.isBanned) {
    return jsonRes(
      fail('Tu cuenta ha sido baneada permanentemente.', 'BANNED', { reason: control.ban.reason || '' }),
      403
    );
  }
  if (control.suspension?.isSuspended) {
    const still = control.suspension.until === 0 || control.suspension.until > Date.now();
    if (still) {
      return jsonRes(fail('Tu cuenta está suspendida.', 'SUSPENDED', {
        reason: control.suspension.reason || '',
        until:  control.suspension.until === 0 ? 'indefinido' : new Date(control.suspension.until).toISOString()
      }), 403);
    }
    await fbUpdate({
      [`controlUsers/${uid}/accountStatus`]:          'active',
      [`controlUsers/${uid}/suspension/isSuspended`]: false
    }, tok, db).catch(() => {});
  }
  if (control.accountStatus !== 'active') {
    return jsonRes(fail('Tu cuenta no está activa.', 'INACTIVE'), 403);
  }
  if (control.permissions?.canLogin === false) {
    return jsonRes(fail('No tienes permiso para iniciar sesión.', 'NO_LOGIN_PERMISSION'), 403);
  }

  const now = Date.now();
  await fbUpdate({
    [`controlUsers/${uid}/security/loginAttempts`]: 0,
    [`controlUsers/${uid}/security/lastLogin`]:     now,
    [`users/${uid}/isOnline`]:                       true,
    [`users/${uid}/lastSeen`]:                       now,
    [`users/${uid}/updatedAt`]:                      now
  }, tok, db).catch(() => {});

  const fbAuthLogin = await syncFirebaseAuthUser(env, {
    kind:          'password',
    uid,
    email:         user.email,
    password,
    displayName:   user.name || user.username || '',
    photoUrl:      user.avatar || '',
    emailVerified: !!control.verification?.emailVerified
  }).catch((e) => ({ ok: false, reason: 'sync threw', detail: e.message }));

  const tokenPayload   = { uid, username: user.username, email: user.email };
  const REFRESH_SECRET = env.JWT_REFRESH_SECRET || (env.JWT_SECRET + '_refresh');

  const [accessToken, refreshToken] = await Promise.all([
    signJwt(tokenPayload, env.JWT_SECRET, '15m'),
    signJwt({ ...tokenPayload, type: 'refresh' }, REFRESH_SECRET, '30d')
  ]);

  return jsonRes({
    success:      true,
    message:      '✅ Inicio de sesión exitoso.',
    accessToken,
    refreshToken,
    expiresIn:    900,
    token:        accessToken,   // compatibilidad legacy
    uid,
    user: {
      name:      user.name,
      username:  user.username,
      email:     user.email,
      avatar:    user.avatar,
      bio:       user.bio,
      isOnline:  true,
      lastSeen:  now,
      createdAt: user.createdAt,
      updatedAt: now
    },
    firebaseAuth: fbAuthLogin
  });
}
