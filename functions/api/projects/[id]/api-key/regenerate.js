/**
 * POST /api/projects/:id/api-key/regenerate
 *
 * Alias de /generate para compatibilidad con clientes existentes.
 */
import { requireAuth }         from '../../../../_lib/auth.js';
import { rotateProjectApiKey } from '../../../../_lib/rotate-api-key.js';

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;
  return rotateProjectApiKey(context.params.id, user, tok, db);
}
