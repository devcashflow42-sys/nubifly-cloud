/**
 * POST /api/user/notifications/:id/read — marca una notificación como leída.
 */
import { requireAuth } from '../../../../_lib/auth.js';
import { fbUpdate }    from '../../../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../../../_lib/response.js';

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const notificationId = context.params.id;
  if (!notificationId) return jsonRes(fail('id requerido.', 'BAD_REQUEST'), 400);

  const now = Date.now();
  await fbUpdate({
    [`userNotifications/${user.uid}/${notificationId}/read`]:   true,
    [`userNotifications/${user.uid}/${notificationId}/readAt`]: now
  }, tok, db);
  return jsonRes(ok({ id: notificationId, read: true }));
}
