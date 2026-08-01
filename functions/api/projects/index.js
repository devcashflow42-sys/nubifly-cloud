/**
 * GET  /api/projects   — listado de proyectos del usuario
 * POST /api/projects   — crea un proyecto (genera API key automáticamente)
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth }     from '../../_lib/auth.js';
import { generateApiKey }  from '../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../_lib/response.js';
import { rowToProject }    from '../../_lib/models.js';
import { crearNotificacionLogro } from '../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const rows = await sql`
    select * from projects
    where owner_id = ${user.uid}
    order by created_at desc nulls last
  `;
  return jsonRes(ok({ projects: rows.map(rowToProject) }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { name, description = '', tags, deadline, access } = body;
  if (!name || !name.trim())    return jsonRes(fail('El nombre del proyecto es requerido.', 'NAME_REQUIRED'), 400);
  if (name.trim().length > 60)  return jsonRes(fail('El nombre no puede superar 60 caracteres.', 'NAME_TOO_LONG'), 400);

  const safeTags = Array.isArray(tags)
    ? tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 30)).slice(0, 10)
    : [];
  const safeDeadline = typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
  const safeAccess   = access === 'public' ? 'public' : 'private';

  const pid    = crypto.randomUUID().replace(/-/g, '');
  const apiKey = generateApiKey();
  const now    = Date.now();

  try {
    await sql.begin(async tx => {
      await tx`
        insert into projects
          (project_id, owner_id, name, description, tags, deadline, access, api_key, storage_used, created_at, updated_at)
        values
          (${pid}, ${user.uid}, ${name.trim()}, ${description.trim()}, ${tx.json(safeTags)},
           ${safeDeadline}, ${safeAccess}, ${apiKey}, 0, ${now}, ${now})
      `;
      await tx`
        insert into api_key_index (api_key, project_id, owner_id)
        values (${apiKey}, ${pid}, ${user.uid})
        on conflict (api_key) do update set project_id = ${pid}, owner_id = ${user.uid}
      `;
    });
  } catch (e) {
    console.error('[POST /api/projects] insert:', e.message);
    return jsonRes(fail('No se pudo crear el proyecto. Inténtalo de nuevo.', 'DB_ERROR'), 500);
  }

  const project = rowToProject({
    project_id: pid, owner_id: user.uid, name: name.trim(), description: description.trim(),
    tags: safeTags, deadline: safeDeadline, access: safeAccess, api_key: apiKey,
    storage_used: 0, created_at: now, updated_at: now
  });

  // context.waitUntil mantiene el worker vivo hasta que la notificación se guarde
  context.waitUntil(
    crearNotificacionLogro(user.uid, 'primer_proyecto', pid, sql)
      .catch(e => console.warn('[notify/primer_proyecto]', e.message))
  );

  return jsonRes(ok({ project }, 'Proyecto creado correctamente.'), 201);
}
