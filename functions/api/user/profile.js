/**
 * GET   /api/user/profile  — devuelve el perfil del usuario autenticado
 * PATCH /api/user/profile  — actualiza name / bio / avatar
 */
import { requireAuth }    from '../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const [userRec, ctrl] = await Promise.all([
    fbGet(`users/${user.uid}`, tok, db),
    fbGet(`controlUsers/${user.uid}`, tok, db)
  ]);

  if (!userRec) {
    // Registro mínimo desde el JWT cuando users/ está vacío
    return jsonRes(ok({ user: {
      uid:           user.uid,
      name:          user.username || user.email || '',
      username:      user.username || '',
      email:         user.email    || '',
      avatar:        '', bio: '',
      isOnline:      false,
      lastSeen:      0,
      createdAt:     0,
      plan:          ctrl?.plan?.type    || 'normal',
      isPremium:     ctrl?.plan?.isPremium || false,
      accountStatus: ctrl?.accountStatus  || 'active',
      permissions:   ctrl?.permissions    || {},
      limits:        ctrl?.limits         || {}
    } }));
  }

  return jsonRes(ok({ user: {
    uid:           user.uid,
    name:          userRec.name      || '',
    username:      userRec.username  || '',
    email:         userRec.email     || '',
    avatar:        userRec.avatar    || '',
    bio:           userRec.bio       || '',
    isOnline:      userRec.isOnline  || false,
    lastSeen:      userRec.lastSeen  || 0,
    createdAt:     userRec.createdAt || 0,
    plan:          ctrl?.plan?.type    || 'normal',
    isPremium:     ctrl?.plan?.isPremium || false,
    accountStatus: ctrl?.accountStatus  || 'active',
    permissions:   ctrl?.permissions    || {},
    limits:        ctrl?.limits         || {}
  } }));
}

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const updates = { [`users/${user.uid}/updatedAt`]: Date.now() };
  if (body.name   !== undefined) updates[`users/${user.uid}/name`]   = String(body.name).trim().slice(0, 50);
  if (body.bio    !== undefined) updates[`users/${user.uid}/bio`]    = String(body.bio).trim().slice(0, 300);
  if (body.avatar !== undefined) updates[`users/${user.uid}/avatar`] = String(body.avatar).trim();

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({}, 'Perfil actualizado correctamente.'));
}
