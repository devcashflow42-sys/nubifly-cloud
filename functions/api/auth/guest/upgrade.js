/**
 * POST /api/auth/guest/upgrade — convertir invitado en usuario registrado (PostgreSQL)
 *
 * Authorization: Bearer <guestToken>
 * Body: { email, password, username, name? }
 */
import { verifyJwt, signJwt, hashPassword } from '../../../_lib/crypto.js';
import { toEmailKey, toEmailNormal }        from '../../../_lib/helpers.js';
import { isAdminEmail }                      from '../../../_lib/db.js';
import { jsonRes, fail }                     from '../../../_lib/response.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { sql } = context.data;

  const h          = request.headers.get('Authorization') || '';
  const guestToken = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!guestToken) return jsonRes(fail('Token de invitado requerido.', 'UNAUTHORIZED'), 401);

  let guestPayload;
  try { guestPayload = await verifyJwt(guestToken, env.JWT_SECRET); }
  catch { return jsonRes(fail('Token inválido o expirado.', 'TOKEN_INVALID'), 401); }

  if (guestPayload.type !== 'guest') {
    return jsonRes(fail('Solo los invitados pueden usar este endpoint.', 'NOT_GUEST'), 400);
  }

  const guestId = guestPayload.uid;

  let session;
  try { session = (await sql`select created_at from guest_sessions where guest_id = ${guestId}`)[0] || null; } catch {}
  if (!session) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('Body JSON inválido.', 'BAD_REQUEST'), 400); }

  const { email, password, username, name } = body || {};
  if (!email || !password || !username) {
    return jsonRes(fail('email, password y username son requeridos.', 'MISSING_FIELDS'), 400);
  }

  const emailNormal = toEmailNormal(email);
  const emailKey    = toEmailKey(emailNormal);
  const usernameLC  = String(username).toLowerCase().trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailNormal)) return jsonRes(fail('Email inválido.', 'INVALID_EMAIL'), 400);
  if (/[/#$\[\]]/.test(emailNormal)) return jsonRes(fail('El email contiene caracteres no permitidos.', 'INVALID_EMAIL'), 400);
  if (password.length < 8) return jsonRes(fail('La contraseña debe tener al menos 8 caracteres.', 'WEAK_PASSWORD'), 400);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(usernameLC)) return jsonRes(fail('El username debe tener 3-20 caracteres alfanuméricos o _.', 'INVALID_USERNAME'), 400);

  let dup;
  try {
    dup = await sql`select
      exists(select 1 from users where email = ${emailNormal})    as email_taken,
      exists(select 1 from users where username = ${usernameLC})  as user_taken`;
  } catch { return jsonRes(fail('Error al verificar datos.', 'DB_ERROR'), 500); }
  if (dup[0].email_taken) return jsonRes(fail('Este email ya está registrado.', 'EMAIL_EXISTS'), 409);
  if (dup[0].user_taken)  return jsonRes(fail('Este nombre de usuario ya está en uso.', 'USERNAME_TAKEN'), 409);

  const now          = Date.now();
  const passwordHash = await hashPassword(password);
  const finalName    = (name || usernameLC).slice(0, 50);
  const role         = isAdminEmail(env, emailNormal) ? 'admin' : 'user';

  const permissions = { canLogin: true, canUpload: true, canCreateProjects: true, canPost: true, canUseApi: true, canComment: true };
  const verification = { emailVerified: false, phoneVerified: false, identityVerified: false };
  const moderation   = { warnings: 0, reports: 0, notes: '' };

  try {
    await sql.begin(async (tx) => {
      await tx`update users set type = 'user', name = ${finalName}, username = ${usernameLC},
               email = ${emailNormal}, guest_data = null, is_online = true, last_seen = ${now}, updated_at = ${now}
               where uid = ${guestId}`;
      await tx`insert into control_users
                 (uid, account_status, role, plan_type, is_premium, max_api_keys, monthly_requests, max_file_size_mb,
                  password_hash, permissions, verification, moderation, created_at, updated_at)
               values
                 (${guestId}, 'active', ${role}, 'gratis', false, 2, 1000, 50,
                  ${passwordHash}, ${tx.json(permissions)}, ${tx.json(verification)}, ${tx.json(moderation)},
                  ${session.created_at || now}, ${now})
               on conflict (uid) do update set password_hash = ${passwordHash}, role = ${role}, updated_at = ${now}`;
      await tx`insert into emails (email_key, uid) values (${emailKey}, ${guestId}) on conflict (email_key) do update set uid = ${guestId}`;
      await tx`insert into usernames (username, uid) values (${usernameLC}, ${guestId}) on conflict (username) do update set uid = ${guestId}`;
      await tx`delete from guest_sessions where guest_id = ${guestId}`;
    });
  } catch (e) {
    console.error('[guest/upgrade] error:', e.message);
    return jsonRes(fail('Error al actualizar cuenta.', 'DB_ERROR'), 500);
  }

  const REFRESH_SECRET = env.JWT_REFRESH_SECRET || (env.JWT_SECRET + '_refresh');
  const tokenPayload   = { uid: guestId, username: usernameLC, email: emailNormal };
  let accessToken, refreshToken;
  try {
    [accessToken, refreshToken] = await Promise.all([
      signJwt(tokenPayload, env.JWT_SECRET, '15m'),
      signJwt({ ...tokenPayload, type: 'refresh' }, REFRESH_SECRET, '30d')
    ]);
  } catch (e) {
    console.error('[guest/upgrade] signJwt:', e.message);
    return jsonRes(fail('Error al generar tokens.', 'TOKEN_ERROR'), 500);
  }

  return jsonRes({
    success:      true,
    message:      '¡Cuenta creada correctamente! Bienvenido a Nubifly.',
    accessToken,
    refreshToken,
    expiresIn:    900,
    uid:          guestId,
    user: { uid: guestId, type: 'user', name: finalName, username: usernameLC, email: emailNormal }
  });
}
