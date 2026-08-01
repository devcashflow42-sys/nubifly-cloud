/**
 * GET /api/user/publications
 *
 * Devuelve las publicaciones subidas vía /api/v1/publications/upload
 * y /api/user/files.
 *
 * ── Modos ──────────────────────────────────────────────────────────────────
 *  • ?projectId=XXX  → archivos de ESE proyecto (conteo fiable, sin tope).
 *  • (sin projectId) → feed reciente del usuario (publicaciones sin proyecto, máx. 50).
 *
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth } from '../../_lib/auth.js';
import { jsonRes, ok } from '../../_lib/response.js';
import { rowToFile }   from '../../_lib/models.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const url       = new URL(context.request.url);
  const projectId = (url.searchParams.get('projectId') || '').trim();

  // ── MODO A: filtrado por proyecto ─────────────────────────────────────────
  // Filtra por dueño como defensa de seguridad: si llega un projectId ajeno,
  // no devuelve nada del usuario.
  if (projectId) {
    const rows = await sql`
      select * from files
      where owner_id = ${user.uid} and project_id = ${projectId}
      order by created_at desc nulls last
    `;
    const publications = rows.map(rowToFile);
    return jsonRes(ok({ publications, count: publications.length }));
  }

  // ── MODO B: feed reciente del usuario (publicaciones independientes) ────────
  const rows = await sql`
    select * from files
    where owner_id = ${user.uid} and project_id is null
    order by created_at desc nulls last
    limit 50
  `;
  const publications = rows.map(rowToFile);
  return jsonRes(ok({ publications, count: publications.length }));
}
