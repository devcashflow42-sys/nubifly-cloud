/**
 * GET /api/user/recents
 *
 * Feed unificado de recientes del usuario autenticado.
 * Combina proyectos y publicaciones ordenados por fecha descendente
 * (el más nuevo primero). Devuelve TODOS los elementos, sin límite.
 *
 * Query params opcionales:
 *   ?type=project      → solo proyectos
 *   ?type=publication  → solo publicaciones
 *   (sin type)         → ambos tipos mezclados
 *
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth }           from '../../_lib/auth.js';
import { jsonRes, ok }           from '../../_lib/response.js';
import { rowToProject, rowToFile } from '../../_lib/models.js';

/** Elige el timestamp más reciente entre updatedAt y createdAt del item */
function itemTs(item) {
  return Math.max(Number(item.updatedAt || 0), Number(item.createdAt || 0));
}

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const url       = new URL(context.request.url);
  const typeParam = (url.searchParams.get('type') || '').trim().toLowerCase();

  const wantProjects     = !typeParam || typeParam === 'project';
  const wantPublications = !typeParam || typeParam === 'publication';

  const [projectRows, fileRows] = await Promise.all([
    wantProjects
      ? sql`select * from projects where owner_id = ${user.uid}`
      : Promise.resolve([]),
    wantPublications
      ? sql`select * from files where owner_id = ${user.uid} and project_id is null`
      : Promise.resolve([]),
  ]);

  const projects     = projectRows.map(r => ({ type: 'project', ...rowToProject(r) }));
  const publications = fileRows.map(r => ({ type: 'publication', ...rowToFile(r) }));

  // Combinar y ordenar por fecha descendente (sin límite)
  const recents = [...projects, ...publications]
    .sort((a, b) => itemTs(b) - itemTs(a));

  return jsonRes(ok({ recents, count: recents.length }));
}
