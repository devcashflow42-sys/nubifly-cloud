/**
 * functions/_lib/legacy-v1-auth.js
 *
 * Resolver de auth para los endpoints v1 "legacy" (/v1/upload, /v1/files,
 * /v1/status, /v1/request, /v1/key/status). Acepta:
 *
 *   - Header `x-api-key: TU_API_KEY`     (preferido para compat hacia atrás)
 *   - Header `Authorization: Bearer …`   (también aceptado)
 *
 * Devuelve uno de:
 *   { errorResponse }                    — auth falló, devuelve esa Response
 *   { kind: 'userKey',    userKd }       — userKd = { uid, keyId, keyData }
 *   { kind: 'projectKey', projKd }       — projKd = { projectId, ownerId, project, control }
 */
import { validateUserApiKey }   from './auth.js';
import { fbGet }                from './firebase.js';
import { encodeApiKey }         from './helpers.js';
import { jsonRes, fail }        from './response.js';

export async function resolveLegacyV1Auth(request, tok, db) {
  const rawAuth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const apiKey  = request.headers.get('x-api-key') || rawAuth || null;
  if (!apiKey) {
    return { errorResponse: jsonRes(fail('API Key requerida. Usa Authorization: Bearer TU_API_KEY.', 'API_KEY_MISSING'), 401) };
  }

  // Try user API key first (sistema nuevo con permisos granulares)
  const userKd = await validateUserApiKey(apiKey, tok, db);
  if (userKd?.err) {
    return { errorResponse: jsonRes({ success: false, error: userKd.err, message: userKd.message || 'Acceso denegado.' }, 403) };
  }
  if (userKd) return { kind: 'userKey', userKd };

  // Fallback al sistema legacy de project keys (validación relajada).
  // Solo bloqueamos cuentas explícitamente baneadas/suspendidas/inactivas;
  // las cuentas sin controlUsers se tratan como activas.
  const projIndex = await fbGet(`apiKeyIndex/${encodeApiKey(apiKey)}`, tok, db);
  if (!projIndex) {
    return { errorResponse: jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401) };
  }

  const [projProject, projControl] = await Promise.all([
    fbGet(`projects/${projIndex.projectId}`, tok, db),
    fbGet(`controlUsers/${projIndex.ownerId}`, tok, db).catch(() => null)
  ]);
  if (!projProject) {
    return { errorResponse: jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401) };
  }
  if (projControl?.ban?.isBanned) {
    return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_BANNED'), 403) };
  }
  if (projControl?.suspension?.isSuspended) {
    const still = projControl.suspension.until === 0 || projControl.suspension.until > Date.now();
    if (still) return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_SUSPENDED'), 403) };
  }
  if (projControl && typeof projControl.accountStatus === 'string' && projControl.accountStatus !== 'active') {
    return { errorResponse: jsonRes(fail('Acceso denegado.', 'OWNER_INACTIVE'), 403) };
  }

  return {
    kind: 'projectKey',
    projKd: {
      projectId: projIndex.projectId,
      ownerId:   projIndex.ownerId,
      project:   projProject,
      control:   projControl
    }
  };
}
