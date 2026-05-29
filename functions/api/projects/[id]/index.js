/**
 * GET    /api/projects/:id  — devuelve un proyecto del usuario
 * DELETE /api/projects/:id  — elimina el proyecto y todos sus archivos
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { encodeApiKey }    from '../../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';
import { crearAvisoSistema } from '../../../_lib/notifications.js';

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

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const projectId = context.params.id;
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const allowed = ['name', 'description', 'tags', 'deadline', 'access'];
  const patch = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (patch.name !== undefined) {
    if (!patch.name || !String(patch.name).trim()) return jsonRes(fail('El nombre no puede estar vacío.', 'NAME_REQUIRED'), 400);
    if (String(patch.name).trim().length > 60)      return jsonRes(fail('El nombre no puede superar 60 caracteres.', 'NAME_TOO_LONG'), 400);
    patch.name = String(patch.name).trim();
  }
  if (patch.description !== undefined) patch.description = String(patch.description).trim();
  if (patch.tags !== undefined) {
    patch.tags = Array.isArray(patch.tags)
      ? patch.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 30)).slice(0, 10)
      : [];
  }
  if (patch.deadline !== undefined) {
    patch.deadline = typeof patch.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.deadline)
      ? patch.deadline : null;
  }
  if (patch.access !== undefined) patch.access = patch.access === 'public' ? 'public' : 'private';

  if (Object.keys(patch).length === 0) return jsonRes(fail('No hay campos válidos para actualizar.', 'NO_FIELDS'), 400);

  patch.updatedAt = Date.now();
  const updated = { ...p, ...patch };

  await fbUpdate({
    [`projects/${projectId}`]:                 updated,
    [`userProjects/${user.uid}/${projectId}`]: updated,
  }, tok, db);

  // context.waitUntil mantiene el worker vivo hasta que la notificación se guarde en Firebase
  context.waitUntil(
    crearAvisoSistema(
      user.uid, 'info',
      '¡Proyecto actualizado!',
      `Tu proyecto "${updated.name}" ha sido actualizado correctamente.`,
      0, tok, db
    ).catch(e => console.warn('[notify/proyecto_editado]', e.message))
  );

  return jsonRes(ok({ project: { id: projectId, ...updated } }, 'Proyecto actualizado correctamente.'));
}
