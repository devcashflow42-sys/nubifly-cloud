/**
 * functions/_lib/auth.js
 *
 * Helpers de autenticación: validación de JWT, API keys de proyecto
 * y API keys de usuario, más el resolver para Authorization: Bearer.
 */
import { verifyJwt } from './crypto.js';
import { fbGet }     from './firebase.js';
import { encodeApiKey } from './helpers.js';
import { jsonRes, fail } from './response.js';

// ─── JWT guard ──────────────────────────────────────────────
// Retorna el payload del JWT o null si no hay token / es inválido.
export async function authenticate(request, env) {
  if (!env.JWT_SECRET) return null; // middleware ya bloqueó; defensa en profundidad
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try { return await verifyJwt(token, env.JWT_SECRET); }
  catch { return null; }
}

// ─── Project API Key — usado por endpoints v1 legacy ────────
export async function validateApiKey(apiKey, tok, db) {
  if (!apiKey) return null;
  const index = await fbGet(`apiKeyIndex/${encodeApiKey(apiKey)}`, tok, db);
  if (!index) return null;
  const { projectId, ownerId } = index;
  const [project, control] = await Promise.all([
    fbGet(`projects/${projectId}`, tok, db),
    fbGet(`controlUsers/${ownerId}`, tok, db)
  ]);
  if (!project) return null;
  if (control?.ban?.isBanned) return { err: 'OWNER_BANNED' };
  if (control?.suspension?.isSuspended) {
    const still = control.suspension.until === 0 || control.suspension.until > Date.now();
    if (still) return { err: 'OWNER_SUSPENDED' };
  }
  if (control?.accountStatus !== 'active') return { err: 'OWNER_INACTIVE' };
  return { projectId, ownerId, project, control };
}

// ─── User API Key — lookup vía índice ───────────────────────
// Returns { uid, keyId, keyData } on success
//         { err, message }          on disabled key
//         null                      when key not found
export async function validateUserApiKey(apiKey, tok, db) {
  if (!apiKey) return null;
  const index = await fbGet(`userApiKeyIndex/${encodeApiKey(apiKey)}`, tok, db);
  if (!index) return null;
  const { uid, keyId } = index;
  const keyData = await fbGet(`userApiKeys/${uid}/${keyId}`, tok, db);
  if (!keyData) return null;
  if (keyData.active === false)
    return { err: 'API_KEY_DISABLED', message: 'Esta API Key está desactivada.' };
  return { uid, keyId, keyData };
}

// Extrae la API Key del header Authorization: Bearer (formato oficial v1).
export function extractBearerApiKey(request) {
  const raw = (request.headers.get('authorization') || '').trim();
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim() || null;
}

// Resuelve el contexto de acceso para un Authorization: Bearer TU_API_KEY.
// Acepta tanto user keys como project keys.
//
// Returns:
//   { errorResponse }                                    on auth failure
//   { access: { kind: 'userKey',    ownerId, apiKeyId, apiKeyName, projectId, keyData } }
//   { access: { kind: 'projectKey', ownerId, apiKeyId:'', apiKeyName, projectId, keyData, project } }
export async function resolveBearerApiKeyAccess(request, tok, db) {
  const apiKey = extractBearerApiKey(request);
  if (!apiKey) {
    return { errorResponse: jsonRes(fail('API Key requerida. Usa Authorization: Bearer TU_API_KEY.', 'API_KEY_MISSING'), 401) };
  }

  const userKd = await validateUserApiKey(apiKey, tok, db);
  if (userKd?.err) {
    return { errorResponse: jsonRes({ success: false, error: userKd.err, message: userKd.message || 'Acceso denegado.' }, 403) };
  }
  if (userKd) {
    return {
      access: {
        kind: 'userKey',
        ownerId: userKd.uid,
        apiKeyId: userKd.keyId,
        apiKeyName: userKd.keyData.name || '',
        projectId: (userKd.keyData.projectId || '').trim(),
        keyData: userKd.keyData
      }
    };
  }

  // Project API key — validador relajado (solo bloquea cuentas explícitamente
  // baneadas / suspendidas / inactivas; las cuentas legacy sin controlUsers
  // se tratan como activas).
  const index = await fbGet(`apiKeyIndex/${encodeApiKey(apiKey)}`, tok, db);
  if (!index) return { errorResponse: jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401) };

  const { projectId, ownerId } = index;
  const [project, control] = await Promise.all([
    fbGet(`projects/${projectId}`, tok, db),
    fbGet(`controlUsers/${ownerId}`, tok, db).catch(() => null)
  ]);
  if (!project) return { errorResponse: jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401) };

  if (control?.ban?.isBanned) return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_BANNED'), 403) };
  if (control?.suspension?.isSuspended) {
    const still = control.suspension.until === 0 || control.suspension.until > Date.now();
    if (still) return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_SUSPENDED'), 403) };
  }
  if (control && typeof control.accountStatus === 'string' && control.accountStatus !== 'active') {
    return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_INACTIVE'), 403) };
  }

  return {
    access: {
      kind: 'projectKey',
      ownerId,
      apiKeyId: '',
      apiKeyName: project?.name || '',
      projectId,
      keyData: { perm: 'all', permissions: { files: 'write', projects: 'write', publications: 'write' } },
      project
    }
  };
}

// Helper que combina authenticate() + retorno de respuesta 401.
// Útil para endpoints protegidos por JWT.
export async function requireAuth(request, env) {
  const user = await authenticate(request, env);
  if (!user) {
    return { errorResponse: jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401) };
  }
  return { user };
}
