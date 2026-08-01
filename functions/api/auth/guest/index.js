/**
 * POST /api/auth/guest — crear sesión temporal de invitado (PostgreSQL)
 *
 * Rate limit: 10 sesiones por IP por hora.
 * La sesión dura 24 horas y genera un JWT con type:'guest'.
 */
import { signJwt }                from '../../../_lib/crypto.js';
import { jsonRes, fail }          from '../../../_lib/response.js';

const GUEST_TTL_MS       = 24 * 60 * 60 * 1000; // 24 h
const RATE_LIMIT_WINDOW  = 60 * 60 * 1000;       // 1 h
const RATE_LIMIT_MAX     = 10;

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { sql } = context.data;

  // ── IP y rate-limit ────────────────────────────────────────────────────
  const ip    = request.headers.get('CF-Connecting-IP')
             || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
             || 'unknown';
  const ipKey = await sha256hex(ip);

  let rateData = null;
  try { rateData = (await sql`select count, window_start from guest_rate_limit where ip_key = ${ipKey}`)[0] || null; }
  catch { /* ignore */ }

  const now = Date.now();
  if (rateData) {
    const inWindow = now - Number(rateData.window_start) < RATE_LIMIT_WINDOW;
    if (inWindow && rateData.count >= RATE_LIMIT_MAX) {
      return jsonRes(fail('Demasiadas sesiones de invitado. Inténtalo en 1 hora.', 'RATE_LIMITED'), 429);
    }
    if (!inWindow) rateData = null;
  }
  const newCount    = rateData ? rateData.count + 1 : 1;
  const windowStart = rateData ? Number(rateData.window_start) : now;

  // ── Crear identidad de invitado ────────────────────────────────────────
  const guestId   = 'guest_' + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = now + GUEST_TTL_MS;
  const deviceId  = request.headers.get('X-Device-Id') || 'web_' + Math.random().toString(36).slice(2, 10);
  const ua        = (request.headers.get('User-Agent') || '').slice(0, 200);

  let token;
  try {
    token = await signJwt({ uid: guestId, type: 'guest', sessionVersion: 1 }, env.JWT_SECRET, '24h');
  } catch (e) {
    console.error('[guest] signJwt:', e.message);
    return jsonRes(fail('Error al generar sesión.', 'TOKEN_ERROR'), 500);
  }

  const tokenHash = await sha256hex(token);

  const permissions = { canUpload: false, canCreateProjects: false, canPost: false, canUseApi: false, canComment: false };
  const guestData = {
    profile:     { name: 'Invitado', username: '', email: '', avatar: '', bio: '' },
    auth:        { tokenHash, provider: 'guest', emailVerified: false, sessionVersion: 1 },
    guest:       { isGuest: true, expiresAt, deviceId, upgradeAvailable: true },
    permissions,
    status:      { active: true, suspended: false, reason: '' },
    metadata:    { createdAt: now, updatedAt: now, lastSeen: now, ipAddress: ip, deviceInfo: ua }
  };

  try {
    await sql.begin(async (tx) => {
      await tx`insert into users (uid, type, name, is_online, last_seen, guest_data, created_at, updated_at)
               values (${guestId}, 'guest', 'Invitado', true, ${now}, ${tx.json(guestData)}, ${now}, ${now})`;
      await tx`insert into guest_sessions (guest_id, uid, token_hash, device_id, ip_address, session_version, created_at, expires_at)
               values (${guestId}, ${guestId}, ${tokenHash}, ${deviceId}, ${ip}, 1, ${now}, ${expiresAt})`;
      await tx`insert into guest_rate_limit (ip_key, count, window_start)
               values (${ipKey}, ${newCount}, ${windowStart})
               on conflict (ip_key) do update set count = ${newCount}, window_start = ${windowStart}`;
    });
  } catch (e) {
    console.error('[guest] insert:', e.message);
    return jsonRes(fail('Error al guardar sesión.', 'DB_ERROR'), 500);
  }

  return jsonRes({
    success:   true,
    message:   'Sesión de invitado creada.',
    token,
    guestId,
    expiresAt,
    expiresIn: Math.floor(GUEST_TTL_MS / 1000),
    user: { uid: guestId, type: 'guest', name: 'Invitado', isGuest: true, permissions }
  });
}
