/**
 * GET /api/v1/key/status
 *
 * Inspecciona la User API Key actual: nombre, permisos, calls, lastUsed,
 * proyecto asociado y uso del día/mes.
 */
import { resolveLegacyV1Auth } from '../../../_lib/legacy-v1-auth.js';
import { v1KeyStatus }         from '../../../_lib/v1-handlers.js';
import { jsonRes, fail }       from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { request } = context;
  const { tok, db } = context.data;

  const auth = await resolveLegacyV1Auth(request, tok, db);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.kind !== 'userKey') {
    return jsonRes(fail('Este endpoint requiere una User API Key.', 'NOT_FOUND'), 404);
  }
  return v1KeyStatus(auth.userKd, tok, db);
}
