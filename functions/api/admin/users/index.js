/**
 * GET /api/admin/users — lista todos los usuarios (solo admin)
 *
 * Query params:
 *   ?search=texto              filtra por nombre, username o email
 *   ?status=active|banned|suspended|online
 *   ?limit=30                  max 100, default 30
 *   ?cursor=UID                paginación por cursor
 */
import { authenticate }               from '../../../_lib/auth.js';
import { fbGet }                      from '../../../_lib/firebase.js';
import { jsonRes, ok, fail }          from '../../../_lib/response.js';

// ── Helper: verificar que el caller es admin ──────────────────────────────────
async function requireAdmin(request, env, tok, db) {
  const user = await authenticate(request, env);
  if (!user) return { error: jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401) };

  let ctrl;
  try { ctrl = await fbGet(`controlUsers/${user.uid}`, tok, db); }
  catch (e) { return { error: jsonRes(fail('Error verificando permisos.', 'DB_ERROR'), 503) }; }

  if (!ctrl || ctrl.role !== 'admin')
    return { error: jsonRes(fail('Acceso denegado. Se requiere rol admin.', 'FORBIDDEN'), 403) };

  return { adminUser: user, adminCtrl: ctrl };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  const { adminUser, error } = await requireAdmin(request, env, tok, db);
  if (error) return error;

  // ── Query params ──────────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const status = (url.searchParams.get('status') || '').trim().toLowerCase();
  const cursor = (url.searchParams.get('cursor') || '').trim();
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10)));

  // ── Load data from Firebase ───────────────────────────────────────────────
  let allUsers, allCtrl;
  try {
    [allUsers, allCtrl] = await Promise.all([
      fbGet('users', tok, db),
      fbGet('controlUsers', tok, db)
    ]);
  } catch (e) {
    console.error('[admin/users GET]', e.message);
    return jsonRes(fail('Error leyendo usuarios: ' + e.message, 'DB_ERROR'), 503);
  }

  if (!allUsers) return jsonRes(ok({ users: [], total: 0, nextCursor: null, hasMore: false }));

  // ── Enrich and normalize ──────────────────────────────────────────────────
  let users = Object.entries(allUsers).map(([uid, u]) => {
    const c = allCtrl?.[uid] || {};
    return {
      uid,
      name:          u.name          || '',
      username:      u.username      || '',
      email:         u.email         || '',
      avatar:        u.avatar        || '',
      bio:           u.bio           || '',
      isOnline:      u.isOnline      || false,
      lastSeen:      u.lastSeen      || 0,
      createdAt:     u.createdAt     || 0,
      accountStatus: c.accountStatus || 'active',
      role:          c.role          || 'user',
      plan:          c.plan?.type    || 'normal',
      isPremium:     c.plan?.isPremium || false,
      isBanned:      c.ban?.isBanned    || false,
      banReason:     c.ban?.reason      || '',
      isSuspended:   c.suspension?.isSuspended || false,
      suspendUntil:  c.suspension?.until        || 0,
      lastLogin:     c.security?.lastLogin      || 0,
      loginAttempts: c.security?.loginAttempts  || 0
    };
  });

  // ── Filters ───────────────────────────────────────────────────────────────
  if (search) {
    users = users.filter(u =>
      u.name.toLowerCase().includes(search) ||
      u.username.toLowerCase().includes(search) ||
      u.email.toLowerCase().includes(search)
    );
  }

  if (status === 'banned')    users = users.filter(u => u.isBanned);
  else if (status === 'suspended') users = users.filter(u => u.isSuspended && !u.isBanned);
  else if (status === 'active')    users = users.filter(u => u.accountStatus === 'active' && !u.isBanned && !u.isSuspended);
  else if (status === 'online')    users = users.filter(u => u.isOnline);

  // ── Sort: newest first ────────────────────────────────────────────────────
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const total = users.length;

  // ── Cursor pagination ─────────────────────────────────────────────────────
  let startIdx = 0;
  if (cursor) {
    const idx = users.findIndex(u => u.uid === cursor);
    if (idx !== -1) startIdx = idx + 1;
  }

  const page       = users.slice(startIdx, startIdx + limit);
  const hasMore    = startIdx + limit < total;
  const nextCursor = hasMore ? (page[page.length - 1]?.uid ?? null) : null;

  return jsonRes({
    success:    true,
    users:      page,
    total,
    nextCursor,
    hasMore
  });
}
