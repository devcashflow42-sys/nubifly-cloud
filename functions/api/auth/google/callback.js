/**
 * GET /api/auth/google/callback
 *
 * Callback OAuth de Google. Intercambia el code, autocrea (o reusa)
 * el usuario en PostgreSQL y redirige a /home con el JWT.
 */
import { signJwt }          from '../../../_lib/crypto.js';
import { upsertOAuthUser }  from '../../../_lib/oauth-user.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { sql } = context.data;

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

  const result = await upsertOAuthUser(sql, env, {
    email: gUser.email,
    name:  gUser.name || gUser.given_name || '',
    photo: gUser.picture || ''
  });
  if (result.error) {
    const map = { BANNED: 'account_banned', SUSPENDED: 'account_suspended', INACTIVE: 'account_inactive' };
    return loginErr(map[result.error.code] || 'db_error');
  }
  const { uid, user } = result;

  let jwtToken;
  try {
    jwtToken = await signJwt(
      { uid, username: user.username, email: user.email },
      env.JWT_SECRET, env.JWT_EXPIRES_IN || '7d'
    );
  } catch (e) {
    console.error('[GoogleCallback] signJwt:', e.message);
    return loginErr('token_error');
  }

  return Response.redirect(`${origin}/home?token=${encodeURIComponent(jwtToken)}`, 302);
}
