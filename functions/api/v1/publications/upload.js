/**
 * POST /api/v1/publications/upload
 *
 * Crea una publicación a partir de un archivo. Auth: Authorization: Bearer.
 * Acepta User API Key o Project API Key.
 *
 * Body: multipart/form-data
 *   - file        (requerido)
 *   - title       (opcional, default = filename)
 *   - description (opcional)
 *   - projectId   (opcional si la key ya tiene proyecto asociado)
 */
import { resolveBearerApiKeyAccess } from '../../../_lib/auth.js';
import { v1PublicationUpload }        from '../../../_lib/v1-handlers.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const resolved = await resolveBearerApiKeyAccess(request, tok, db);
  if (resolved.errorResponse) return resolved.errorResponse;

  return v1PublicationUpload(request, resolved.access, tok, db, env);
}
