/**
 * POST /api/register   — registra un nuevo usuario
 * GET  /api/register   — info de uso
 */
import { hashPassword, signJwt } from '../_lib/crypto.js';
import { fbGet, fbUpdate }       from '../_lib/firebase.js';
import { syncFirebaseAuthUser }  from '../_lib/firebase-auth.js';
import { toEmailKey, toEmailNormal } from '../_lib/helpers.js';
import { jsonRes, fail }         from '../_lib/response.js';

export async function onRequestGet() {
  return jsonRes({
    success: true,
    endpoint: 'POST /api/register',
    campos: {
      username: 'string (3-20 chars)',
      name:     'string',
      email:    'string',
      password: 'string (min 8)'
    },
    nota: 'Envía una petición POST con estos campos en el body JSON.'
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  let body;
  try { body = await request.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { email, password, username } = body;
  const name   = (body.name || username || '').trim();
  const avatar = body.avatar || '';
  const bio    = body.bio    || '';

  if (!username || !email || !password)
    return jsonRes(fail('Campos requeridos: username, email, password.'), 400);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return jsonRes(fail('Username: solo letras, números y _ (3–20 caracteres).'), 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return jsonRes(fail('Formato de email inválido.'), 400);
  if (password.length < 8)
    return jsonRes(fail('La contraseña debe tener al menos 8 caracteres.'), 400);
  if (name.length < 2 || name.length > 50)
    return jsonRes(fail('El nombre debe tener entre 2 y 50 caracteres.'), 400);

  const emailKey    = toEmailKey(email);
  const emailNormal = toEmailNormal(email);
  const usernameKey = username.trim().toLowerCase();

  let emailExists, userExists;
  try {
    [emailExists, userExists] = await Promise.all([
      fbGet(`emails/${emailKey}`, tok, db),
      fbGet(`usernames/${usernameKey}`, tok, db)
    ]);
  } catch (err) {
    console.error('[Register] Error leyendo Firebase:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503);
  }

  if (emailExists) return jsonRes(fail('Este email ya está registrado.', 'EMAIL_EXISTS'), 409);
  if (userExists)  return jsonRes(fail('Este username ya está en uso.', 'USERNAME_EXISTS'), 409);

  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    console.error('[Register] Error hasheando contraseña:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'HASH_ERROR'), 500);
  }

  const uid = crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();

  const userData = {
    name, username: usernameKey, email: emailNormal, avatar, bio,
    isOnline: true, lastSeen: now, createdAt: now, updatedAt: now
  };
  const controlData = {
    uid, accountStatus: 'active',
    suspension:  { isSuspended: false, reason: '', until: 0, createdAt: 0 },
    ban:         { isBanned: false, reason: '', createdAt: 0 },
    plan:        { type: 'normal', isPremium: false, premiumUntil: 0, startedAt: now },
    permissions: { canLogin: true, canChat: true, canUploadAvatar: true, canChangeUsername: true, canCreateGroups: false, canSendMedia: true, canSendVoice: true, canSendStickers: true, canSendLinks: true },
    limits:      { maxGroups: 5, maxContacts: 200, maxMediaSizeMB: 10, maxMessageLength: 500, dailyMessages: 500 },
    security:    { passwordHash, loginAttempts: 0, lastFailedAttempt: 0, lastLogin: 0, lastIp: '', deviceCount: 0, twoFactorEnabled: false, twoFactorSecret: '' },
    verification:{ emailVerified: false, emailVerifiedAt: 0, phoneVerified: false, phoneVerifiedAt: 0, identityVerified: false, identityVerifiedAt: 0 },
    moderation:  { warnings: 0, reports: 0, lastWarningAt: 0, lastReportAt: 0, notes: '' },
    createdAt: now, updatedAt: now
  };

  // Activar plan pendiente si el email ya pagó como invitado
  const pending = await fbGet(`pendingUpgrades/${emailKey}`, tok, db).catch(() => null);
  if (pending && pending.planData && pending.limits) {
    controlData.plan   = pending.planData;
    controlData.limits = { ...controlData.limits, ...pending.limits };
  }

  try {
    const updates = {
      [`users/${uid}`]:                  userData,
      [`controlUsers/${uid}`]:           controlData,
      [`usernames/${usernameKey}`]:      uid,
      [`emails/${emailKey}`]:            uid
    };
    if (pending) updates[`pendingUpgrades/${emailKey}`] = null;
    await fbUpdate(updates, tok, db);
  } catch (err) {
    console.error('[Register] Error escribiendo Firebase:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_WRITE_ERROR'), 503);
  }

  // Best-effort: crear también el usuario en Firebase Authentication.
  const fbAuthRegister = await syncFirebaseAuthUser(env, {
    kind: 'password',
    uid,
    email: emailNormal,
    password,
    displayName: name,
    photoUrl: avatar,
    emailVerified: false
  }).catch((e) => ({ ok: false, reason: 'sync threw', detail: e.message }));

  let jwtToken;
  try {
    jwtToken = await signJwt({ uid, username: usernameKey, email: emailNormal }, env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d');
  } catch (err) {
    console.error('[Register] Error generando JWT:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'TOKEN_ERROR'), 500);
  }

  return jsonRes({
    success: true,
    message: '✅ Usuario registrado correctamente.',
    token: jwtToken,
    uid,
    user: userData,
    firebaseAuth: fbAuthRegister
  }, 201);
}
