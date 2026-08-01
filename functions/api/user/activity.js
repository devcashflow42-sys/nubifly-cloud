/**
 * GET /api/user/activity
 *
 * Lee user_api_activity escrito por los handlers v1 de upload
 * y devuelve los últimos 100 eventos ordenados desc por timestamp.
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth } from '../../_lib/auth.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const rows = await sql`
    select * from user_api_activity
    where uid = ${user.uid}
    order by ts desc nulls last
    limit 100
  `;

  const activity = rows.map(r => ({
    id:         r.event_id,
    endpoint:   r.endpoint,
    method:     r.method,
    status:     r.status,
    kind:       r.kind,
    projectId:  r.project_id,
    fileId:     r.file_id,
    fileName:   r.file_name,
    apiKeyId:   r.api_key_id,
    apiKeyName: r.api_key_name,
    source:     r.source,
    ts:         r.ts,
    createdAt:  r.created_at
  }));

  return jsonRes(ok({ activity, count: activity.length }));
}
