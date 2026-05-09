/**
 * POST /api/v1/projects/:projectId/files/upload
 *
 * Sube un archivo a un proyecto específico. Auth: Authorization: Bearer.
 * Acepta tanto User API Key como Project API Key.
 *
 * Body: multipart/form-data con campo "file"
 */
import { resolveBearerApiKeyAccess } from '../../../../../_lib/auth.js';
import { v1ProjectUpload }            from '../../../../../_lib/v1-handlers.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const projectId = context.params.projectId;
  const resolved  = await resolveBearerApiKeyAccess(request, tok, db);
  if (resolved.errorResponse) return resolved.errorResponse;

  return v1ProjectUpload(request, projectId, resolved.access, tok, db, env);
}
