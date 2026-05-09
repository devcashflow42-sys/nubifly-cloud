/**
 * GET /api/user/dashboard
 *
 * Resumen rápido: # de proyectos, # de archivos y storage usado.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  // Lectura desde índices user-scoped — no requiere .indexOn en Firebase
  const [projData, filesData] = await Promise.all([
    fbGet(`userProjects/${user.uid}`, tok, db),
    fbGet(`userFiles/${user.uid}`,    tok, db)
  ]);
  const files = filesData ? Object.values(filesData) : [];
  return jsonRes(ok({
    projectCount: projData ? Object.keys(projData).length : 0,
    fileCount:    files.length,
    storageUsed:  files.reduce((s, f) => s + (f.fileSize || 0), 0)
  }));
}
