/**
 * GET   /api/user/profile  — perfil privado completo del usuario autenticado
 * PATCH /api/user/profile  — editar name, username, bio, website, location, banner
 */
import { requireAuth }     from '../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let userRec, ctrl;
  try {
    [userRec, ctrl] = await Promise.all([
      fbGet(`users/${user.uid}`, tok, db),
      fbGet(`controlUsers/${user.uid}`, tok, db)
    ]);
  } catch (e) {
    console.error('[GET profile]', e.message);
    return jsonRes(fail('Error leyendo datos de usuario.', 'DB_ERROR'), 503);
  }

  if (!userRec) {
    return jsonRes(ok({ user: {
      uid:           user.uid,
      username:      user.username || '',
      name:          user.username || user.email || '',
      email:         user.email    || '',
      bio:           '',
      avatar:        '',
      banner:        '',
      website:       '',
      location:      '',
      isOnline:      false,
      accountStatus: ctrl?.accountStatus  || 'active',
      plan:          ctrl?.plan?.type     || 'normal',
      isPremium:     ctrl?.plan?.isPremium || false,
      createdAt:     0,
      updatedAt:     0
    } }));
  }

  return jsonRes(ok({ user: {
    uid:           user.uid,
    username:      userRec.username  || '',
    name:          userRec.name      || '',
    email:         userRec.email     || '',
    bio:           userRec.bio       || '',
    avatar:        userRec.avatar    || '',
    banner:        userRec.banner    || '',
    website:       userRec.website   || '',
    location:      userRec.location  || '',
    isOnline:      userRec.isOnline  || false,
    accountStatus: ctrl?.accountStatus  || 'active',
    plan:          ctrl?.plan?.type     || 'normal',
    isPremium:     ctrl?.plan?.isPremium || false,
    createdAt:     userRec.createdAt || 0,
    updatedAt:     userRec.updatedAt || 0
  } }));
}

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const allowed = ['name', 'username', 'bio', 'website', 'location', 'banner'];
  const hasAny  = allowed.some(f => body[f] !== undefined);
  if (!hasAny) return jsonRes(fail('Debes enviar al menos un campo editable.', 'NO_FIELDS'), 400);

  // ── Validation ────────────────────────────────────────────────────────────
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v)          return jsonRes(fail('El nombre no puede estar vacío.', 'INVALID_NAME'), 400);
    if (v.length > 50) return jsonRes(fail('El nombre no puede superar 50 caracteres.', 'INVALID_NAME'), 400);
  }

  if (body.bio !== undefined) {
    const v = String(body.bio).trim();
    if (v.length > 300) return jsonRes(fail('La bio no puede superar 300 caracteres.', 'INVALID_BIO'), 400);
  }

  if (body.website !== undefined) {
    const v = String(body.website).trim();
    if (v && v.length > 200) return jsonRes(fail('El sitio web no puede superar 200 caracteres.', 'INVALID_WEBSITE'), 400);
  }

  if (body.location !== undefined) {
    const v = String(body.location).trim();
    if (v.length > 100) return jsonRes(fail('La ubicación no puede superar 100 caracteres.', 'INVALID_LOCATION'), 400);
  }

  if (body.banner !== undefined) {
    const v = String(body.banner).trim();
    if (v.length > 500) return jsonRes(fail('La URL del banner no puede superar 500 caracteres.', 'INVALID_BANNER'), 400);
  }

  // ── Username change ───────────────────────────────────────────────────────
  let oldUsername;
  if (body.username !== undefined) {
    const newUsername = String(body.username).trim().toLowerCase();
    if (!newUsername) return jsonRes(fail('El username no puede estar vacío.', 'INVALID_USERNAME'), 400);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername))
      return jsonRes(fail('El username solo puede contener letras, números y _ (3–20 caracteres).', 'INVALID_USERNAME'), 400);

    // Fetch current user to get old username
    let current;
    try { current = await fbGet(`users/${user.uid}`, tok, db); }
    catch (e) { return jsonRes(fail('Error leyendo usuario.', 'DB_ERROR'), 503); }

    oldUsername = current?.username?.toLowerCase();

    if (newUsername !== oldUsername) {
      let taken;
      try { taken = await fbGet(`usernames/${newUsername}`, tok, db); }
      catch (e) { return jsonRes(fail('Error verificando disponibilidad.', 'DB_ERROR'), 503); }

      if (taken && taken !== user.uid)
        return jsonRes(fail('Este username ya está en uso.', 'USERNAME_EXISTS'), 409);
    }
    body.username = newUsername;
  }

  // ── Build updates ─────────────────────────────────────────────────────────
  const now = Date.now();
  const updates = { [`users/${user.uid}/updatedAt`]: now };

  if (body.name     !== undefined) updates[`users/${user.uid}/name`]     = String(body.name).trim().slice(0, 50);
  if (body.username !== undefined) updates[`users/${user.uid}/username`] = body.username;
  if (body.bio      !== undefined) updates[`users/${user.uid}/bio`]      = String(body.bio).trim().slice(0, 300);
  if (body.website  !== undefined) updates[`users/${user.uid}/website`]  = String(body.website).trim().slice(0, 200);
  if (body.location !== undefined) updates[`users/${user.uid}/location`] = String(body.location).trim().slice(0, 100);
  if (body.banner   !== undefined) updates[`users/${user.uid}/banner`]   = String(body.banner).trim().slice(0, 500);

  // Sync username index atomically
  if (body.username !== undefined && oldUsername !== body.username) {
    updates[`usernames/${body.username}`] = user.uid;
    if (oldUsername) updates[`usernames/${oldUsername}`] = null;
  }

  try { await fbUpdate(updates, tok, db); }
  catch (e) {
    console.error('[PATCH profile]', e.message);
    return jsonRes(fail('Error actualizando perfil: ' + e.message, 'DB_WRITE_ERROR'), 503);
  }

  // Return fresh user record
  const updated = await fbGet(`users/${user.uid}`, tok, db).catch(() => null);
  return jsonRes(ok({
    user: {
      uid:      user.uid,
      username: updated?.username  || body.username  || '',
      name:     updated?.name      || body.name      || '',
      email:    updated?.email     || '',
      bio:      updated?.bio       || '',
      avatar:   updated?.avatar    || '',
      banner:   updated?.banner    || '',
      website:  updated?.website   || '',
      location: updated?.location  || '',
      updatedAt: now
    }
  }, 'Perfil actualizado correctamente.'));
}
