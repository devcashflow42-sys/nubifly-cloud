/**
 * GET /api/projects/:id/api-key  — devuelve la API key del proyecto.
 */
import { requireAuth } from '../../../../_lib/auth.js';
import { fbGet }       from '../../../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const projectId = context.params.id;
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);
  if (!p.apiKey) return jsonRes(fail('No hay API Key para este proyecto.', 'NO_API_KEY'), 404);
  return jsonRes(ok({ apiKey: p.apiKey }));
}
