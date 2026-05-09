/**
 * GET    /api/files/:projectId   — lista los archivos de un proyecto del usuario
 * DELETE /api/files/:fileId      — elimina un archivo del usuario
 *
 * Nota: el segmento [id] tiene semántica distinta según el verbo:
 *   - GET    → projectId
 *   - DELETE → fileId
 * Esto se conserva tal cual del API original.
 */
import { requireAuth }            from '../../_lib/auth.js';
import { fbGet, fbUpdate }        from '../../_lib/firebase.js';
import { jsonRes, ok, fail }      from '../../_lib/response.js';

// GET /api/files/:projectId — listar archivos del proyecto
export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const projectId = context.params.id;
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);

  // Fast path: índice project-scoped
  let data = await fbGet(`projectFiles/${projectId}`, tok, db);

  if (!data) {
    // Migración one-time
    const all = await fbGet('files', tok, db);
    if (all) {
      const projFiles = {};
      for (const [id, f] of Object.entries(all)) {
        if (f && f.projectId === projectId) projFiles[id] = f;
      }
      if (Object.keys(projFiles).length > 0) {
        const backfill = {};
        for (const [id, f] of Object.entries(projFiles)) {
          backfill[`projectFiles/${projectId}/${id}`] = f;
          backfill[`userFiles/${user.uid}/${id}`]     = f;
        }
        await fbUpdate(backfill, tok, db).catch(() => {});
        data = projFiles;
      }
    }
  }

  const toTs = f => f.createdAt ? new Date(f.createdAt).getTime() : (f.uploadedAt || 0);
  const files = data
    ? Object.entries(data).map(([id, f]) => ({ id, ...f })).sort((a, b) => toTs(b) - toTs(a))
    : [];
  return jsonRes(ok({ files }));
}

// DELETE /api/files/:fileId — eliminar archivo
export async function onRequestDelete(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const fileId = context.params.id;

  // Look up file metadata — try global index first, then user-scoped publication paths
  let file = await fbGet(`files/${fileId}`, tok, db).catch(() => null);
  if (!file) {
    file = await fbGet(`userRecentPublications/${user.uid}/${fileId}`, tok, db).catch(() => null)
        || await fbGet(`user_recent_publications/${user.uid}/${fileId}`, tok, db).catch(() => null)
        || await fbGet(`userFiles/${user.uid}/${fileId}`, tok, db).catch(() => null);
  }
  if (!file) return jsonRes(fail('Archivo no encontrado.', 'NOT_FOUND'), 404);
  const ownerId = file.ownerId || file.userId || '';
  if (ownerId && ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);

  const cur = (await fbGet(`projects/${file.projectId}/storageUsed`, tok, db)) || 0;
  const now = Date.now();
  const updates = {
    [`files/${fileId}`]:                                            null,
    [`projectFiles/${file.projectId}/${fileId}`]:                   null,
    [`userFiles/${user.uid}/${fileId}`]:                            null,
    [`recentPublications/${fileId}`]:                               null,
    [`recent_publications/${fileId}`]:                              null,
    [`userRecentPublications/${user.uid}/${fileId}`]:               null,
    [`user_recent_publications/${user.uid}/${fileId}`]:             null,
  };
  if (file.projectId) {
    const newUsed = Math.max(0, cur - (file.fileSize || 0));
    updates[`projects/${file.projectId}/storageUsed`]                   = newUsed;
    updates[`userProjects/${user.uid}/${file.projectId}/storageUsed`]   = newUsed;
    updates[`projects/${file.projectId}/updatedAt`]                     = now;
    updates[`userProjects/${user.uid}/${file.projectId}/updatedAt`]     = now;
    updates[`projectRecentPublications/${file.projectId}/${fileId}`]    = null;
    updates[`project_recent_publications/${file.projectId}/${fileId}`]  = null;
  }
  await fbUpdate(updates, tok, db);
  return jsonRes(ok({}, 'Archivo eliminado correctamente.'));
}
