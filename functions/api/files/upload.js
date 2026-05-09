/**
 * POST /api/files/upload
 *
 * Sube un archivo a un proyecto. Acepta dos formas de auth:
 *
 *   1. x-api-key  — User API Key con permiso files:write (clientes externos)
 *   2. JWT        — sesión de usuario (Authorization: Bearer <jwt>)
 *
 * IMPORTANTE: solo lee x-api-key, NO Authorization, para reservar ese header
 * al JWT de la app. Si no hay x-api-key, cae al flujo JWT.
 *
 * Body: multipart/form-data
 *   - file        (requerido)
 *   - projectId   (requerido)
 *   - folder      (opcional)
 *   - visibility  (opcional, "public" | "private", default private)
 */
import { authenticate, validateUserApiKey } from '../../_lib/auth.js';
import { requirePermission }                from '../../_lib/permissions.js';
import { uploadFileForUser }                from '../../_lib/upload-file.js';
import { jsonRes, fail }                    from '../../_lib/response.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  // ── Vía 1: x-api-key (User API Key) ───────────────────────
  const apiKey = request.headers.get('x-api-key') || null;
  if (apiKey) {
    const kd = await validateUserApiKey(apiKey, tok, db);
    if (!kd)
      return jsonRes(fail('API Key inválida.', 'API_KEY_INVALID'), 401);
    if (kd.err)
      return jsonRes({ success: false, error: kd.err, message: kd.message || 'Acceso denegado.' }, 403);
    if (!requirePermission(kd.keyData, 'files', 'write'))
      return jsonRes({ success: false, error: 'PERMISSION_DENIED',
        message: 'Tu API Key no tiene permisos para subir archivos (files:write requerido).' }, 403);

    return uploadFileForUser(request, { uid: kd.uid }, env, tok, db);
  }

  // ── Vía 2: JWT ────────────────────────────────────────────
  const user = await authenticate(request, env);
  if (!user) return jsonRes(fail('Token de acceso requerido.', 'UNAUTHORIZED'), 401);

  return uploadFileForUser(request, user, env, tok, db);
}
