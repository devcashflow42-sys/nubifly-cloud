/**
 * functions/_lib/rotate-api-key.js
 *
 * Lógica compartida para rotar (regenerar) la API key de un proyecto.
 * Se reutiliza desde:
 *   POST /api/projects/:id/api-key/generate
 *   POST /api/projects/:id/api-key/regenerate   (alias del anterior)
 */
import { fbGet, fbUpdate }        from './firebase.js';
import { encodeApiKey, generateApiKey } from './helpers.js';
import { jsonRes, ok, fail }      from './response.js';

export async function rotateProjectApiKey(projectId, user, tok, db) {
  const p = await fbGet(`projects/${projectId}`, tok, db);
  if (!p) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (p.ownerId !== user.uid) return jsonRes(fail('Acceso denegado.', 'FORBIDDEN'), 403);

  const newKey = generateApiKey();
  const now = Date.now();
  const updates = {
    [`projects/${projectId}/apiKey`]:                    newKey,
    [`projects/${projectId}/updatedAt`]:                 now,
    [`userProjects/${user.uid}/${projectId}/apiKey`]:    newKey,
    [`userProjects/${user.uid}/${projectId}/updatedAt`]: now,
    [`apiKeyIndex/${encodeApiKey(newKey)}`]:             { projectId, ownerId: user.uid }
  };
  if (p.apiKey) updates[`apiKeyIndex/${encodeApiKey(p.apiKey)}`] = null;

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({ apiKey: newKey, updatedAt: now }));
}
