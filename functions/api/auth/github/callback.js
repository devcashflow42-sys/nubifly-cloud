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

  // Always derive redirect_uri from the incoming request — never rely on
  // GITHUB_REDIRECT_URI env var unless explicitly overridden, to avoid
  // mismatch with what GitHub has registered.
  const redirectUri = env.GITHUB_REDIRECT_URI || `${origin}/api/auth/github/callback`;

  // ── Exchange code → access_token ──────────────────────────────────────────
  let ghAccessToken;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri })
    });
    const data = await r.json();
    if (data.error) {
      console.error('[GitHubCallback] token exchange error:', data.error, data.error_description);
      return loginErr('github_token_exchange');
    }
    ghAccessToken = data.access_token;
  } catch (e) {
    console.error('[GitHubCallback] token exchange fetch failed:', e.message);
    return loginErr('github_token_exchange');
  }

  if (!ghAccessToken) return loginErr('github_no_token');

  // ── Fetch GitHub profile ──────────────────────────────────────────────────
  let ghUser;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${ghAccessToken}`, 'User-Agent': 'Nubifly' }
    });
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    ghUser = await r.json();
  } catch (e) {
    console.error('[GitHubCallback] user fetch failed:', e.message);
    return loginErr('github_userinfo');
  }

  // ── Obtain primary email ──────────────────────────────────────────────────
  let primaryEmail = ghUser.email || null;
  if (!primaryEmail) {
    try {
      const r = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${ghAccessToken}`, 'User-Agent': 'Nubifly' }
      });
      const emails = await r.json();
      const primary = emails.find(e => e.primary && e.verified);
      primaryEmail = primary?.email || emails[0]?.email || null;
    } catch { /* ignore */ }
  }
  if (!primaryEmail) return loginErr('github_no_email');

  const emailKey    = toEmailKey(primaryEmail);
  const emailNormal = toEmailNormal(primaryEmail);

  // ── Find or create user ───────────────────────────────────────────────────
  let uid;
  try { uid = await fbGet(`emails/${emailKey}`, tok, db); }
  catch { return loginErr('db_error'); }

  const now = Date.now();
  let jwtUsername, jwtEmail;

  if (!uid) {
    // ── New user (auto-register) ──────────────────────────────────────────
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
      security:     { loginAttempts: 0, lastFailedAttempt: 0, lastLogin: now, lastIp: '', deviceCount: 0, twoFactorEnabled: false, twoFactorSecret: '' },
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
    // ── Returning user ────────────────────────────────────────────────────
    let user, control;
    try {
      [user, control] = await Promise.all([
        fbGet(`users/${uid}`, tok, db),
        fbGet(`controlUsers/${uid}`, tok, db)
      ]);
    } catch { return loginErr('db_error'); }

    // Ban / suspension check
    if (control?.ban?.isBanned)
      return loginErr('account_banned');

    if (control?.suspension?.isSuspended) {
      const still = control.suspension.until === 0 || control.suspension.until > now;
      if (still) return loginErr('account_suspended');
      // Suspension expired — lift it silently
      await fbUpdate({
        [`controlUsers/${uid}/accountStatus`]:          'active',
        [`controlUsers/${uid}/suspension/isSuspended`]: false
      }, tok, db).catch(() => {});
    }

    if (control?.accountStatus && control.accountStatus !== 'active')
      return loginErr('account_inactive');

    await fbUpdate({
      [`users/${uid}/isOnline`]:                  true,
      [`users/${uid}/lastSeen`]:                  now,
      [`users/${uid}/updatedAt`]:                 now,
      [`controlUsers/${uid}/security/lastLogin`]: now
    }, tok, db).catch(() => {});

    if (!user) {
      // Recover missing user record
      const baseUser = (ghUser.login || primaryEmail.split('@')[0] || 'user')
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
      let recoveredUsername = baseUser;
      const conflict = await fbGet(`usernames/${recoveredUsername}`, tok, db).catch(() => null);
      if (conflict && conflict !== uid) recoveredUsername = baseUser + Math.floor(Math.random() * 9000 + 1000);
      user = {
        name: (ghUser.name || ghUser.login || recoveredUsername).slice(0, 50),
        username: recoveredUsername, email: emailNormal,
        avatar: ghUser.avatar_url || '', bio: ghUser.bio || '',
        isOnline: true, lastSeen: now, createdAt: now, updatedAt: now,
        githubId: String(ghUser.id || '')
      };
      await fbUpdate({
        [`users/${uid}`]:                   user,
        [`usernames/${recoveredUsername}`]: uid
      }, tok, db).catch(e => console.error('[GitHubCallback] recover user record:', e.message));
    }

    jwtUsername = user.username || '';
    jwtEmail    = user.email    || emailNormal;
  }

  // ── Best-effort: sync with Firebase Authentication ────────────────────────
  syncFirebaseAuthUser(env, {
    kind: 'github', uid, email: emailNormal,
    githubId: String(ghUser.id || ''),
    displayName: ghUser.name || ghUser.login || jwtUsername,
    photoUrl: ghUser.avatar_url || '',
    emailVerified: true
  }).catch(() => {});

  // ── Sign accessToken (15 min) + refreshToken (30 days) ───────────────────
  const tokenPayload   = { uid, username: jwtUsername, email: jwtEmail };
  const REFRESH_SECRET = env.JWT_REFRESH_SECRET || (env.JWT_SECRET + '_refresh');

  let accessToken, refreshToken;
  try {
    [accessToken, refreshToken] = await Promise.all([
      signJwt(tokenPayload, env.JWT_SECRET, '15m'),
      signJwt({ ...tokenPayload, type: 'refresh' }, REFRESH_SECRET, '30d')
    ]);
  } catch (e) {
    console.error('[GitHubCallback] signJwt:', e.message);
    return loginErr('token_error');
  }

  // Redirect to /home with both tokens in URL (removed immediately by history.replaceState)
  return Response.redirect(
    `${origin}/home?token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`,
    302
  );
}
