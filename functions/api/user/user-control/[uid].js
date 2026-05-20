/**
 * GET /api/user/user-control/{uid}
 *
 * Sistema avanzado de consulta de estado y control de usuario.
 * Lee controlUsers/{uid} de Firebase y normaliza todos los campos
 * al esquema extendido — sin modificar ni eliminar datos existentes.
 *
 * Acceso:
 *   - El propio usuario puede consultar su uid.
 *   - Admin / moderador puede consultar cualquier uid.
 *
 * Normalización bidireccional:
 *   ban.isBanned | ban.enabled           → ban.enabled
 *   suspension.isSuspended | .enabled    → suspension.enabled
 *   suspension.until | suspension.expireAt → suspension.expireAt
 *   permissions.canUpload | .upload      → permissions.upload
 */
import { authenticate }      from '../../../_lib/auth.js';
import { fbGet }             from '../../../_lib/firebase.js';
import { jsonRes, fail }     from '../../../_lib/response.js';

// Estados válidos de cuenta
const VALID_STATUSES = new Set([
  'active', 'suspended', 'banned', 'restricted',
  'warning', 'disabled', 'under_review', 'verified'
]);

/**
 * Construye el registro normalizado a partir del raw de Firebase.
 * Compatible con el esquema existente (isBanned, until, canUpload…)
 * y con el esquema extendido (enabled, expireAt, upload…).
 */
function buildControlRecord(uid, ctrl) {
  const c   = ctrl || {};
  const now = Date.now();

  // ── Ban ──────────────────────────────────────────────────────────────────
  const isBanned = c.ban?.isBanned === true || c.ban?.enabled === true;
  const ban = {
    enabled: isBanned,
    reason:  c.ban?.reason || '',
    date:    c.ban?.date   || c.ban?.createdAt || 0,
    admin:   c.ban?.admin  || c.ban?.by        || ''
  };

  // ── Suspension ───────────────────────────────────────────────────────────
  const suspendRaw  = c.suspension?.isSuspended === true || c.suspension?.enabled === true;
  const expireAt    = c.suspension?.expireAt || c.suspension?.until || 0;
  const isSuspended = suspendRaw && (expireAt === 0 || expireAt > now);
  const suspension = {
    enabled:  isSuspended,
    reason:   c.suspension?.reason || '',
    expireAt,
    admin:    c.suspension?.admin  || c.suspension?.by || ''
  };

  // ── Permissions ──────────────────────────────────────────────────────────
  const p = c.permissions || {};
  const permissions = {
    upload:       p.upload   ?? p.canUpload   ?? true,
    comment:      p.comment  ?? p.canComment  ?? true,
    message:      p.message  ?? p.canMessage  ?? true,
    post:         p.post     ?? p.canPost     ?? true,
    createProject:p.createProject ?? p.canCreateProjects ?? true,
    useApi:       p.useApi   ?? p.canUseApi   ?? true
  };

  // ── Security ─────────────────────────────────────────────────────────────
  const s = c.security || {};
  const security = {
    riskLevel:           s.riskLevel           || 'low',
    antiSpam:            s.antiSpam            ?? true,
    antiHack:            s.antiHack            ?? true,
    lastLogin:           s.lastLogin           || 0,
    loginAttempts:       s.loginAttempts        || 0,
    lastFailedAttempt:   s.lastFailedAttempt    || 0,
    twoFactorEnabled:    s.twoFactorEnabled     || false,
    trustedDevices:      s.trustedDevices       || 0
  };

  // ── Plan ─────────────────────────────────────────────────────────────────
  const pl = c.plan || {};
  const plan = {
    type:         pl.type         || 'free',
    isPremium:    pl.isPremium    || false,
    premiumUntil: pl.premiumUntil || 0,
    storage:      pl.storage      || 0,
    bandwidth:    pl.bandwidth    || 0
  };

  // ── Moderation ───────────────────────────────────────────────────────────
  const m = c.moderation || {};
  const moderation = {
    warnCount:   m.warnCount   || 0,
    reportCount: m.reportCount || 0,
    lastAction:  m.lastAction  || '',
    lastActionAt:m.lastActionAt|| 0,
    notes:       m.notes       || ''
  };

  // ── Verification ─────────────────────────────────────────────────────────
  const v = c.verification || {};
  const verification = {
    emailVerified:  v.emailVerified  || false,
    phoneVerified:  v.phoneVerified  || false,
    idVerified:     v.idVerified     || false,
    verifiedAt:     v.verifiedAt     || 0
  };

  // ── Limits ───────────────────────────────────────────────────────────────
  const lm = c.limits || {};
  const limits = {
    restricted:       lm.restricted       || false,
    maxUploads:       lm.maxUploads       ?? -1,
    maxProjects:      lm.maxProjects      ?? -1,
    maxApiKeys:       lm.maxApiKeys       ?? -1,
    rateLimitOverride:lm.rateLimitOverride || null
  };

  // ── Derivar accountStatus ─────────────────────────────────────────────────
  // Tomar del registro pero corregir si ban/suspension lo requiere
  let accountStatus = c.accountStatus || 'active';
  if (!VALID_STATUSES.has(accountStatus)) accountStatus = 'active';
  if (isBanned)         accountStatus = 'banned';
  else if (isSuspended) accountStatus = 'suspended';

  // ── Flags computados ──────────────────────────────────────────────────────
  const isVerified   = verification.emailVerified || verification.idVerified;
  const isRestricted = limits.restricted === true;
  const hasWarning   = moderation.warnCount > 0;

  const computed = {
    isActive:      accountStatus === 'active',
    isBanned,
    isSuspended,
    isVerified,
    isRestricted,
    hasWarning,
    isUnderReview: accountStatus === 'under_review',
    isDisabled:    accountStatus === 'disabled',
    isPremium:     plan.isPremium,
    isAdmin:       c.role === 'admin',
    isModerator:   c.role === 'moderator' || c.role === 'admin',
    // Bloqueos automáticos
    autoBlocked:   security.loginAttempts >= 10,
    highRisk:      security.riskLevel === 'high' || security.riskLevel === 'critical'
  };

  return {
    uid,
    accountStatus,
    role:       c.role      || 'user',
    computed,
    ban,
    suspension,
    limits,
    moderation,
    permissions,
    plan,
    security,
    verification,
    createdAt:  c.createdAt || 0,
    updatedAt:  c.updatedAt || 0
  };
}

