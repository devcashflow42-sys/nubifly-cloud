/**
 * POST /api/admin/notifications/broadcast
 *
 * Crea una notificación global (broadcast) que todos los usuarios verán
 * en su próxima consulta al endpoint GET /api/user/notifications.
 *
 * Sin push: el backend solo persiste el documento. La app Android recoge
 * la notificación en su ciclo de polling (WorkManager) y crea la
 * notificación local con NotificationManager.
 *
 * Solo accesible por usuarios con rol admin (controlUsers/{uid}/role === 'admin').
 *
 * Body:
 * {
 *   "tipo":    "actualizacion" | "mantenimiento" | "alerta",
 *   "nivel":   "info" | "warning" | "error",
 *   "titulo":  "Texto del título",
 *   "mensaje": "Texto del cuerpo",
 *   "accion":  "update",          (deeplink para Android, opcional)
 *   "expira":  "2026-07-01T00:00:00Z"   (ISO 8601 o timestamp ms, opcional)
 * }
 *
 * Response 201:
 * {
 *   "success": true,
 *   "data": { "notification": { "id": "...", ... } }
 * }
 */
import { authenticate }      from '../../../_lib/auth.js';
import { fbGet, fbSet }      from '../../../_lib/firebase.js';
import { jsonRes, ok, fail } from '../../../_lib/response.js';

// ── Verificación de admin (mismo patrón que /api/admin/users) ─────────────────
async function requireAdmin(request, env, tok, db) {
  const user = await authenticate(request, env);
  if (!user) return { error: jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401) };

  let ctrl;
  try { ctrl = await fbGet(`controlUsers/${user.uid}`, tok, db); }
  catch { return { error: jsonRes(fail('Error verificando permisos.', 'DB_ERROR'), 503) }; }

  if (!ctrl || ctrl.role !== 'admin')
    return { error: jsonRes(fail('Acceso denegado. Se requiere rol admin.', 'FORBIDDEN'), 403) };

  return { adminUser: user };
}

const TIPOS_VALIDOS  = ['actualizacion', 'mantenimiento', 'alerta'];
const NIVELES_VALIDOS = ['info', 'warning', 'error'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  const { adminUser, error } = await requireAdmin(request, env, tok, db);
  if (error) return error;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.', 'BAD_REQUEST'), 400); }

  const {
    tipo    = '',
    nivel   = '',
    titulo  = '',
    mensaje = '',
    accion  = '',
    expira  = null
  } = body;

  // ── Validación de entrada ─────────────────────────────────────────────────
  if (!TIPOS_VALIDOS.includes(tipo))
    return jsonRes(fail(`"tipo" debe ser: ${TIPOS_VALIDOS.join(' | ')}.`, 'INVALID_TIPO'), 400);

  if (!NIVELES_VALIDOS.includes(nivel))
    return jsonRes(fail(`"nivel" debe ser: ${NIVELES_VALIDOS.join(' | ')}.`, 'INVALID_NIVEL'), 400);

  if (!titulo.trim())
    return jsonRes(fail('"titulo" es requerido.', 'REQUIRED_TITULO'), 400);

  if (!mensaje.trim())
    return jsonRes(fail('"mensaje" es requerido.', 'REQUIRED_MENSAJE'), 400);

  let expiraTs = null;
  if (expira !== null && expira !== undefined) {
    expiraTs = typeof expira === 'number' ? expira : Date.parse(expira);
    if (isNaN(expiraTs))
      return jsonRes(fail('"expira" debe ser una fecha ISO 8601 válida o un timestamp en ms.', 'INVALID_EXPIRA'), 400);
    if (expiraTs <= Date.now())
      return jsonRes(fail('"expira" debe ser una fecha futura.', 'EXPIRA_PAST'), 400);
  }

  // ── Crear el broadcast (1 único documento global) ─────────────────────────
  const id    = `bc_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const notif = {
    id,
    tipo,
    nivel,
    origen:    'sistema',
    titulo:    titulo.trim(),
    mensaje:   mensaje.trim(),
    accion:    accion.trim() || '',
    expira:    expiraTs,
    createdAt: Date.now(),
    createdBy: adminUser.uid,
    active:    true
  };

  await fbSet(`notifications/${id}`, notif, tok, db);

  return jsonRes(ok({ notification: notif }, 'Broadcast creado correctamente.'), 201);
}
