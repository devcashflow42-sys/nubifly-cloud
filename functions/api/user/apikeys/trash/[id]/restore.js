/**
 * POST /api/user/apikeys/trash/:id/restore  — restaura un elemento.
 */
import { requireAuth }     from '../../../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../../../../_lib/response.js';

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const keyId = context.params.id;
  const item  = await fbGet(`userApiKeyTrash/${user.uid}/${keyId}`, tok, db);
  if (!item) return jsonRes(fail('Elemento no encontrado.'), 404);

  // Quitar campos que solo existen en la papelera
  const { deletedAt, type, ...restored } = item;
  const updates = {
    [`userApiKeyTrash/${user.uid}/${keyId}`]: null,
    [`userApiKeys/${user.uid}/${keyId}`]:     restored
  };
  // Reactivar la key en el índice de búsqueda
  if (restored.key) updates[`userApiKeyIndex/${encodeApiKey(restored.key)}`] = { uid: user.uid, keyId };

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({ key: restored }, 'Elemento restaurado.'));
}
