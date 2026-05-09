/**
 * DELETE /api/user/apikeys/:id  — mueve una API key a la papelera.
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';

export async function onRequestDelete(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const keyId = context.params.id;
  const item = await fbGet(`userApiKeys/${user.uid}/${keyId}`, tok, db);
  if (!item) return jsonRes(fail('Clave no encontrada.'), 404);

  const trashed = {
    ...item,
    type: 'apikey',
    deletedAt: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  };
  const updates = {
    [`userApiKeys/${user.uid}/${keyId}`]:     null,
    [`userApiKeyTrash/${user.uid}/${keyId}`]: trashed
  };
  // Quitar del índice — la key deja de funcionar inmediatamente
  if (item.key) updates[`userApiKeyIndex/${encodeApiKey(item.key)}`] = null;

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({}, 'Clave movida a la papelera.'));
}
