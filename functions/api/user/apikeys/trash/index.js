/**
 * GET    /api/user/apikeys/trash  — listado de la papelera
 * DELETE /api/user/apikeys/trash  — vacía la papelera completa
 */
import { requireAuth }     from '../../../../_lib/auth.js';
import { fbGet, fbDelete } from '../../../../_lib/firebase.js';
import { jsonRes, ok }     from '../../../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const data = await fbGet(`userApiKeyTrash/${user.uid}`, tok, db);
  return jsonRes(ok({ items: data ? Object.values(data).reverse() : [] }));
}

export async function onRequestDelete(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  await fbDelete(`userApiKeyTrash/${user.uid}`, tok, db);
  return jsonRes(ok({}, 'Papelera vaciada.'));
}
