/**
 * GET /api/auth/github/callback
 *
 * Callback OAuth de GitHub. Intercambia el code, autocrea (o reusa)
 * el usuario en la Realtime Database y redirige a /home con el JWT.
 */
import { signJwt }                from '../../../_lib/crypto.js';
import { fbGet, fbUpdate }        from '../../../_lib/firebase.js';
import { syncFirebaseAuthUser }   from '../../../_lib/firebase-auth.js';
import { toEmailKey, toEmailNormal } from '../../../_lib/helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const clientId     = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  const url    = new URL(request.url);
  const origin = url.origin;
  const loginErr = (e) => Response.redirect(`${origin}/login?error=${e}`, 302);

  if (!clientId || !clientSecret) return loginErr('github_not_configured');

  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) return loginErr('github_cancelled');

  const redirectUri = env.GITHUB_REDIRECT_URI || `${origin}/api/auth/github/callback`;

  // Exchange code → access_token
  let accessToken;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json'
      },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri
      })
    });
    const data = await r.json();
    accessToken = data.access_token;
  } catch { return loginErr('github_token_exchange'); }

  if (!accessToken) return loginErr('github_no_token');

  // Fetch GitHub profile
  let ghUser;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'User-Agent':   'Nubifly'
      }
    });
    ghUser = await r.json();
  } catch { return loginErr('github_userinfo'); }

  // Obtener email (puede ser null si el usuario lo tiene privado)
  let primaryEmail = ghUser.email || null;
  if (!primaryEmail) {
    try {
      const r = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent':  'Nubifly'
        }
      });
      const emails = await r.json();
      const primary = emails.find(e => e.primary && e.verified);
      primaryEmail = primary?.email || emails[0]?.email || null;
    } catch { /* ignorar */ }
  }

  if (!primaryEmail) return loginErr('github_no_email');

  const emailKey    = toEmailKey(primaryEmail);
  const emailNormal = toEmailNormal(primaryEmail);

  // ¿Usuario existe?
  let uid;
  try { uid = await fbGet(`emails/${emailKey}`, tok, db); }
  catch { return loginErr('db_error'); }

  const now = Date.now();
  let jwtUsername, jwtEmail;

  if (!uid) {
    // Auto-registro
    uid = crypto.randomUUID().replace(/-/g, '');

    let baseUser = (ghUser.login || primaryEmail.split('@')[0] || 'user')
      .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
    let usernameKey = baseUser;
    const existing = await fbGet(`usernames/${usernameKey}`, tok, db).catch(() => null);
    if (existing) usernameKey = baseUser + Math.floor(Math.random() * 9000 + 1000);

    const name = (ghUser.name || ghUser.login || usernameKey).slice(0, 50);
    const userData = {
      name, username: usernameKey, email: emailNormal,
      avatar: ghUser.avatar_url || '', bio: ghUser.bio || '',
      isOnline: true, lastSeen: now, createdAt: now, updatedAt: now,
      githubId: String(ghUser.id || '')
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
      authProviders: ['github'], createdAt: now, updatedAt: now
    };
    try {
      await fbUpdate({
        [`users/${uid}`]:             userData,
        [`controlUsers/${uid}`]:      controlData,
        [`usernames/${usernameKey}`]: uid,
        [`emails/${emailKey}`]:       uid
      }, tok, db);
    } catch (e) {
      console.error('[GitHubCallback] fbUpdate new user:', e.message);
      return loginErr('db_write_error');
    }
    jwtUsername = usernameKey;
    jwtEmail    = emailNormal;
  } else {
    // Usuario existente
    await fbUpdate({
      [`users/${uid}/isOnline`]:                  true,
      [`users/${uid}/lastSeen`]:                  now,
      [`users/${uid}/updatedAt`]:                 now,
      [`controlUsers/${uid}/security/lastLogin`]: now
    }, tok, db).catch(() => {});

    let existingUser = null;
    try { existingUser = await fbGet(`users/${uid}`, tok, db); } catch { /* ignore */ }

    if (!existingUser) {
      const baseUser = (ghUser.login || primaryEmail.split('@')[0] || 'user')
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
      let recoveredUsername = baseUser;
      const conflict = await fbGet(`usernames/${recoveredUsername}`, tok, db).catch(() => null);
      if (conflict && conflict !== uid) recoveredUsername = baseUser + Math.floor(Math.random() * 9000 + 1000);
      const recoveredName = (ghUser.name || ghUser.login || recoveredUsername).slice(0, 50);
      existingUser = {
        name: recoveredName, username: recoveredUsername, email: emailNormal,
        avatar: ghUser.avatar_url || '', bio: ghUser.bio || '',
        isOnline: true, lastSeen: now, createdAt: now, updatedAt: now,
        githubId: String(ghUser.id || '')
      };
      await fbUpdate({
        [`users/${uid}`]:                   existingUser,
        [`usernames/${recoveredUsername}`]: uid
      }, tok, db).catch(e => console.error('[GitHubCallback] recover user record:', e.message));
    }

    jwtUsername = existingUser.username || '';
    jwtEmail    = existingUser.email    || emailNormal;
  }

  // Best-effort: vincular en Firebase Authentication.
  const fbAuthGitHub = await syncFirebaseAuthUser(env, {
    kind:        'github',
    uid,
    email:       emailNormal,
    githubId:    String(ghUser.id || ''),
    displayName: ghUser.name || ghUser.login || jwtUsername,
    photoUrl:    ghUser.avatar_url || '',
    emailVerified: true
  }).catch((e) => ({ ok: false, reason: 'sync threw', detail: e.message }));
  if (!fbAuthGitHub.ok) console.warn('[GitHubCallback] Firebase Auth sync falló:', fbAuthGitHub);

  let jwtToken;
  try {
    jwtToken = await signJwt(
      { uid, username: jwtUsername, email: jwtEmail },
      env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d'
    );
  } catch (e) {
    console.error('[GitHubCallback] signJwt:', e.message);
    return loginErr('token_error');
  }

  return Response.redirect(`${origin}/home?token=${encodeURIComponent(jwtToken)}`, 302);
}
