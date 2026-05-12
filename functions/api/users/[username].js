/**
 * GET /api/users/:username
 *
 * Perfil público de un usuario. No requiere autenticación.
 * Solo devuelve campos públicos; nunca expone email, uid, tokens ni datos internos.
 */
import { fbGet }              from '../../_lib/firebase.js';
import { jsonRes, ok, fail }  from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { tok, db } = context.data;
  const rawUsername = (context.params.username || '').trim().toLowerCase();

  if (!rawUsername)
    return jsonRes(fail('El parámetro username es requerido.', 'MISSING_PARAM'), 400);
  if (!/^[a-zA-Z0-9_]{1,20}$/.test(rawUsername))
    return jsonRes(fail('Username inválido.', 'INVALID_USERNAME'), 400);

  // Resolve uid from username index
  let uid;
  try { uid = await fbGet(`usernames/${rawUsername}`, tok, db); }
  catch (e) {
    console.error('[GET /api/users/:username] FB read error:', e.message);
    return jsonRes(fail('Error conectando con la base de datos.', 'DB_ERROR'), 503);
  }

  if (!uid) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

  let userRec;
  try { userRec = await fbGet(`users/${uid}`, tok, db); }
  catch (e) {
    console.error('[GET /api/users/:username] FB read user error:', e.message);
    return jsonRes(fail('Error leyendo datos del usuario.', 'DB_ERROR'), 503);
  }

  if (!userRec) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

  return jsonRes(ok({ user: {
    username:  userRec.username  || rawUsername,
    name:      userRec.name      || '',
    bio:       userRec.bio       || '',
    avatar:    userRec.avatar    || '',
    banner:    userRec.banner    || '',
    website:   userRec.website   || '',
    location:  userRec.location  || '',
    createdAt: userRec.createdAt || 0
  } }));
}
