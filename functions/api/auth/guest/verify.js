/**
 * GET /api/auth/guest/verify — verificar sesión activa de invitado (PostgreSQL)
 * Authorization: Bearer <guestToken>
 */
import { verifyJwt }       from '../../../_lib/crypto.js';
import { rowToUser }       from '../../../_lib/models.js';
import { jsonRes, fail }   from '../../../_lib/response.js';

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { sql } = context.data;

  const h     = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return jsonRes(fail('Token requerido.', 'UNAUTHORIZED'), 401);

  let payload;
  try { payload = await verifyJwt(token, env.JWT_SECRET); }
  catch { return jsonRes(fail('Token inválido o expirado.', 'TOKEN_INVALID'), 401); }

  if (payload.type !== 'guest') {
    return jsonRes(fail('No es una sesión de invitado.', 'NOT_GUEST'), 400);
  }

  const uid = payload.uid;
  const now = Date.now();

  let session, userRow;
  try {
    session = (await sql`select token_hash, expires_at from guest_sessions where guest_id = ${uid}`)[0] || null;
    userRow = (await sql`select * from users where uid = ${uid}`)[0] || null;
  } catch {
    return jsonRes(fail('Error al verificar sesión.', 'DB_ERROR'), 500);
  }

  if (!session) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  const tokenHash = await sha256hex(token);
  if (session.token_hash !== tokenHash) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }
  if (Number(session.expires_at) < now) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  const user = rowToUser(userRow) || {};
  if (user?.status?.suspended) {
    return jsonRes({ success: false, code: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' }, 403);
  }

  sql`update users set last_seen = ${now} where uid = ${uid}`.catch(() => {});

  return jsonRes({
    success:    true,
    valid:      true,
    guestId:    uid,
    expiresAt:  Number(session.expires_at),
    user: {
      uid,
      type:             'guest',
      name:             'Invitado',
      isGuest:          true,
      permissions:      user?.permissions || {},
      upgradeAvailable: user?.guest?.upgradeAvailable ?? true
    }
  });
}
