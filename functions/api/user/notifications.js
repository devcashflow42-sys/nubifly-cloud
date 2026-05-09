/**
 * GET /api/user/notifications
 *
 * Combina:
 *   notifications/<id>             — broadcasts globales
 *   userNotifications/<uid>/<id>   — estado por usuario ({ read, dismissed })
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const [global, userOverrides] = await Promise.all([
    fbGet('notifications', tok, db).catch(() => null),
    fbGet(`userNotifications/${user.uid}`, tok, db).catch(() => null)
  ]);

  const overrides = userOverrides && typeof userOverrides === 'object' ? userOverrides : {};
  const items = global && typeof global === 'object' ? Object.entries(global) : [];

  const notifications = items
    .filter(([, n]) => n && n.active !== false)
    .map(([id, n]) => ({
      id,
      title:     n.title || '',
      body:      n.body || n.message || '',
      link:      n.link  || '',
      createdAt: n.createdAt || 0,
      read:      !!(overrides[id]?.read),
      dismissed: !!(overrides[id]?.dismissed)
    }))
    .filter(n => !n.dismissed)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 50);

  const unread = notifications.filter(n => !n.read).length;
  return jsonRes(ok({ notifications, count: notifications.length, unread }));
}
