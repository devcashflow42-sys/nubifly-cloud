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
 * (user_inbox) y broadcasts globales (user_notifications overrides).
 *
 * Response: { "success": true, "data": { "marked": N } }
 */
import { requireAuth }     from '../../../_lib/auth.js';
import { jsonRes, ok }     from '../../../_lib/response.js';

export async function onRequestPatch(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  let body = {};
  try { body = await context.request.json(); } catch { /* body vacío = marcar todas */ }

  // ids específicas, o null = marcar todas
  const idsRequeridas = Array.isArray(body.ids) && body.ids.length > 0
    ? body.ids.filter(id => typeof id === 'string' && id.trim())
    : null;

  const now = Date.now();

  // ── Conjunto de IDs del inbox personal (para diferenciar tipos) ────────────
  const inboxRows = await sql`select notif_id from user_inbox where uid = ${user.uid}`;
  const inboxIds  = new Set(inboxRows.map(r => r.notif_id));

  // ── Objetivo: IDs pedidas, o todas (inbox + broadcasts) ────────────────────
  let broadcastIds = [];
  if (!idsRequeridas) {
    const globalRows = await sql`select notif_id from notifications where active is not false`;
    broadcastIds = globalRows.map(r => r.notif_id);
  }
  const objetivo = idsRequeridas ?? [...inboxIds, ...broadcastIds];

  const inboxToMark     = objetivo.filter(id => inboxIds.has(id));
  const broadcastToMark = objetivo.filter(id => !inboxIds.has(id));

  let marked = 0;

  // ── Inbox personal ─────────────────────────────────────────────────────────
  if (inboxToMark.length > 0) {
    const res = await sql`
      update user_inbox
      set leida = true, read_at = ${now}
      where uid = ${user.uid} and leida = false and notif_id in ${sql(inboxToMark)}
    `;
    marked += res.count;
  }

  // ── Broadcasts globales (override en user_notifications) ────────────────────
  for (const id of broadcastToMark) {
    await sql`
      insert into user_notifications (uid, notif_id, read, read_at)
      values (${user.uid}, ${id}, true, ${now})
      on conflict (uid, notif_id) do update set read = true, read_at = ${now}
    `;
    marked++;
  }

  return jsonRes(ok({ marked }));
}
