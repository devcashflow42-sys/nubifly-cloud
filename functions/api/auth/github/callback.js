/**
 * /api/auth/github/callback.js — callback OAuth de GitHub (PostgreSQL)
 * Soporta redirect a deep link móvil (Custom Tabs) vía `state`.
 */
import { signJwt }          from '../../../_lib/crypto.js';
import { upsertOAuthUser }  from '../../../_lib/oauth-user.js';

const DEFAULT_ALLOWED = ['nubifly://'];

function getAllowedPrefixes(env, origin) {
  const fromEnv = (env.GITHUB_ALLOWED_REDIRECTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED, ...fromEnv, `${origin}/`];
}
function isRedirectAllowed(redirect, allowedPrefixes) {
  if (!redirect) return false;
  return allowedPrefixes.some(p => redirect.startsWith(p));
}
function decodeState(stateB64) {
  try {
    const b64 = stateB64.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch { return null; }
}
function buildFinalUrl(base, params) {
  const sep = base.includes('?') ? '&' : '?';
  const qs  = new URLSearchParams(params).toString();
  return `${base}${sep}${qs}`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { sql } = context.data;

  const clientId     = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  const url    = new URL(request.url);
  const origin = url.origin;

  const stateParam   = url.searchParams.get('state') || '';
  const decodedState = decodeState(stateParam);

  const allowed        = getAllowedPrefixes(env, origin);
  const requestedRedir = decodedState?.r || `${origin}/home`;
  const finalRedirect  = isRedirectAllowed(requestedRedir, allowed) ? requestedRedir : `${origin}/home`;
  const clientState    = decodedState?.c || '';

  const loginErr = (e) => {
    const params = { error: e };
    if (clientState) params.state = clientState;
    return Response.redirect(buildFinalUrl(finalRedirect, params), 302);
  };

  if (!clientId || !clientSecret) return loginErr('github_not_configured');

  const code    = url.searchParams.get('code');
  const ghError = url.searchParams.get('error');
  if (ghError || !code) return loginErr('github_cancelled');

  const redirectUri = env.GITHUB_REDIRECT_URI || `${origin}/api/auth/github/callback`;

  // Exchange code → access_token
  let ghAccessToken;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri })
    });
    const data = await r.json();
    if (data.error) return loginErr('github_token_exchange');
    ghAccessToken = data.access_token;
  } catch (e) {
    console.error('[GitHubCallback] token exchange fetch failed:', e.message);
    return loginErr('github_token_exchange');
  }
  if (!ghAccessToken) return loginErr('github_no_token');

  // Fetch GitHub profile
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

  // Obtain primary email
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

  // Find or create user
  const result = await upsertOAuthUser(sql, env, {
    email: primaryEmail,
    name:  ghUser.name || ghUser.login || '',
    photo: ghUser.avatar_url || ''
  });
  if (result.error) {
    const map = { BANNED: 'account_banned', SUSPENDED: 'account_suspended', INACTIVE: 'account_inactive' };
    return loginErr(map[result.error.code] || 'db_error');
  }
  const { uid, user, isNew } = result;

  const tokenPayload   = { uid, username: user.username, email: user.email };
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

  const successParams = { token: accessToken, refreshToken };
  if (clientState) successParams.state = clientState;
  if (isNew)       successParams.new   = '1';

  return Response.redirect(buildFinalUrl(finalRedirect, successParams), 302);
}
