/**
 * GET /api/v1/files
 *
 * Solo válido con User API Key. Requiere permiso files:read.
 * Lista los archivos del proyecto asociado a la key (o todos los del usuario
 * si la key no tiene proyecto asignado).
 */
import { resolveLegacyV1Auth } from '../../_lib/legacy-v1-auth.js';
import { v1ListFiles }         from '../../_lib/v1-handlers.js';
import { jsonRes, fail }       from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { request } = context;
  const { tok, db } = context.data;

  const auth = await resolveLegacyV1Auth(request, tok, db);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.kind !== 'userKey') {
    return jsonRes(fail('Este endpoint requiere una User API Key.', 'NOT_FOUND'), 404);
  }
  return v1ListFiles(auth.userKd, tok, db);
}
