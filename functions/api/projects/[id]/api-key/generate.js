/**
 * POST /api/projects/:id/api-key/generate  — rota la API key del proyecto.
 */
import { requireAuth }         from '../../../../_lib/auth.js';
import { rotateProjectApiKey } from '../../../../_lib/rotate-api-key.js';

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;
  return rotateProjectApiKey(context.params.id, user, tok, db);
}
