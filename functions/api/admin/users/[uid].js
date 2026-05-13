/**
 * GET    /api/admin/users/:uid — ver usuario completo
 * PATCH  /api/admin/users/:uid — editar usuario / banear / suspender
 * DELETE /api/admin/users/:uid — eliminar usuario permanentemente
 *
 * Todos los métodos requieren JWT + role === 'admin'.
 */
import { authenticate }                       from '../../../_lib/auth.js';
import { fbGet, fbUpdate, fbDelete }          from '../../../_lib/firebase.js';
import { jsonRes, ok, fail }                  from '../../../_lib/response.js';
import { toEmailKey }                         from '../../../_lib/helpers.js';

// ── Admin guard ───────────────────────────────────────────────────────────────
async function requireAdmin(request, env, tok, db) {
  const user = await authenticate(request, env);
  if (!user) return { error: jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401) };

  let ctrl;
  try { ctrl = await fbGet(`controlUsers/${user.uid}`, tok, db); }
  catch { return { error: jsonRes(fail('Error verificando permisos.', 'DB_ERROR'), 503) }; }

  if (!ctrl || ctrl.role !== 'admin')
    return { error: jsonRes(fail('Acceso denegado. Se requiere rol admin.', 'FORBIDDEN'), 403) };

  return { adminUser: user, adminCtrl: ctrl };
}

// ── Shared: load target user ──────────────────────────────────────────────────
async function loadTarget(uid, tok, db) {
  const [user, ctrl] = await Promise.all([
    fbGet(`users/${uid}`, tok, db).catch(() => null),
    fbGet(`controlUsers/${uid}`, tok, db).catch(() => null)
  ]);
  return { user, ctrl };
}

// ── GET /api/admin/users/:uid ─────────────────────────────────────────────────
export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;
  const targetUid        = context.params.uid;

  const { adminUser, error } = await requireAdmin(request, env, tok, db);
  if (error) return error;

  const { user, ctrl } = await loadTarget(targetUid, tok, db);
  if (!user) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

  return jsonRes(ok({ user: {
    uid:            targetUid,
    name:           user.name          || '',
    username:       user.username      || '',
    email:          user.email         || '',
    avatar:         user.avatar        || '',
    bio:            user.bio           || '',
    isOnline:       user.isOnline      || false,
    lastSeen:       user.lastSeen      || 0,
    createdAt:      user.createdAt     || 0,
    updatedAt:      user.updatedAt     || 0,
    accountStatus:  ctrl?.accountStatus || 'active',
    role:           ctrl?.role          || 'user',
    plan:           ctrl?.plan?.type    || 'normal',
    isPremium:      ctrl?.plan?.isPremium || false,
    premiumUntil:   ctrl?.plan?.premiumUntil || 0,
    isBanned:       ctrl?.ban?.isBanned    || false,
    banReason:      ctrl?.ban?.reason      || '',
    bannedAt:       ctrl?.ban?.createdAt   || 0,
    isSuspended:    ctrl?.suspension?.isSuspended || false,
    suspendReason:  ctrl?.suspension?.reason      || '',
    suspendUntil:   ctrl?.suspension?.until       || 0,
    emailVerified:  ctrl?.verification?.emailVerified || false,
    lastLogin:      ctrl?.security?.lastLogin     || 0,
    loginAttempts:  ctrl?.security?.loginAttempts || 0,
    lastFailedAttempt: ctrl?.security?.lastFailedAttempt || 0,
    permissions:    ctrl?.permissions || {},
    limits:         ctrl?.limits      || {}
  } }));
}

