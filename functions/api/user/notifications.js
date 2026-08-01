/**
 * GET /api/user/notifications
 *
 * Feed combinado de notificaciones del usuario autenticado:
 *   • user_inbox        — notificaciones personales (logros, social, avisos)
 *   • notifications     — broadcasts globales del sistema
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
import { jsonRes, ok }  from '../../_lib/response.js';
import { notifVigente } from '../../_lib/notifications.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const url    = new URL(context.request.url);
  const origen = (url.searchParams.get('origen') || '').trim().toLowerCase();

  // ── Lecturas en paralelo ──────────────────────────────────────────────────
  const [inboxRows, globalRows, overrideRows] = await Promise.all([
    sql`select * from user_inbox where uid = ${user.uid}`,
    sql`select * from notifications where active is not false`,
    sql`select * from user_notifications where uid = ${user.uid}`
  ]);

  const overrides = {};
  for (const o of overrideRows) overrides[o.notif_id] = o;

  // ── Inbox personal ────────────────────────────────────────────────────────
  const inboxItems = inboxRows
    .filter(n => notifVigente({ expira: n.expira }))
    .map(n => ({
      id:        n.notif_id,
      tipo:      n.tipo       || 'aviso',
      nivel:     n.nivel      || 'info',
      origen:    n.origen     || 'sistema',
      titulo:    n.titulo     || '',
      mensaje:   n.mensaje    || '',
      accion:    n.accion     || '',
      recursoId: n.recurso_id ?? null,
      emisor:    n.emisor     || 'sistema',
      leida:     !!n.leida,
      expira:    n.expira     ?? null,
      createdAt: n.created_at || 0
    }));

  // ── Broadcasts globales ───────────────────────────────────────────────────
  const globalItems = globalRows
    .filter(n => notifVigente({ expira: n.expira }) && !overrides[n.notif_id]?.dismissed)
    .map(n => ({
      id:        n.notif_id,
      tipo:      'broadcast',
      nivel:     n.nivel    || 'info',
      origen:    'sistema',
      titulo:    n.titulo   || '',
      mensaje:   n.mensaje  || '',
      accion:    n.accion   || '',
      recursoId: null,
      emisor:    'sistema',
      leida:     !!(overrides[n.notif_id]?.read),
      expira:    n.expira   ?? null,
      createdAt: n.created_at || 0
    }));

  // ── Combinar, filtrar por origen, ordenar ─────────────────────────────────
  let todas = [...inboxItems, ...globalItems];

  if (origen === 'sistema')  todas = todas.filter(n => n.origen === 'sistema');
  else if (origen === 'usuario') todas = todas.filter(n => n.origen === 'usuario');

  todas.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const unread = todas.filter(n => !n.leida).length;
  return jsonRes(ok({ notifications: todas, count: todas.length, unread }));
}
