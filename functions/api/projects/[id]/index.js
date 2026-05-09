/**
 * GET    /api/projects/:id  — devuelve un proyecto del usuario
 * DELETE /api/projects/:id  — elimina el proyecto y todos sus archivos
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const projectId = context.params.id;
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);
  return jsonRes(ok({ project: { id: projectId, ...p } }));
}

export async function onRequestDelete(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const projectId = context.params.id;
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);

  // Leer archivos desde el índice project-scoped
  const filesData = await fbGet(`projectFiles/${projectId}`, tok, db);

  const updates = {
    [`projects/${projectId}`]:                  null,
    [`userProjects/${user.uid}/${projectId}`]:  null,
    [`projectFiles/${projectId}`]:              null,
    [`apiKeyIndex/${encodeApiKey(p.apiKey)}`]:  null
  };

  // Eliminar cada archivo del índice global y del índice user-files
  if (filesData) {
    for (const [k, f] of Object.entries(filesData)) {
      updates[`files/${k}`] = null;
      if (f && f.ownerId) updates[`userFiles/${f.ownerId}/${k}`] = null;
    }
  }

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({}, 'Proyecto eliminado correctamente.'));
}
