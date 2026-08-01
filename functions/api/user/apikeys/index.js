/**
 * GET  /api/user/apikeys  — listado de API keys del usuario
 * POST /api/user/apikeys  — crea una nueva API key
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { buildDefaultPermissions } from '../../../_lib/permissions.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';
import { rowToApiKey }     from '../../../_lib/models.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const rows = await sql`
    select * from user_api_keys
    where uid = ${user.uid}
    order by created_at desc nulls last
  `;
  return jsonRes(ok({ keys: rows.map(rowToApiKey) }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { id, name, perm, key, created, projectId, permissions } = body;
  if (!id || !name || !key) return jsonRes(fail('Faltan campos: id, name, key.'), 400);

  const preset = perm || 'all';
  const perms  = permissions || buildDefaultPermissions(preset);
  const now    = created ? (Number.isFinite(+new Date(created)) ? +new Date(created) : Date.now()) : Date.now();

  try {
    await sql.begin(async tx => {
      await tx`
        insert into user_api_keys
          (key_id, uid, name, api_key, active, perm, permissions, project_id, calls, uploads_count, created_at)
        values
          (${id}, ${user.uid}, ${name}, ${key}, true, ${preset}, ${tx.json(perms)},
           ${projectId || null}, 0, 0, ${now})
      `;
      await tx`
        insert into user_api_key_index (api_key, uid, key_id)
        values (${key}, ${user.uid}, ${id})
        on conflict (api_key) do update set uid = ${user.uid}, key_id = ${id}
      `;
    });
  } catch (e) {
    console.error('[POST /api/user/apikeys] insert:', e.message);
    return jsonRes(fail('No se pudo crear la clave. Inténtalo de nuevo.', 'DB_ERROR'), 500);
  }

  const kd = rowToApiKey({
    key_id: id, uid: user.uid, name, api_key: key, active: true, perm: preset,
    permissions: perms, project_id: projectId || null, calls: 0, uploads_count: 0,
    created_at: now
  });

  return jsonRes(ok({ key: kd }, 'Clave creada correctamente.'), 201);
}
