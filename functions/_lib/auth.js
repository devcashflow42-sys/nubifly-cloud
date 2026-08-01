/**
 * functions/_lib/auth.js
 *
 * Helpers de autenticación: validación de JWT, API keys de proyecto
 * y API keys de usuario, más el resolver para Authorization: Bearer.
 * Datos en PostgreSQL (context.data.sql).
 */
import { verifyJwt } from './crypto.js';
import { jsonRes, fail } from './response.js';
import { rowToControl, rowToProject, rowToApiKey } from './models.js';

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
export async function validateApiKey(apiKey, sql) {
  if (!apiKey) return null;
  const idx = (await sql`select project_id, owner_id from api_key_index where api_key = ${apiKey}`)[0];
  if (!idx) return null;
  const { project_id: projectId, owner_id: ownerId } = idx;
  const [projectRow, controlRow] = await Promise.all([
    sql`select * from projects where project_id = ${projectId}`,
    sql`select * from control_users where uid = ${ownerId}`
  ]);
  const project = rowToProject(projectRow[0]);
  const control = rowToControl(controlRow[0]);
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
export async function validateUserApiKey(apiKey, sql) {
  if (!apiKey) return null;
  const idx = (await sql`select uid, key_id from user_api_key_index where api_key = ${apiKey}`)[0];
  if (!idx) return null;
  const { uid, key_id: keyId } = idx;
  const keyRow = (await sql`select * from user_api_keys where key_id = ${keyId}`)[0];
  const keyData = rowToApiKey(keyRow);
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
export async function resolveBearerApiKeyAccess(request, sql) {
  const apiKey = extractBearerApiKey(request);
  if (!apiKey) {
    return { errorResponse: jsonRes(fail('API Key requerida. Usa Authorization: Bearer TU_API_KEY.', 'API_KEY_MISSING'), 401) };
  }

  const userKd = await validateUserApiKey(apiKey, sql);
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

  // Project API key
  const idx = (await sql`select project_id, owner_id from api_key_index where api_key = ${apiKey}`)[0];
  if (!idx) return { errorResponse: jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401) };

  const { project_id: projectId, owner_id: ownerId } = idx;
  const [projectRow, controlRow] = await Promise.all([
    sql`select * from projects where project_id = ${projectId}`,
    sql`select * from control_users where uid = ${ownerId}`
  ]);
  const project = rowToProject(projectRow[0]);
  const control = rowToControl(controlRow[0]);
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
export async function requireAuth(request, env) {
  const user = await authenticate(request, env);
  if (!user) {
    return { errorResponse: jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401) };
  }
  return { user };
}
