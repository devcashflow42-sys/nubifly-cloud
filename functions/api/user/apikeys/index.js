/**
 * GET  /api/user/apikeys  — listado de API keys del usuario
 * POST /api/user/apikeys  — crea una nueva API key
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../_lib/helpers.js';
import { buildDefaultPermissions } from '../../../_lib/permissions.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const data = await fbGet(`userApiKeys/${user.uid}`, tok, db);
  return jsonRes(ok({ keys: data ? Object.values(data).reverse() : [] }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { id, name, perm, permLabel, key, created, projectId, permissions } = body;
  if (!id || !name || !key) return jsonRes(fail('Faltan campos: id, name, key.'), 400);

  const preset = perm || 'all';
  const kd = {
    id, name,
    perm:        preset,
    permLabel:   permLabel || 'Acceso total',
    key,
    created:     created || new Date().toISOString(),
    calls:       0,
    active:      true,
    projectId:   projectId || '',
    permissions: permissions || buildDefaultPermissions(preset)
  };

  await fbUpdate({
    [`userApiKeys/${user.uid}/${id}`]:           kd,
    [`userApiKeyIndex/${encodeApiKey(key)}`]:    { uid: user.uid, keyId: id }
  }, tok, db);

  return jsonRes(ok({ key: kd }, 'Clave creada correctamente.'), 201);
}
