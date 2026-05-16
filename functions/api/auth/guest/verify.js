/**
 * GET /api/auth/guest/verify — verificar sesión activa de invitado
 *
 * Authorization: Bearer <guestToken>
 *
 * Verifica: firma JWT, expiración, hash del token en Firebase,
 * expiración de la sesión y estado de suspensión.
 */
import { verifyJwt }       from '../../../_lib/crypto.js';
import { fbGet, fbUpdate } from '../../../_lib/firebase.js';
import { jsonRes, fail }   from '../../../_lib/response.js';

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const h     = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return jsonRes(fail('Token requerido.', 'UNAUTHORIZED'), 401);

  // ── Verificar JWT ──────────────────────────────────────────────────────
  let payload;
  try { payload = await verifyJwt(token, env.JWT_SECRET); }
  catch { return jsonRes(fail('Token inválido o expirado.', 'TOKEN_INVALID'), 401); }

  if (payload.type !== 'guest') {
    return jsonRes(fail('No es una sesión de invitado.', 'NOT_GUEST'), 400);
  }

  const uid = payload.uid;
  const now = Date.now();

  // ── Cargar sesión y usuario ────────────────────────────────────────────
  let session, user;
  try {
    [session, user] = await Promise.all([
      fbGet(`guestSessions/${uid}`, tok, db),
      fbGet(`users/${uid}`, tok, db)
    ]);
  } catch {
    return jsonRes(fail('Error al verificar sesión.', 'DB_ERROR'), 500);
  }

  if (!session) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  const tokenHash = await sha256hex(token);
  if (session.tokenHash !== tokenHash) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  if (session.expiresAt < now) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  if (user?.status?.suspended) {
    return jsonRes({ success: false, code: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' }, 403);
  }

  // Actualizar lastSeen
  fbUpdate({ [`users/${uid}/metadata/lastSeen`]: now }, tok, db).catch(() => {});

  return jsonRes({
    success:    true,
    valid:      true,
    guestId:    uid,
    expiresAt:  session.expiresAt,
    user: {
      uid,
      type:               'guest',
      name:               'Invitado',
      isGuest:            true,
      permissions:        user?.permissions || {},
      upgradeAvailable:   user?.guest?.upgradeAvailable ?? true
    }
  });
}
