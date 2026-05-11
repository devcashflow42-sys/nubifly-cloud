/**
 * GET  /api/auth/google  — inicia el flujo OAuth (web)
 * POST /api/auth/google  — verifica un idToken de Google Sign-In (Android/iOS)
 *                          y devuelve un JWT propio de la app.
 */
import { signJwt }              from '../../../_lib/crypto.js';
import { fbGet, fbUpdate }      from '../../../_lib/firebase.js';
import { syncFirebaseAuthUser } from '../../../_lib/firebase-auth.js';
import { toEmailKey, toEmailNormal } from '../../../_lib/helpers.js';
import { jsonRes, fail }        from '../../../_lib/response.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonRes(fail('GOOGLE_CLIENT_ID no configurado.', 'CONFIG_ERROR'), 503);

  const url = new URL(request.url);
  const redirectUri = env.GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account'
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  // 1. Parse body
  let body;
  try { body = await request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { id_token } = body;
  if (!id_token) return jsonRes(fail('El campo id_token es requerido.', 'MISSING_TOKEN'), 400);

  // 2. Verify Google ID token via tokeninfo
  let tokenInfo;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[GoogleAuth] tokeninfo error:', res.status, errText);
      return jsonRes(fail('Token de Google inválido o expirado.', 'INVALID_TOKEN'), 401);
    }
    tokenInfo = await res.json();
  } catch (e) {
    console.error('[GoogleAuth] tokeninfo network error:', e.message);
    return jsonRes(fail('Error verificando token con Google.', 'GOOGLE_VERIFY_ERROR'), 503);
  }

  // Validate audience matches our client ID (if configured)
  const clientId = env.GOOGLE_CLIENT_ID;
  if (clientId && tokenInfo.aud !== clientId && tokenInfo.azp !== clientId) {
    return jsonRes(fail('Token no pertenece a esta aplicación.', 'WRONG_AUDIENCE'), 401);
  }

  const { sub: googleId, email, name = '', picture: photo = '', email_verified } = tokenInfo;
  if (!email || !googleId) return jsonRes(fail('Token no contiene email o sub.', 'INVALID_TOKEN'), 401);
  if (email_verified !== 'true' && email_verified !== true)
    return jsonRes(fail('El email de Google no está verificado.', 'EMAIL_NOT_VERIFIED'), 401);

  const emailKey    = toEmailKey(email);
  const emailNormal = toEmailNormal(email);

  // 3. Check if user already exists
  let existingUid;
  try {
    existingUid = await fbGet(`emails/${emailKey}`, tok, db);
  } catch (e) {
    console.error('[GoogleAuth] Firebase read error:', e.message);
    return jsonRes(fail('Error conectando con la base de datos.', 'DB_ERROR'), 503);
  }

  const now = Date.now();
  let uid, user, isNew;

  if (existingUid) {
    // ── Returning user ──────────────────────────────────────────────────────
    uid = existingUid;
    let control;
    try {
      [user, control] = await Promise.all([
        fbGet(`users/${uid}`, tok, db),
        fbGet(`controlUsers/${uid}`, tok, db)
      ]);
    } catch (e) {
      return jsonRes(fail('Error leyendo datos de usuario.', 'DB_ERROR'), 503);
    }
    if (!user || !control) return jsonRes(fail('Usuario no encontrado.', 'NOT_FOUND'), 404);

    if (control.ban?.isBanned)
      return jsonRes(fail('Tu cuenta ha sido baneada permanentemente.', 'BANNED', { reason: control.ban.reason || '' }), 403);

    if (control.suspension?.isSuspended) {
      const still = control.suspension.until === 0 || control.suspension.until > now;
      if (still) return jsonRes(fail('Tu cuenta está suspendida.', 'SUSPENDED', {
        reason: control.suspension.reason || '',
        until:  control.suspension.until === 0 ? 'indefinido' : new Date(control.suspension.until).toISOString()
      }), 403);
      await fbUpdate({
        [`controlUsers/${uid}/accountStatus`]:          'active',
        [`controlUsers/${uid}/suspension/isSuspended`]: false
      }, tok, db).catch(() => {});
    }

    if (control.accountStatus !== 'active')
      return jsonRes(fail('Tu cuenta no está activa.', 'INACTIVE'), 403);

    // Update last login & online status
    await fbUpdate({
      [`controlUsers/${uid}/security/lastLogin`]: now,
      [`controlUsers/${uid}/security/loginAttempts`]: 0,
      [`users/${uid}/isOnline`]:  true,
      [`users/${uid}/lastSeen`]:  now,
      [`users/${uid}/updatedAt`]: now,
      // Keep photo in sync if user hasn't set a custom one
      ...(photo && !user.avatar ? { [`users/${uid}/avatar`]: photo } : {})
    }, tok, db).catch(() => {});

    isNew = false;
  } else {
    // ── New user ────────────────────────────────────────────────────────────
    uid = crypto.randomUUID().replace(/-/g, '');

    // Generate a username from the email local part
    let baseUsername = emailNormal.split('@')[0]
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 18)
      .toLowerCase();
    if (baseUsername.length < 3) baseUsername = 'user' + baseUsername;

    // Ensure uniqueness
    let usernameKey = baseUsername;
    let attempt = 0;
    while (attempt < 8) {
      const taken = await fbGet(`usernames/${usernameKey}`, tok, db).catch(() => null);
      if (!taken) break;
      usernameKey = baseUsername.slice(0, 14) + '_' + Math.floor(1000 + Math.random() * 9000);
      attempt++;
    }

    const displayName = name.trim() || usernameKey;

    const userData = {
      name: displayName,
      username: usernameKey,
      email: emailNormal,
      avatar: photo,
      bio: '',
      isOnline: true,
      lastSeen: now,
      createdAt: now,
      updatedAt: now
    };
    const controlData = {
      uid, accountStatus: 'active',
      suspension:  { isSuspended: false, reason: '', until: 0, createdAt: 0 },
      ban:         { isBanned: false, reason: '', createdAt: 0 },
      plan:        { type: 'normal', isPremium: false, premiumUntil: 0, startedAt: now },
      permissions: { canLogin: true, canChat: true, canUploadAvatar: true, canChangeUsername: true, canCreateGroups: false, canSendMedia: true, canSendVoice: true, canSendStickers: true, canSendLinks: true },
      limits:      { maxGroups: 5, maxContacts: 200, maxMediaSizeMB: 10, maxMessageLength: 500, dailyMessages: 500 },
      security:    { loginAttempts: 0, lastFailedAttempt: 0, lastLogin: now, lastIp: '', deviceCount: 0, twoFactorEnabled: false, twoFactorSecret: '' },
      verification:{ emailVerified: true, emailVerifiedAt: now, phoneVerified: false, phoneVerifiedAt: 0, identityVerified: false, identityVerifiedAt: 0 },
      moderation:  { warnings: 0, reports: 0, lastWarningAt: 0, lastReportAt: 0, notes: '' },
      createdAt: now, updatedAt: now
    };

    try {
      await fbUpdate({
        [`users/${uid}`]:             userData,
        [`controlUsers/${uid}`]:      controlData,
        [`usernames/${usernameKey}`]: uid,
        [`emails/${emailKey}`]:       uid
      }, tok, db);
    } catch (e) {
      console.error('[GoogleAuth] Firebase write error:', e.message);
      return jsonRes(fail('Error guardando usuario: ' + e.message, 'DB_WRITE_ERROR'), 503);
    }

    user  = userData;
    isNew = true;
  }

  // 4. Best-effort sync with Firebase Authentication
  syncFirebaseAuthUser(env, {
    kind: 'google',
    uid,
    email: emailNormal,
    googleId,
    displayName: user.name || user.username || '',
    photoUrl: user.avatar || photo,
    emailVerified: true
  }).catch(() => {});

  // 5. Sign JWT
  let token;
  try {
    token = await signJwt({ uid, username: user.username, email: emailNormal }, env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d');
  } catch (e) {
    return jsonRes(fail('Error generando sesión: ' + e.message, 'TOKEN_ERROR'), 500);
  }

  return jsonRes({
    success: true,
    message: isNew ? '✅ Cuenta creada con Google.' : '✅ Inicio de sesión con Google exitoso.',
    token,
    uid,
    isNew,
    user: {
      uid,
      email: emailNormal,
      name:  user.name,
      username: user.username,
      photo: user.avatar || photo
    }
  }, isNew ? 201 : 200);
}
