/**
 * GET   /api/user/profile  — perfil privado completo del usuario autenticado
 * PATCH /api/user/profile  — editar name, username, bio, website, location, banner, birthday
 */
import { requireAuth }     from '../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../_lib/response.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip leading @ and lowercase — store clean handle, display with @
 */
function normalizeUsername(raw) {
  return String(raw).trim().toLowerCase().replace(/^@+/, '');
}

/**
 * Accept: YYYY-MM-DD | DD/MM/YYYY | MM-DD-YYYY
 * Returns ISO string YYYY-MM-DD or null if invalid.
 */
function parseBirthday(input) {
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return s;
  }
  // DD/MM/YYYY (Latin America default)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, dd, mm, yyyy] = slash;
    const d = Number(dd), m = Number(mm), y = Number(yyyy);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${yyyy}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
}

/**
 * Compute age from YYYY-MM-DD string.
 */
function computeAge(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const mDiff = now.getMonth() + 1 - m;
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < d)) age--;
  return age >= 0 ? age : null;
}

function buildUserResponse(uid, rec, ctrl) {
  const birthday = rec?.birthday || '';
  return {
    uid,
    username:      rec?.username  || '',
    name:          rec?.name      || '',
    email:         rec?.email     || '',
    bio:           rec?.bio       || '',
    avatar:        rec?.avatar    || '',
    banner:        rec?.banner    || '',
    website:       rec?.website   || '',
    location:      rec?.location  || '',
    birthday,
    age:           computeAge(birthday),
    isOnline:      rec?.isOnline  || false,
    accountStatus: ctrl?.accountStatus  || 'active',
    plan:          ctrl?.plan?.type     || 'normal',
    isPremium:     ctrl?.plan?.isPremium || false,
    createdAt:     rec?.createdAt || 0,
    updatedAt:     rec?.updatedAt || 0,
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let userRec, ctrl;
  try {
    [userRec, ctrl] = await Promise.all([
      fbGet(`users/${user.uid}`, tok, db),
      fbGet(`controlUsers/${user.uid}`, tok, db),
    ]);
  } catch (e) {
    console.error('[GET profile]', e.message);
    return jsonRes(fail('Error leyendo datos de usuario.', 'DB_ERROR'), 503);
  }

  return jsonRes(ok({ user: buildUserResponse(user.uid, userRec, ctrl) }));
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const ALLOWED = ['name', 'username', 'bio', 'website', 'location', 'banner', 'birthday'];
  const hasAny  = ALLOWED.some(f => body[f] !== undefined);
  if (!hasAny) return jsonRes(fail('Debes enviar al menos un campo editable.', 'NO_FIELDS'), 400);

  // ── name ──────────────────────────────────────────────────────────────────
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v)          return jsonRes(fail('El nombre no puede estar vacío.', 'INVALID_NAME'), 400);
    if (v.length > 50) return jsonRes(fail('El nombre no puede superar 50 caracteres.', 'INVALID_NAME'), 400);
  }

  // ── bio ───────────────────────────────────────────────────────────────────
  if (body.bio !== undefined) {
    if (String(body.bio).trim().length > 300)
      return jsonRes(fail('La bio no puede superar 300 caracteres.', 'INVALID_BIO'), 400);
  }

  // ── website ───────────────────────────────────────────────────────────────
  if (body.website !== undefined) {
    if (String(body.website).trim().length > 200)
      return jsonRes(fail('El sitio web no puede superar 200 caracteres.', 'INVALID_WEBSITE'), 400);
  }

  // ── location ──────────────────────────────────────────────────────────────
  if (body.location !== undefined) {
    if (String(body.location).trim().length > 100)
      return jsonRes(fail('La ubicación no puede superar 100 caracteres.', 'INVALID_LOCATION'), 400);
  }

  // ── banner ────────────────────────────────────────────────────────────────
  if (body.banner !== undefined) {
    if (String(body.banner).trim().length > 500)
      return jsonRes(fail('La URL del banner no puede superar 500 caracteres.', 'INVALID_BANNER'), 400);
  }

  // ── birthday ──────────────────────────────────────────────────────────────
  let cleanBirthday;
  if (body.birthday !== undefined) {
    if (body.birthday === '' || body.birthday === null) {
      cleanBirthday = '';
    } else {
      cleanBirthday = parseBirthday(body.birthday);
      if (cleanBirthday === null)
        return jsonRes(fail(
          'Fecha de nacimiento inválida. Usa DD/MM/YYYY o YYYY-MM-DD.',
          'INVALID_BIRTHDAY'
        ), 400);

      // Must be in the past and realistic (age 1–120)
      const age = computeAge(cleanBirthday);
      if (age === null || age < 1 || age > 120)
        return jsonRes(fail('Fecha de nacimiento fuera de rango.', 'INVALID_BIRTHDAY'), 400);
    }
  }

  // ── username ──────────────────────────────────────────────────────────────
  let oldUsername;
  if (body.username !== undefined) {
    // Accept "@handle" — strip the @ before storing
    const newUsername = normalizeUsername(body.username);

    if (!newUsername)
      return jsonRes(fail('El username no puede estar vacío.', 'INVALID_USERNAME'), 400);

    // Rules: 3–30 chars, letters / numbers / underscores / periods
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(newUsername))
      return jsonRes(fail(
        'El username solo puede contener letras, números, _ y . (3–30 caracteres).',
        'INVALID_USERNAME'
      ), 400);

    // Cannot start or end with a period, no consecutive periods
    if (/^\.|\.$|\.\./.test(newUsername))
      return jsonRes(fail('El username no puede empezar, terminar ni tener puntos consecutivos.', 'INVALID_USERNAME'), 400);

    // Read current record to get old username
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

  // ── Build multi-path update ───────────────────────────────────────────────
  const now = Date.now();
  const updates = { [`users/${user.uid}/updatedAt`]: now };

  if (body.name     !== undefined) updates[`users/${user.uid}/name`]     = String(body.name).trim().slice(0, 50);
  if (body.username !== undefined) updates[`users/${user.uid}/username`] = body.username;
  if (body.bio      !== undefined) updates[`users/${user.uid}/bio`]      = String(body.bio).trim().slice(0, 300);
  if (body.website  !== undefined) updates[`users/${user.uid}/website`]  = String(body.website).trim().slice(0, 200);
  if (body.location !== undefined) updates[`users/${user.uid}/location`] = String(body.location).trim().slice(0, 100);
  if (body.banner   !== undefined) updates[`users/${user.uid}/banner`]   = String(body.banner).trim().slice(0, 500);
  if (cleanBirthday !== undefined) updates[`users/${user.uid}/birthday`] = cleanBirthday;

  // Sync username index — old entry deleted, new entry written atomically
  if (body.username !== undefined && oldUsername !== body.username) {
    updates[`usernames/${body.username}`] = user.uid;
    if (oldUsername) updates[`usernames/${oldUsername}`] = null;
  }

  try { await fbUpdate(updates, tok, db); }
  catch (e) {
    console.error('[PATCH profile]', e.message);
    return jsonRes(fail('Error actualizando perfil.', 'DB_WRITE_ERROR'), 503);
  }

  const updated = await fbGet(`users/${user.uid}`, tok, db).catch(() => null);
  const ctrl    = await fbGet(`controlUsers/${user.uid}`, tok, db).catch(() => null);

  return jsonRes(ok({
    user: buildUserResponse(user.uid, updated, ctrl)
  }, 'Perfil actualizado correctamente.'));
}
