/**
 * POST /api/auth/guest/upgrade — convertir invitado en usuario registrado
 *
 * Authorization: Bearer <guestToken>
 * Body: { email, password, username, name? }
 *
 * Convierte el uid del invitado en un usuario real (mismo uid),
 * invalida la sesión de invitado y emite accessToken + refreshToken.
 */
import { verifyJwt, signJwt, hashPassword } from '../../../../_lib/crypto.js';
import { fbGet, fbUpdate }                  from '../../../../_lib/firebase.js';
import { toEmailKey, toEmailNormal }        from '../../../../_lib/helpers.js';
import { jsonRes, fail }                    from '../../../../_lib/response.js';

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  // ── Autenticar token de invitado ───────────────────────────────────────
  const h          = request.headers.get('Authorization') || '';
  const guestToken = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!guestToken) return jsonRes(fail('Token de invitado requerido.', 'UNAUTHORIZED'), 401);

  let guestPayload;
  try { guestPayload = await verifyJwt(guestToken, env.JWT_SECRET); }
  catch { return jsonRes(fail('Token inválido o expirado.', 'TOKEN_INVALID'), 401); }

  if (guestPayload.type !== 'guest') {
    return jsonRes(fail('Solo los invitados pueden usar este endpoint.', 'NOT_GUEST'), 400);
  }

  const guestId = guestPayload.uid;

  let session;
  try { session = await fbGet(`guestSessions/${guestId}`, tok, db); } catch {}
  if (!session) {
    return jsonRes({ success: false, code: 'SESSION_EXPIRED', message: 'La sesión expiró.' }, 401);
  }

  // ── Leer y validar body ────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('Body JSON inválido.', 'BAD_REQUEST'), 400); }

  const { email, password, username, name } = body || {};

  if (!email || !password || !username) {
    return jsonRes(fail('email, password y username son requeridos.', 'MISSING_FIELDS'), 400);
  }

  const emailNormal = toEmailNormal(email);
  const emailKey    = toEmailKey(emailNormal);
  const usernameLC  = String(username).toLowerCase().trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailNormal)) {
    return jsonRes(fail('Email inválido.', 'INVALID_EMAIL'), 400);
  }
  if (password.length < 8) {
    return jsonRes(fail('La contraseña debe tener al menos 8 caracteres.', 'WEAK_PASSWORD'), 400);
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(usernameLC)) {
    return jsonRes(fail('El username debe tener 3-20 caracteres alfanuméricos o _.', 'INVALID_USERNAME'), 400);
  }

  // ── Verificar unicidad ─────────────────────────────────────────────────
  let existingEmail, existingUsername;
  try {
    [existingEmail, existingUsername] = await Promise.all([
      fbGet(`emails/${emailKey}`, tok, db),
      fbGet(`usernames/${usernameLC}`, tok, db)
    ]);
  } catch {
    return jsonRes(fail('Error al verificar datos.', 'DB_ERROR'), 500);
  }

  if (existingEmail)    return jsonRes(fail('Este email ya está registrado.', 'EMAIL_EXISTS'), 409);
  if (existingUsername) return jsonRes(fail('Este nombre de usuario ya está en uso.', 'USERNAME_TAKEN'), 409);

  // ── Generar hash de contraseña y tokens ────────────────────────────────
  const now          = Date.now();
  const passwordHash = await hashPassword(password);
  const finalName    = (name || usernameLC).slice(0, 50);

  const REFRESH_SECRET = env.JWT_REFRESH_SECRET || (env.JWT_SECRET + '_refresh');
  const tokenPayload   = { uid: guestId, username: usernameLC, email: emailNormal };

  let accessToken, refreshToken;
  try {
    [accessToken, refreshToken] = await Promise.all([
      signJwt(tokenPayload, env.JWT_SECRET, '15m'),
      signJwt({ ...tokenPayload, type: 'refresh' }, REFRESH_SECRET, '30d')
    ]);
  } catch (e) {
    console.error('[guest/upgrade] signJwt:', e.message);
    return jsonRes(fail('Error al generar tokens.', 'TOKEN_ERROR'), 500);
  }

  const newTokenHash = await sha256hex(accessToken);

  // ── Actualizar registro en Firebase ────────────────────────────────────
  const updatedUser = {
    type: 'user',
    profile: { name: finalName, username: usernameLC, email: emailNormal, avatar: '', bio: '' },
    auth: {
      tokenHash: newTokenHash,
      provider: 'email',
      emailVerified: false,
      sessionVersion: 2,
      passwordHash
    },
    guest: null,
    permissions: {
      canUpload: true, canCreateProjects: true, canPost: true, canUseApi: true, canComment: true
    },
    status: { active: true, suspended: false, reason: '' },
    metadata: {
      createdAt: session.createdAt || now,
      updatedAt: now,
      lastSeen:  now,
      ipAddress: request.headers.get('CF-Connecting-IP') || '',
      deviceInfo: (request.headers.get('User-Agent') || '').slice(0, 200)
    }
  };

  try {
    await fbUpdate({
      [`users/${guestId}`]:          updatedUser,
      [`emails/${emailKey}`]:        guestId,
      [`usernames/${usernameLC}`]:   guestId,
      [`guestSessions/${guestId}`]:  null   // invalida la sesión de invitado
    }, tok, db);
  } catch (e) {
    console.error('[guest/upgrade] fbUpdate:', e.message);
    return jsonRes(fail('Error al actualizar cuenta.', 'DB_ERROR'), 500);
  }

  return jsonRes({
    success:      true,
    message:      '¡Cuenta creada correctamente! Bienvenido a Nubifly.',
    accessToken,
    refreshToken,
    expiresIn:    900,
    uid:          guestId,
    user: {
      uid:      guestId,
      type:     'user',
      name:     finalName,
      username: usernameLC,
      email:    emailNormal
    }
  });
}
