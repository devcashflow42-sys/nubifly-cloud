/**
 * POST /api/auth/guest — crear sesión temporal de invitado
 *
 * Rate limit: 10 sesiones por IP por hora.
 * La sesión dura 24 horas y genera un JWT con type:'guest'.
 * Los datos del invitado se guardan en users/{guestId} y
 * la sesión en guestSessions/{guestId} para invalidación remota.
 */
import { signJwt }              from '../../../../_lib/crypto.js';
import { fbGet, fbUpdate }      from '../../../../_lib/firebase.js';
import { jsonRes, fail }        from '../../../../_lib/response.js';

const GUEST_TTL_MS       = 24 * 60 * 60 * 1000; // 24 h
const RATE_LIMIT_WINDOW  = 60 * 60 * 1000;       // 1 h
const RATE_LIMIT_MAX     = 10;

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  // ── IP y rate-limit ────────────────────────────────────────────────────
  const ip    = request.headers.get('CF-Connecting-IP')
             || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
             || 'unknown';
  const ipKey = await sha256hex(ip);
  const rlPath = `guestRateLimit/${ipKey}`;

  let rateData = null;
  try { rateData = await fbGet(rlPath, tok, db); } catch { /* ignore */ }

  const now = Date.now();
  if (rateData) {
    const inWindow = now - rateData.windowStart < RATE_LIMIT_WINDOW;
    if (inWindow && rateData.count >= RATE_LIMIT_MAX) {
      return jsonRes(
        fail('Demasiadas sesiones de invitado. Inténtalo en 1 hora.', 'RATE_LIMITED'),
        429
      );
    }
    if (!inWindow) rateData = null;
  }

  const newCount    = rateData ? rateData.count + 1 : 1;
  const windowStart = rateData ? rateData.windowStart : now;

  // ── Crear identidad de invitado ────────────────────────────────────────
  const guestId   = 'guest_' + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = now + GUEST_TTL_MS;
  const deviceId  = request.headers.get('X-Device-Id')
                 || 'web_' + Math.random().toString(36).slice(2, 10);
  const ua        = (request.headers.get('User-Agent') || '').slice(0, 200);

  let token;
  try {
    token = await signJwt(
      { uid: guestId, type: 'guest', sessionVersion: 1 },
      env.JWT_SECRET,
      '24h'
    );
  } catch (e) {
    console.error('[guest] signJwt:', e.message);
    return jsonRes(fail('Error al generar sesión.', 'TOKEN_ERROR'), 500);
  }

  const tokenHash = await sha256hex(token);

  // ── Estructura del usuario invitado (sigue el schema definido) ─────────
  const guestUser = {
    type: 'guest',
    profile:     { name: 'Invitado', username: '', email: '', avatar: '', bio: '' },
    auth:        { tokenHash, provider: 'guest', emailVerified: false, sessionVersion: 1 },
    guest:       { isGuest: true, expiresAt, deviceId, upgradeAvailable: true },
    permissions: { canUpload: false, canCreateProjects: false, canPost: false, canUseApi: false, canComment: false },
    status:      { active: true, suspended: false, reason: '' },
    metadata:    { createdAt: now, updatedAt: now, lastSeen: now, ipAddress: ip, deviceInfo: ua }
  };

  const guestSession = {
    uid: guestId, tokenHash, createdAt: now, expiresAt,
    deviceId, ipAddress: ip, sessionVersion: 1
  };

  try {
    await fbUpdate({
      [`users/${guestId}`]:         guestUser,
      [`guestSessions/${guestId}`]: guestSession,
      [rlPath]:                     { count: newCount, windowStart }
    }, tok, db);
  } catch (e) {
    console.error('[guest] fbUpdate:', e.message);
    return jsonRes(fail('Error al guardar sesión.', 'DB_ERROR'), 500);
  }

  return jsonRes({
    success:   true,
    message:   'Sesión de invitado creada.',
    token,
    guestId,
    expiresAt,
    expiresIn: Math.floor(GUEST_TTL_MS / 1000),
    user: {
      uid:         guestId,
      type:        'guest',
      name:        'Invitado',
      isGuest:     true,
      permissions: guestUser.permissions
    }
  });
}
