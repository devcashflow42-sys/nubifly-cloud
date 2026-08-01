/**
 * POST /api/user/notifications/:id/read — marca una notificación como leída.
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth } from '../../../../_lib/auth.js';
import { jsonRes, ok, fail } from '../../../../_lib/response.js';

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const notificationId = context.params.id;
  if (!notificationId) return jsonRes(fail('id requerido.', 'BAD_REQUEST'), 400);

  const now = Date.now();

  // Notificación personal del inbox → marca leida; si no existe, es broadcast → override.
  const res = await sql`
    update user_inbox set leida = true, read_at = ${now}
    where uid = ${user.uid} and notif_id = ${notificationId}
  `;
  if (res.count === 0) {
    await sql`
      insert into user_notifications (uid, notif_id, read, read_at)
      values (${user.uid}, ${notificationId}, true, ${now})
      on conflict (uid, notif_id) do update set read = true, read_at = ${now}
    `;
  }

  return jsonRes(ok({ id: notificationId, read: true }));
}