// ── PATCH /api/admin/users/:uid ───────────────────────────────────────────────
export async function onRequestPatch(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;
  const targetUid        = context.params.uid;

  const { adminUser, error } = await requireAdmin(request, env, tok, db);
  if (error) return error;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { user, ctrl } = await loadTarget(targetUid, tok, db);
  if (!user) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

  // ── Self-action guards ────────────────────────────────────────────────────
  const isSelf = targetUid === adminUser.uid;

  if (isSelf && (body.ban === true || body.ban === 'true'))
    return jsonRes(fail('No puedes banearte a ti mismo.', 'SELF_ACTION'), 403);

  if (isSelf && (body.suspend === true || body.suspend === 'true'))
    return jsonRes(fail('No puedes suspenderte a ti mismo.', 'SELF_ACTION'), 403);

  if (isSelf && body.role !== undefined && body.role !== 'admin')
    return jsonRes(fail('No puedes cambiar tu propio rol de admin.', 'SELF_ACTION'), 403);

  // ── Validate fields ───────────────────────────────────────────────────────
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (v.length < 2 || v.length > 50)
      return jsonRes(fail('El nombre debe tener entre 2 y 50 caracteres.', 'INVALID_NAME'), 400);
  }
  if (body.bio !== undefined && String(body.bio).trim().length > 300)
    return jsonRes(fail('La bio no puede superar 300 caracteres.', 'INVALID_BIO'), 400);
  if (body.avatar !== undefined && body.avatar && !String(body.avatar).startsWith('https://'))
    return jsonRes(fail('El avatar debe ser una URL que empiece con https://', 'INVALID_AVATAR'), 400);
  if (body.accountStatus !== undefined && !['active', 'inactive', 'pending'].includes(body.accountStatus))
    return jsonRes(fail('accountStatus debe ser: active, inactive o pending.', 'INVALID_STATUS'), 400);
  if (body.role !== undefined && !['user', 'admin', 'moderator'].includes(body.role))
    return jsonRes(fail('role debe ser: user, admin o moderator.', 'INVALID_ROLE'), 400);
  if (body.plan !== undefined && !['free', 'normal', 'pro', 'enterprise'].includes(body.plan))
    return jsonRes(fail('plan debe ser: free, normal, pro o enterprise.', 'INVALID_PLAN'), 400);

  // ── Build multi-path update ───────────────────────────────────────────────
  const now     = Date.now();
  const updates = { [`users/${targetUid}/updatedAt`]: now };

  if (body.name   !== undefined) updates[`users/${targetUid}/name`]   = String(body.name).trim();
  if (body.bio    !== undefined) updates[`users/${targetUid}/bio`]    = String(body.bio).trim().slice(0, 300);
  if (body.avatar !== undefined) updates[`users/${targetUid}/avatar`] = String(body.avatar).trim();

  if (body.accountStatus !== undefined)
    updates[`controlUsers/${targetUid}/accountStatus`] = body.accountStatus;
  if (body.role !== undefined)
    updates[`controlUsers/${targetUid}/role`] = body.role;
  if (body.plan !== undefined) {
    updates[`controlUsers/${targetUid}/plan/type`]      = body.plan;
    updates[`controlUsers/${targetUid}/plan/isPremium`] = body.plan === 'pro' || body.plan === 'enterprise';
  }

  // Ban / unban
  if (body.ban === true || body.ban === false) {
    updates[`controlUsers/${targetUid}/ban/isBanned`]  = body.ban;
    updates[`controlUsers/${targetUid}/ban/reason`]    = body.ban ? (String(body.banReason || '').slice(0, 200)) : '';
    updates[`controlUsers/${targetUid}/ban/createdAt`] = body.ban ? now : 0;
    if (body.ban) {
      // Banned users are forced inactive
      updates[`controlUsers/${targetUid}/accountStatus`] = 'inactive';
    }
  } else if (body.banReason !== undefined && ctrl?.ban?.isBanned) {
    updates[`controlUsers/${targetUid}/ban/reason`] = String(body.banReason).slice(0, 200);
  }

  // Suspend / unsuspend
  if (body.suspend === true || body.suspend === false) {
    const days       = Math.min(365, Math.max(1, parseInt(body.suspendDays || '1', 10)));
    const until      = body.suspend ? now + days * 86_400_000 : 0;
    updates[`controlUsers/${targetUid}/suspension/isSuspended`] = body.suspend;
    updates[`controlUsers/${targetUid}/suspension/reason`]      = body.suspend ? (String(body.suspendReason || '').slice(0, 200)) : '';
    updates[`controlUsers/${targetUid}/suspension/until`]       = until;
    updates[`controlUsers/${targetUid}/suspension/createdAt`]   = body.suspend ? now : 0;
  }

  updates[`controlUsers/${targetUid}/updatedAt`] = now;

  try { await fbUpdate(updates, tok, db); }
  catch (e) {
    console.error('[admin PATCH user]', e.message);
    return jsonRes(fail('Error actualizando usuario: ' + e.message, 'DB_WRITE_ERROR'), 503);
  }

  // Return updated record
  const { user: updated, ctrl: updatedCtrl } = await loadTarget(targetUid, tok, db);
  return jsonRes(ok({
    uid:           targetUid,
    name:          updated?.name          || '',
    username:      updated?.username      || '',
    email:         updated?.email         || '',
    accountStatus: updatedCtrl?.accountStatus || 'active',
    role:          updatedCtrl?.role          || 'user',
    plan:          updatedCtrl?.plan?.type    || 'normal',
    isBanned:      updatedCtrl?.ban?.isBanned    || false,
    isSuspended:   updatedCtrl?.suspension?.isSuspended || false,
    updatedAt:     now
  }, 'Usuario actualizado correctamente.'));
}

// ── DELETE /api/admin/users/:uid ──────────────────────────────────────────────
export async function onRequestDelete(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;
  const targetUid        = context.params.uid;

  const { adminUser, error } = await requireAdmin(request, env, tok, db);
  if (error) return error;

  if (targetUid === adminUser.uid)
    return jsonRes(fail('No puedes eliminar tu propia cuenta.', 'SELF_ACTION'), 403);

  const { user, ctrl } = await loadTarget(targetUid, tok, db);
  if (!user) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

  const emailKey = user.email ? toEmailKey(user.email) : null;
  const username = user.username?.toLowerCase() || null;

  // ── Atomic delete of core records ─────────────────────────────────────────
  const updates = {
    [`users/${targetUid}`]:        null,
    [`controlUsers/${targetUid}`]: null,
  };
  if (emailKey) updates[`emails/${emailKey}`]   = null;
  if (username) updates[`usernames/${username}`] = null;

  try { await fbUpdate(updates, tok, db); }
  catch (e) {
    console.error('[admin DELETE user]', e.message);
    return jsonRes(fail('Error eliminando usuario: ' + e.message, 'DB_WRITE_ERROR'), 503);
  }

  // ── Best-effort cleanup of secondary data ─────────────────────────────────
  await Promise.allSettled([
    fbDelete(`userApiKeys/${targetUid}`, tok, db),
    fbDelete(`notifications/${targetUid}`, tok, db),
    fbDelete(`userFiles/${targetUid}`, tok, db),
    fbDelete(`userProjects/${targetUid}`, tok, db),
    fbDelete(`userTokenRevoke/${targetUid}`, tok, db)
  ]);

  return jsonRes(ok({
    uid:      targetUid,
    email:    user.email    || '',
    username: user.username || ''
  }, 'Usuario eliminado permanentemente.'));
}
