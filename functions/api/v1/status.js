/**
 * GET /api/v1/status
 *
 * Comportamiento:
 *   - Con User API Key   → devuelve estado de la key + uso del proyecto
 *   - Con Project API Key → devuelve estado del proyecto + plan + uso
 */
import { resolveLegacyV1Auth }              from '../../_lib/legacy-v1-auth.js';
import { v1KeyStatus, v1ProjectStatus }     from '../../_lib/v1-handlers.js';

export async function onRequestGet(context) {
  const { request } = context;
  const { tok, db } = context.data;

  const auth = await resolveLegacyV1Auth(request, tok, db);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.kind === 'userKey')   return v1KeyStatus(auth.userKd, tok, db);
  if (auth.kind === 'projectKey') return v1ProjectStatus(auth.projKd, tok, db);
}
