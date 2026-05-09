/**
 * GET /api/health/firebase-auth
 *
 * Diagnóstico: verifica que el sync con Firebase Authentication esté
 * bien configurado (service account válido, OAuth2 token, Identity
 * Toolkit accesible).
 */
import { diagnoseFirebaseAuth } from '../../_lib/firebase-auth.js';
import { jsonRes } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const result = await diagnoseFirebaseAuth(context.env);
  const allOk = result.serviceAccount && result.oauth2Token && result.identityToolkit;
  return jsonRes({ success: allOk, ...result }, allOk ? 200 : 503);
}
