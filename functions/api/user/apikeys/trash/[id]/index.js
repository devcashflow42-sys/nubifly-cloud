/**
 * DELETE /api/user/apikeys/trash/:id  — borra definitivamente un elemento.
 */
import { requireAuth }     from '../../../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../../../_lib/helpers.js';
import { jsonRes, ok }     from '../../../../../_lib/response.js';

export async function onRequestDelete(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const keyId = context.params.id;
  const item  = await fbGet(`userApiKeyTrash/${user.uid}/${keyId}`, tok, db);
  const updates = { [`userApiKeyTrash/${user.uid}/${keyId}`]: null };
  if (item?.key) updates[`userApiKeyIndex/${encodeApiKey(item.key)}`] = null;

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({}, 'Eliminado definitivamente.'));
}
