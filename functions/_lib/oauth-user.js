/**
 * functions/_lib/oauth-user.js
 *
 * Busca o crea un usuario a partir de un login social (Google / GitHub) en
 * PostgreSQL. Devuelve { uid, user, isNew } o { error: {code, message, status} }.
 */
import { rowToUser, rowToControl }   from './models.js';
import { toEmailKey, toEmailNormal } from './helpers.js';
import { isAdminEmail }              from './db.js';

export async function upsertOAuthUser(sql, env, { email, name = '', photo = '' }) {
  const emailNormal = toEmailNormal(email);
  const emailKey    = toEmailKey(emailNormal);
  const now         = Date.now();

  // ── Usuario existente ──────────────────────────────────────────────────
  const existing = (await sql`select * from users where email = ${emailNormal}`)[0] || null;
  if (existing) {
    const user    = rowToUser(existing);
    const control = rowToControl((await sql`select * from control_users where uid = ${existing.uid}`)[0]);
    if (!control) return { error: { code: 'NOT_FOUND', message: 'Usuario no encontrado.', status: 404 } };

    if (control.ban?.isBanned)
      return { error: { code: 'BANNED', message: 'Tu cuenta ha sido baneada permanentemente.', status: 403, reason: control.ban.reason || '' } };
    if (control.suspension?.isSuspended) {
      const still = control.suspension.until === 0 || control.suspension.until > now;
      if (still) return { error: { code: 'SUSPENDED', message: 'Tu cuenta está suspendida.', status: 403 } };
      sql`update control_users set account_status='active', susp_is_suspended=false where uid=${existing.uid}`.catch(() => {});
    }
    if (control.accountStatus !== 'active')
      return { error: { code: 'INACTIVE', message: 'Tu cuenta no está activa.', status: 403 } };

    const role = isAdminEmail(env, emailNormal) ? 'admin' : control.role;
    sql`update control_users set last_login=${now}, login_attempts=0, role=${role} where uid=${existing.uid}`.catch(() => {});
    sql`update users set is_online=true, last_seen=${now}, updated_at=${now} where uid=${existing.uid}`.catch(() => {});
    if (photo && !user.avatar) sql`update users set avatar=${photo} where uid=${existing.uid}`.catch(() => {});

    return { uid: existing.uid, user: { ...user, avatar: user.avatar || photo }, isNew: false };
  }

  // ── Usuario nuevo ──────────────────────────────────────────────────────
  const uid = crypto.randomUUID().replace(/-/g, '');
  let base = emailNormal.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 18).toLowerCase();
  if (base.length < 3) base = 'user' + base;
  let usernameKey = base, attempt = 0;
  while (attempt < 8) {
    const taken = (await sql`select 1 from users where username = ${usernameKey}`)[0];
    if (!taken) break;
    usernameKey = base.slice(0, 14) + '_' + Math.floor(1000 + Math.random() * 9000);
    attempt++;
  }
  const displayName = (name || '').trim() || usernameKey;
  const role        = isAdminEmail(env, emailNormal) ? 'admin' : 'user';
  const permissions = { canLogin: true, canUpload: true, canCreateProjects: true, canPost: true, canUseApi: true, canComment: true };
  const verification = { emailVerified: true, emailVerifiedAt: now, phoneVerified: false, identityVerified: false };
  const moderation   = { warnings: 0, reports: 0, notes: '' };

  try {
    await sql.begin(async (tx) => {
      await tx`insert into users (uid, type, name, username, email, avatar, is_online, last_seen, created_at, updated_at)
               values (${uid}, 'user', ${displayName}, ${usernameKey}, ${emailNormal}, ${photo}, true, ${now}, ${now}, ${now})`;
      await tx`insert into control_users
                 (uid, account_status, role, plan_type, is_premium, max_api_keys, monthly_requests, max_file_size_mb,
                  permissions, verification, moderation, created_at, updated_at)
               values
                 (${uid}, 'active', ${role}, 'gratis', false, 2, 1000, 50,
                  ${tx.json(permissions)}, ${tx.json(verification)}, ${tx.json(moderation)}, ${now}, ${now})`;
      await tx`insert into emails (email_key, uid) values (${emailKey}, ${uid}) on conflict (email_key) do update set uid=${uid}`;
      await tx`insert into usernames (username, uid) values (${usernameKey}, ${uid}) on conflict (username) do update set uid=${uid}`;
    });
  } catch (e) {
    console.error('[oauth] insert:', e.message);
    return { error: { code: 'DB_WRITE_ERROR', message: 'Error guardando usuario.', status: 503 } };
  }

  return { uid, user: { uid, name: displayName, username: usernameKey, email: emailNormal, avatar: photo }, isNew: true };
}
