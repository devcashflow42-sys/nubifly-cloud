/**
 * POST /api/v1/request
 *
 * Action dispatcher para Project API Keys.
 * Body: { action: 'ping' | 'echo' | 'store' | 'fetch', payload: {...} }
 */
import { resolveLegacyV1Auth } from '../../_lib/legacy-v1-auth.js';
import { v1ProjectRequest }    from '../../_lib/v1-handlers.js';
import { jsonRes, fail }       from '../../_lib/response.js';

export async function onRequestPost(context) {
  const { request } = context;
  const { tok, db } = context.data;

  const auth = await resolveLegacyV1Auth(request, tok, db);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.kind !== 'projectKey') {
    return jsonRes(fail('Este endpoint requiere una Project API Key.', 'NOT_FOUND'), 404);
  }
  return v1ProjectRequest(request, auth.projKd, tok, db);
}
