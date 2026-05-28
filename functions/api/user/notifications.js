/**
 * GET /api/user/notifications
 *
 * Feed combinado de notificaciones del usuario autenticado:
 *   • userInbox/{uid}         — notificaciones personales (logros, social, avisos)
 *   • notifications/          — broadcasts globales del sistema
 *
 * Reglas de filtrado:
 *   - No devuelve notificaciones con expira ya vencido.
 *   - No devuelve broadcasts marcados como dismissed.
 *   - Ordena por createdAt descendente (más nueva primero).
 *
 * Query params opcionales:
 *   ?origen=sistema   → solo notificaciones del sistema (logros, avisos, broadcasts)
 *   ?origen=usuario   → solo notificaciones sociales (vista, like, compartido)
 */
import { requireAuth }  from '../../_lib/auth.js';
import { fbGet }        from '../../_lib/firebase.js';
import { jsonRes, ok }  from '../../_lib/response.js';
import { notifVigente } from '../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const url    = new URL(context.request.url);
  const origen = (url.searchParams.get('origen') || '').trim().toLowerCase();

  // ── Lecturas en paralelo ──────────────────────────────────────────────────
  const [inboxData, globalData, overridesData] = await Promise.all([
    fbGet(`userInbox/${user.uid}`, tok, db).catch(() => null),
    fbGet('notifications', tok, db).catch(() => null),
    fbGet(`userNotifications/${user.uid}`, tok, db).catch(() => null)
  ]);

  const overrides = overridesData && typeof overridesData === 'object' ? overridesData : {};

  // ── Inbox personal ────────────────────────────────────────────────────────
  const inboxItems = inboxData && typeof inboxData === 'object'
    ? Object.entries(inboxData)
        .filter(([, n]) => n && notifVigente(n))
        .map(([id, n]) => ({
          id,
          tipo:      n.tipo       || 'aviso',
          nivel:     n.nivel      || 'info',
          origen:    n.origen     || 'sistema',
          titulo:    n.titulo     || '',
          mensaje:   n.mensaje    || '',
          accion:    n.accion     || '',
          recursoId: n.recursoId  ?? null,
          emisor:    n.emisor     || 'sistema',
          leida:     !!n.leida,
          expira:    n.expira     ?? null,
          createdAt: n.createdAt  || 0
        }))
    : [];

  // ── Broadcasts globales ───────────────────────────────────────────────────
  const globalItems = globalData && typeof globalData === 'object'
    ? Object.entries(globalData)
        .filter(([id, n]) =>
          n &&
          n.active !== false &&
          notifVigente(n) &&
          !overrides[id]?.dismissed
        )
        .map(([id, n]) => ({
          id,
          tipo:      'broadcast',
          nivel:     n.nivel    || 'info',
          origen:    'sistema',
          titulo:    n.titulo   || '',
          mensaje:   n.mensaje  || n.body || n.message || '',
          accion:    n.accion   || '',
          recursoId: null,
          emisor:    'sistema',
          leida:     !!(overrides[id]?.read),
          expira:    n.expira   ?? null,
          createdAt: n.createdAt || 0
        }))
    : [];

  // ── Combinar, filtrar por origen, ordenar ─────────────────────────────────
  let todas = [...inboxItems, ...globalItems];

  if (origen === 'sistema')  todas = todas.filter(n => n.origen === 'sistema');
  else if (origen === 'usuario') todas = todas.filter(n => n.origen === 'usuario');

  todas.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const unread = todas.filter(n => !n.leida).length;
  return jsonRes(ok({ notifications: todas, count: todas.length, unread }));
}
