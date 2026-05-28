/**
 * GET /api/user/notifications/unread
 *
 * Devuelve únicamente el conteo de notificaciones no leídas y no expiradas.
 * Endpoint ligero diseñado para el polling periódico de la app Android
 * (WorkManager), que actualiza el badge de la campanita sin descargar
 * el feed completo.
 *
 * Response: { "success": true, "data": { "count": N } }
 */
import { requireAuth }  from '../../../_lib/auth.js';
import { fbGet }        from '../../../_lib/firebase.js';
import { jsonRes, ok }  from '../../../_lib/response.js';
import { notifVigente } from '../../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const [inboxData, globalData, overridesData] = await Promise.all([
    fbGet(`userInbox/${user.uid}`, tok, db).catch(() => null),
    fbGet('notifications', tok, db).catch(() => null),
    fbGet(`userNotifications/${user.uid}`, tok, db).catch(() => null)
  ]);

  const overrides = overridesData && typeof overridesData === 'object' ? overridesData : {};
  let count = 0;

  // Inbox personal: no leídas y vigentes
  if (inboxData && typeof inboxData === 'object') {
    for (const [, n] of Object.entries(inboxData)) {
      if (n && !n.leida && notifVigente(n)) count++;
    }
  }

  // Broadcasts globales: aplica overrides de lectura y filtro de expiración
  if (globalData && typeof globalData === 'object') {
    for (const [id, n] of Object.entries(globalData)) {
      if (!n || n.active === false) continue;
      if (!notifVigente(n))         continue;
      if (overrides[id]?.dismissed) continue;
      if (!overrides[id]?.read)     count++;
    }
  }

  return jsonRes(ok({ count }));
}
