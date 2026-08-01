/**
 * functions/api/login.js
 *
 * POST /api/login  — autentica al usuario (PostgreSQL)
 * GET  /api/login  — info de uso
 *
 * Devuelve accessToken (15 min) + refreshToken (30 días).
 * El campo "token" legacy sigue presente por compatibilidad.
 */

import { verifyPassword, signJwt }  from '../_lib/crypto.js';
import { toEmailNormal }            from '../_lib/helpers.js';
import { isAdminEmail }             from '../_lib/db.js';
import { rowToUser, rowToControl }  from '../_lib/models.js';
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
  const { sql } = context.data;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { email, password } = body;
  if (!email || !password)
    return jsonRes(fail('Email y contraseña son requeridos.'), 400);

  const emailNormal = toEmailNormal(email);

  let userRow, controlRow;
  try {
    userRow = (await sql`select * from users where email = ${emailNormal}`)[0] || null;
    if (userRow) controlRow = (await sql`select * from control_users where uid = ${userRow.uid}`)[0] || null;
  } catch (err) {
    console.error('[Login] Error leyendo BD:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503);
  }
  if (!userRow || !controlRow) return jsonRes(fail('Credenciales inválidas.'), 401);

  const user    = rowToUser(userRow);
  const control = rowToControl(controlRow);
  const uid     = user.uid;

  const { ok: pwOk, legacy } = await verifyPassword(password, control.security?.passwordHash);
  if (legacy) {
    return jsonRes(fail('Cuenta creada en el servidor anterior. Por favor regístrate de nuevo.', 'LEGACY_ACCOUNT'), 401);
  }
  if (!pwOk) {
    sql`update control_users set login_attempts = ${(control.security?.loginAttempts || 0) + 1}, last_failed_attempt = ${Date.now()} where uid = ${uid}`.catch(() => {});
    return jsonRes(fail('Credenciales inválidas.'), 401);
  }

  if (control.ban?.isBanned) {
    return jsonRes(fail('Tu cuenta ha sido baneada permanentemente.', 'BANNED', { reason: control.ban.reason || '' }), 403);
  }
  if (control.suspension?.isSuspended) {
    const still = control.suspension.until === 0 || control.suspension.until > Date.now();
    if (still) {
      return jsonRes(fail('Tu cuenta está suspendida.', 'SUSPENDED', {
        reason: control.suspension.reason || '',
        until:  control.suspension.until === 0 ? 'indefinido' : new Date(control.suspension.until).toISOString()
      }), 403);
    }
    sql`update control_users set account_status = 'active', susp_is_suspended = false where uid = ${uid}`.catch(() => {});
  }
  if (control.accountStatus !== 'active') {
    return jsonRes(fail('Tu cuenta no está activa.', 'INACTIVE'), 403);
  }
  if (control.permissions?.canLogin === false) {
    return jsonRes(fail('No tienes permiso para iniciar sesión.', 'NO_LOGIN_PERMISSION'), 403);
  }

  const now  = Date.now();
  // Promueve a admin si el email coincide con ADMIN_EMAIL (por si se configuró luego)
  const role = isAdminEmail(env, user.email) ? 'admin' : control.role;

  sql`update control_users set login_attempts = 0, last_login = ${now}, role = ${role} where uid = ${uid}`.catch(() => {});
  sql`update users set is_online = true, last_seen = ${now}, updated_at = ${now} where uid = ${uid}`.catch(() => {});

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
    }
  });
}
