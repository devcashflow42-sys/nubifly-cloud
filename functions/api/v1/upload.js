/**
 * POST /api/v1/upload
 *
 * Legacy: acepta x-api-key o Authorization: Bearer.
 *   - User key  → handler granular (files:write requerido)
 *   - Project key → handler "compatibilidad" que reusa la lógica de Bearer
 */
import { resolveLegacyV1Auth } from '../../_lib/legacy-v1-auth.js';
import { v1Upload, v1ProjectUpload } from '../../_lib/v1-handlers.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const auth = await resolveLegacyV1Auth(request, tok, db);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.kind === 'userKey') {
    return v1Upload(request, auth.userKd, tok, db, env);
  }

  // Project key → reusa el handler Bearer con permisos elevados
  const access = {
    kind:       'projectKey',
    ownerId:    auth.projKd.ownerId,
    apiKeyId:   '',
    apiKeyName: auth.projKd.project?.name || '',
    projectId:  auth.projKd.projectId,
    keyData:    { perm: 'all', permissions: { files: 'write', projects: 'write', publications: 'write' } },
    project:    auth.projKd.project
  };
  return v1ProjectUpload(request, auth.projKd.projectId, access, tok, db, env);
}
