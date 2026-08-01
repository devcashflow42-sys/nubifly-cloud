/**
 * POST /api/register   — registra un nuevo usuario (PostgreSQL)
 * GET  /api/register   — info de uso
 */
import { hashPassword, signJwt } from '../_lib/crypto.js';
import { toEmailKey, toEmailNormal } from '../_lib/helpers.js';
import { isAdminEmail } from '../_lib/db.js';
import { rowToUser } from '../_lib/models.js';
import { jsonRes, fail } from '../_lib/response.js';
import { getPlan } from '../_lib/stripe.js';

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
  const { sql } = context.data;

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
  if (/[/#$\[\]]/.test(email))
    return jsonRes(fail('El email contiene caracteres no permitidos.'), 400);
  if (password.length < 8)
    return jsonRes(fail('La contraseña debe tener al menos 8 caracteres.'), 400);
  if (name.length < 2 || name.length > 50)
    return jsonRes(fail('El nombre debe tener entre 2 y 50 caracteres.'), 400);

  const emailKey    = toEmailKey(email);
  const emailNormal = toEmailNormal(email);
  const usernameKey = username.trim().toLowerCase();

  // Unicidad
  let dup;
  try {
    dup = await sql`select
      exists(select 1 from users where email = ${emailNormal})    as email_taken,
      exists(select 1 from users where username = ${usernameKey}) as user_taken`;
  } catch (err) {
    console.error('[Register] Error leyendo BD:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503);
  }
  if (dup[0].email_taken) return jsonRes(fail('Este email ya está registrado.', 'EMAIL_EXISTS'), 409);
  if (dup[0].user_taken)  return jsonRes(fail('Este username ya está en uso.', 'USERNAME_EXISTS'), 409);

  let passwordHash;
  try { passwordHash = await hashPassword(password); }
  catch (err) {
    console.error('[Register] Error hasheando contraseña:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'HASH_ERROR'), 500);
  }

  const uid  = crypto.randomUUID().replace(/-/g, '');
  const now  = Date.now();
  const role = isAdminEmail(env, emailNormal) ? 'admin' : 'user';

  // Plan por defecto
  let planType = 'gratis', isPremium = false, planPurchasedAt = null, planAmount = null,
      planCurrency = null, planStripe = null;
  let maxApiKeys = 2, monthlyRequests = 1000, maxFileSizeMB = 50;

  // Activar plan pendiente si el email ya pagó como invitado
  let pending = null;
  try { pending = (await sql`select * from pending_upgrades where email_key = ${emailKey}`)[0] || null; } catch {}
  if (pending && pending.plan_data && pending.limits) {
    const pd = pending.plan_data, pl = pending.limits;
    planType = pd.type || planType; isPremium = !!pd.isPremium;
    planPurchasedAt = pd.purchasedAt || now; planAmount = pd.amountPaid ?? null;
    planCurrency = pd.currency || null; planStripe = pd.stripe || null;
    maxApiKeys = pl.maxApiKeys ?? maxApiKeys;
    monthlyRequests = pl.monthlyRequests ?? monthlyRequests;
    maxFileSizeMB = pl.maxFileSizeMB ?? maxFileSizeMB;
  }

  const permissions = { canLogin: true, canChat: true, canUploadAvatar: true, canChangeUsername: true, canCreateGroups: false, canSendMedia: true, canSendVoice: true, canSendStickers: true, canSendLinks: true };
  const verification = { emailVerified: false, phoneVerified: false, identityVerified: false };
  const moderation   = { warnings: 0, reports: 0, notes: '' };

  let userRow;
  try {
    await sql.begin(async (tx) => {
      const inserted = await tx`
        insert into users (uid, type, name, username, email, avatar, bio, is_online, last_seen, created_at, updated_at)
        values (${uid}, 'user', ${name}, ${usernameKey}, ${emailNormal}, ${avatar}, ${bio}, true, ${now}, ${now}, ${now})
        returning *`;
      userRow = inserted[0];
      await tx`
        insert into control_users
          (uid, account_status, role, plan_type, is_premium, plan_purchased_at, plan_amount_paid,
           plan_currency, plan_stripe, max_api_keys, monthly_requests, max_file_size_mb,
           password_hash, permissions, verification, moderation, created_at, updated_at)
        values
          (${uid}, 'active', ${role}, ${planType}, ${isPremium}, ${planPurchasedAt}, ${planAmount},
           ${planCurrency}, ${planStripe ? tx.json(planStripe) : null}, ${maxApiKeys}, ${monthlyRequests}, ${maxFileSizeMB},
           ${passwordHash}, ${tx.json(permissions)}, ${tx.json(verification)}, ${tx.json(moderation)}, ${now}, ${now})`;
      // Índices de compatibilidad (opcionales)
      await tx`insert into emails (email_key, uid) values (${emailKey}, ${uid}) on conflict (email_key) do update set uid = ${uid}`;
      await tx`insert into usernames (username, uid) values (${usernameKey}, ${uid}) on conflict (username) do update set uid = ${uid}`;
      if (pending) await tx`delete from pending_upgrades where email_key = ${emailKey}`;
    });
  } catch (err) {
    console.error('[Register] Error escribiendo BD:', err.message);
    return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_WRITE_ERROR'), 503);
  }

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
    user: rowToUser(userRow)
  }, 201);
}