// ── GET /api/user/user-control/{uid} ────────────────────────────────────────
export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;
  const targetUid        = context.params.uid;

  if (!targetUid) {
    return jsonRes(fail('UID requerido en la URL.', 'MISSING_UID'), 400);
  }

  // ── Autenticar ────────────────────────────────────────────────────────────
  const caller = await authenticate(request, env);
  if (!caller) {
    return jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401);
  }

  const isSelf = caller.uid === targetUid;

  // ── Si no es su propio uid, verificar que es admin/moderador ──────────────
  let callerIsPrivileged = false;
  if (!isSelf) {
    let callerCtrl;
    try { callerCtrl = await fbGet(`controlUsers/${caller.uid}`, tok, db); }
    catch (e) {
      console.error('[user-control GET] callerCtrl:', e.message);
      return jsonRes(fail('Error verificando permisos.', 'DB_ERROR'), 503);
    }
    callerIsPrivileged = callerCtrl?.role === 'admin' || callerCtrl?.role === 'moderator';
    if (!callerIsPrivileged) {
      return jsonRes(fail(
        'Acceso denegado. Solo puedes consultar tu propio control de cuenta.',
        'FORBIDDEN'
      ), 403);
    }
  }

  // ── Leer controlUsers/{uid} ───────────────────────────────────────────────
  let ctrl;
  try { ctrl = await fbGet(`controlUsers/${targetUid}`, tok, db); }
  catch (e) {
    console.error('[user-control GET] fbGet:', e.message);
    return jsonRes(fail('Error leyendo datos de control.', 'DB_ERROR'), 503);
  }

  // No encontrado solo es error 404 si es un admin consultando otro usuario
  if (!ctrl && !isSelf) {
    return jsonRes(fail('Usuario no encontrado en el sistema de control.', 'NOT_FOUND'), 404);
  }

  const record = buildControlRecord(targetUid, ctrl);

  return jsonRes({ success: true, ...record });
}
