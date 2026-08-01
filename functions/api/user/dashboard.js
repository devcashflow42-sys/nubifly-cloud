/**
 * GET /api/user/dashboard
 *
 * Resumen rápido: # de proyectos, # de archivos y storage usado.
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth } from '../../_lib/auth.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const [projRes, fileRows] = await Promise.all([
    sql`select count(*)::int as n from projects where owner_id = ${user.uid}`,
    sql`select file_size, project_id from files where owner_id = ${user.uid}`
  ]);

  // fileCount cuenta solo publicaciones independientes (sin projectId).
  // Los archivos subidos dentro de un proyecto se cuentan aparte en cada proyecto.
  const publications = fileRows.filter(f => !f.project_id);
  const storageUsed  = fileRows.reduce((s, f) => s + Number(f.file_size || 0), 0);

  return jsonRes(ok({
    projectCount: projRes[0].n,
    fileCount:    publications.length,
    storageUsed
  }));
}
