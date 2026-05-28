/**
 * PATCH /api/user/notifications/read
 *
 * Marca notificaciones como leídas.
 *
 * Body (JSON):
 *   { "ids": ["id1", "id2"] }   → marca solo esas IDs
 *   {}  |  { "ids": [] }        → marca TODAS las no leídas
 *
 * Distingue automáticamente entre notificaciones del inbox personal
 * (userInbox) y broadcasts globales (userNotifications overrides).
 *
 * Response: { "success": true, "data": { "marked": N } }
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { jsonRes, ok }     from '../../../_lib/response.js';

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let body = {};
  try { body = await context.request.json(); } catch { /* body vacío = marcar todas */ }

  // ids específicas, o null = marcar todas
  const idsRequeridas = Array.isArray(body.ids) && body.ids.length > 0
    ? body.ids.filter(id => typeof id === 'string' && id.trim())
    : null;

  const now = Date.now();

  // ── Leer inbox personal (siempre necesario para diferenciar tipos) ────────
  const inboxData = await fbGet(`userInbox/${user.uid}`, tok, db).catch(() => null);
  const inboxMap  = inboxData && typeof inboxData === 'object' ? inboxData : {};
  const inboxIds  = new Set(Object.keys(inboxMap));

  // ── Si es "marcar todas", necesitamos también los IDs de los broadcasts ──
  let broadcastIds = [];
  if (!idsRequeridas) {
    const globalData = await fbGet('notifications', tok, db).catch(() => null);
    broadcastIds = globalData && typeof globalData === 'object' ? Object.keys(globalData) : [];
  }

  const objetivo = idsRequeridas ?? [...inboxIds, ...broadcastIds];

  // ── Construir multi-path update ───────────────────────────────────────────
  const updates = {};

  for (const id of objetivo) {
    if (inboxIds.has(id)) {
      if (!inboxMap[id]?.leida) {
        // Notificación personal: campo leida en el documento
        updates[`userInbox/${user.uid}/${id}/leida`]  = true;
        updates[`userInbox/${user.uid}/${id}/readAt`] = now;
      }
    } else {
      // Broadcast global: override en userNotifications
      updates[`userNotifications/${user.uid}/${id}/read`]   = true;
      updates[`userNotifications/${user.uid}/${id}/readAt`] = now;
    }
  }

  if (Object.keys(updates).length > 0) {
    await fbUpdate(updates, tok, db);
  }

  // Cada ID genera 2 entradas en updates (campo + readAt)
  const marked = Math.floor(Object.keys(updates).length / 2);
  return jsonRes(ok({ marked }));
}
