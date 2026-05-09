/**
 * GET /api/auth/google/callback
 *
 * Callback OAuth de Google. Intercambia el code, autocrea (o reusa)
 * el usuario en la Realtime Database y redirige a /home con el JWT.
 */
import { signJwt }                from '../../../_lib/crypto.js';
import { fbGet, fbUpdate }        from '../../../_lib/firebase.js';
import { syncFirebaseAuthUser }   from '../../../_lib/firebase-auth.js';
import { toEmailKey, toEmailNormal } from '../../../_lib/helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const clientId     = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  const url    = new URL(request.url);
  const origin = url.origin;
  const loginErr = (e) => Response.redirect(`${origin}/login?error=${e}`, 302);

  if (!clientId || !clientSecret) return loginErr('google_not_configured');

  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) return loginErr('google_cancelled');

  const redirectUri = env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;

  // Exchange code → tokens
  let tokenData;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code'
      })
    });
    tokenData = await r.json();
  } catch { return loginErr('google_token_exchange'); }

  if (!tokenData.access_token) return loginErr('google_no_token');

  // Fetch Google profile
  let gUser;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    gUser = await r.json();
  } catch { return loginErr('google_userinfo'); }

  if (!gUser.email) return loginErr('google_no_email');

  const emailKey    = toEmailKey(gUser.email);
  const emailNormal = toEmailNormal(gUser.email);

  // ¿Usuario existe?
  let uid;
  try { uid = await fbGet(`emails/${emailKey}`, tok, db); }
  catch { return loginErr('db_error'); }

  const now = Date.now();
  let jwtUsername, jwtEmail;

  if (!uid) {
    // Auto-registro
    uid = crypto.randomUUID().replace(/-/g, '');

    let baseUser = (gUser.email.split('@')[0] || 'user')
      .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
    let usernameKey = baseUser;
    const existing = await fbGet(`usernames/${usernameKey}`, tok, db).catch(() => null);
    if (existing) usernameKey = baseUser + Math.floor(Math.random() * 9000 + 1000);

    const name = (gUser.name || gUser.given_name || usernameKey).slice(0, 50);
    const userData = {
      name, username: usernameKey, email: emailNormal,
      avatar: gUser.picture || '', bio: '',
      isOnline: true, lastSeen: now, createdAt: now, updatedAt: now,
      googleId: gUser.id || ''
    };
    const controlData = {
      uid, accountStatus: 'active',
      suspension:   { isSuspended: false, reason: '', until: 0, createdAt: 0 },
      ban:          { isBanned: false, reason: '', createdAt: 0 },
      plan:         { type: 'normal', isPremium: false, premiumUntil: 0, startedAt: now },
      permissions:  { canLogin: true, canChat: true, canUploadAvatar: true, canChangeUsername: true, canCreateGroups: false, canSendMedia: true, canSendVoice: true, canSendStickers: true, canSendLinks: true },
      limits:       { maxGroups: 5, maxContacts: 200, maxMediaSizeMB: 10, maxMessageLength: 500, dailyMessages: 500 },
      security:     { passwordHash: '', loginAttempts: 0, lastFailedAttempt: 0, lastLogin: now, lastIp: '', deviceCount: 0, twoFactorEnabled: false, twoFactorSecret: '' },
      verification: { emailVerified: true, emailVerifiedAt: now, phoneVerified: false, phoneVerifiedAt: 0, identityVerified: false, identityVerifiedAt: 0 },
      moderation:   { warnings: 0, reports: 0, lastWarningAt: 0, lastReportAt: 0, notes: '' },
      authProviders: ['google'], createdAt: now, updatedAt: now
    };
    try {
      await fbUpdate({
        [`users/${uid}`]:               userData,
        [`controlUsers/${uid}`]:        controlData,
        [`usernames/${usernameKey}`]:   uid,
        [`emails/${emailKey}`]:         uid
      }, tok, db);
    } catch (e) {
      console.error('[GoogleCallback] fbUpdate new user:', e.message);
      return loginErr('db_write_error');
    }
    jwtUsername = usernameKey;
    jwtEmail    = emailNormal;
  } else {
    // Usuario existente
    await fbUpdate({
      [`users/${uid}/isOnline`]:                       true,
      [`users/${uid}/lastSeen`]:                       now,
      [`users/${uid}/updatedAt`]:                      now,
      [`controlUsers/${uid}/security/lastLogin`]:      now
    }, tok, db).catch(() => {});

    let existingUser = null;
    try { existingUser = await fbGet(`users/${uid}`, tok, db); } catch { /* ignore */ }

    if (!existingUser) {
      // Recuperar registro huérfano (uid en emails pero sin users/)
      const baseUser = (gUser.email.split('@')[0] || 'user')
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
      let recoveredUsername = baseUser;
      const conflict = await fbGet(`usernames/${recoveredUsername}`, tok, db).catch(() => null);
      if (conflict && conflict !== uid) recoveredUsername = baseUser + Math.floor(Math.random() * 9000 + 1000);
      const recoveredName = (gUser.name || gUser.given_name || recoveredUsername).slice(0, 50);
      existingUser = {
        name: recoveredName, username: recoveredUsername, email: emailNormal,
        avatar: gUser.picture || '', bio: '',
        isOnline: true, lastSeen: now, createdAt: now, updatedAt: now,
        googleId: gUser.id || ''
      };
      await fbUpdate({
        [`users/${uid}`]:                    existingUser,
        [`usernames/${recoveredUsername}`]:  uid
      }, tok, db).catch(e => console.error('[GoogleCallback] recover user record:', e.message));
    }

    jwtUsername = existingUser.username || '';
    jwtEmail    = existingUser.email    || emailNormal;
  }

  // Best-effort: vincular en Firebase Authentication.
  const fbAuthGoogle = await syncFirebaseAuthUser(env, {
    kind: 'google',
    uid,
    email: emailNormal,
    googleId: gUser.id || '',
    displayName: gUser.name || gUser.given_name || jwtUsername,
    photoUrl: gUser.picture || '',
    emailVerified: true
  }).catch((e) => ({ ok: false, reason: 'sync threw', detail: e.message }));
  if (!fbAuthGoogle.ok) console.warn('[GoogleCallback] Firebase Auth sync falló:', fbAuthGoogle);

  let jwtToken;
  try {
    jwtToken = await signJwt(
      { uid, username: jwtUsername, email: jwtEmail },
      env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d'
    );
  } catch (e) {
    console.error('[GoogleCallback] signJwt:', e.message);
    return loginErr('token_error');
  }

  return Response.redirect(`${origin}/home?token=${encodeURIComponent(jwtToken)}`, 302);
}
