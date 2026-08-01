/**
 * GET /api/user/notifications/unread
 *
 * Devuelve únicamente el conteo de notificaciones no leídas y no expiradas.
 * Endpoint ligero diseñado para el polling periódico de la app Android.
 *
 * Response: { "success": true, "data": { "count": N } }
 */
import { requireAuth }  from '../../../_lib/auth.js';
import { jsonRes, ok }  from '../../../_lib/response.js';
import { notifVigente } from '../../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const [inboxRows, globalRows, overrideRows] = await Promise.all([
    sql`select expira, leida from user_inbox where uid = ${user.uid} and leida = false`,
    sql`select notif_id, expira from notifications where active is not false`,
    sql`select notif_id, read, dismissed from user_notifications where uid = ${user.uid}`
  ]);

  const overrides = {};
  for (const o of overrideRows) overrides[o.notif_id] = o;

  let count = 0;

  // Inbox personal: no leídas y vigentes
  for (const n of inboxRows) {
    if (notifVigente({ expira: n.expira })) count++;
  }

  // Broadcasts globales: aplica overrides de lectura y filtro de expiración
  for (const n of globalRows) {
    if (!notifVigente({ expira: n.expira })) continue;
    if (overrides[n.notif_id]?.dismissed)    continue;
    if (!overrides[n.notif_id]?.read)        count++;
  }

  return jsonRes(ok({ count }));
}
