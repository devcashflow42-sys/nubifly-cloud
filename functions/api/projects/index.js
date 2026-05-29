/**
 * GET  /api/projects   — listado de proyectos del usuario
 * POST /api/projects   — crea un proyecto (genera API key automáticamente)
 */
import { requireAuth }     from '../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../_lib/firebase.js';
import { encodeApiKey, generateApiKey } from '../../_lib/helpers.js';
import { jsonRes, ok, fail } from '../../_lib/response.js';
import { crearNotificacionLogro } from '../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  // Fast path: índice user-scoped
  let data = await fbGet(`userProjects/${user.uid}`, tok, db);

  if (!data) {
    // Migración one-time: escanear todos los proyectos, filtrar por ownerId, backfill
    const all = await fbGet('projects', tok, db);
    if (all) {
      const owned = {};
      for (const [id, p] of Object.entries(all)) {
        if (p && p.ownerId === user.uid) owned[id] = p;
      }
      if (Object.keys(owned).length > 0) {
        const backfill = {};
        for (const [id, p] of Object.entries(owned)) {
          backfill[`userProjects/${user.uid}/${id}`] = p;
        }
        await fbUpdate(backfill, tok, db).catch(() => {});
        data = owned;
      }
    }
  }

  const list = data
    ? Object.entries(data).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.createdAt - a.createdAt)
    : [];
  return jsonRes(ok({ projects: list }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body;
  try { body = await context.request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { name, description = '', tags, deadline, access } = body;
  if (!name || !name.trim())          return jsonRes(fail('El nombre del proyecto es requerido.', 'NAME_REQUIRED'), 400);
  if (name.trim().length > 60)         return jsonRes(fail('El nombre no puede superar 60 caracteres.', 'NAME_TOO_LONG'), 400);

  const safeTags = Array.isArray(tags)
    ? tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 30)).slice(0, 10)
    : [];
  const safeDeadline = typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
  const safeAccess   = access === 'public' ? 'public' : 'private';

  const pid    = crypto.randomUUID().replace(/-/g, '');
  const apiKey = generateApiKey();
  const now    = Date.now();
  const project = {
    projectId: pid, ownerId: user.uid,
    name: name.trim(), description: description.trim(),
    tags: safeTags, deadline: safeDeadline, access: safeAccess,
    apiKey, storageUsed: 0, createdAt: now, updatedAt: now
  };

  await fbUpdate({
    [`projects/${pid}`]:                         project,
    [`userProjects/${user.uid}/${pid}`]:         project,
    [`apiKeyIndex/${encodeApiKey(apiKey)}`]:     { projectId: pid, ownerId: user.uid }
  }, tok, db);

  // context.waitUntil mantiene el worker vivo hasta que la notificación se guarde en Firebase
  context.waitUntil(
    crearNotificacionLogro(user.uid, 'primer_proyecto', pid, tok, db)
      .catch(e => console.warn('[notify/primer_proyecto]', e.message))
  );

  return jsonRes(ok({ project: { id: pid, ...project } }, 'Proyecto creado correctamente.'), 201);
}
