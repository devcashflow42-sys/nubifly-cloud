/**
 * functions/_lib/firebase-auth.js
 *
 * Sincronización con Firebase Authentication (Identity Toolkit).
 *
 * Las cuentas de Nubifly se almacenan principalmente en la Realtime Database
 * (controlUsers/), pero hacemos un best-effort sync con Firebase Authentication
 * para que aparezcan en la consola → Authentication → Users.
 * Los fallos NUNCA bloquean el flujo principal.
 */
import { getFirebaseToken } from './firebase.js';

// Sincroniza un usuario con Firebase Authentication.
//
// kind === 'password' → primero intenta signUp con la contraseña en claro,
//                       si la cuenta ya existe cae a update.
// kind === 'google'   → vincula el provider google.com.
//
// Returns { ok: true, action: 'created' | 'updated' } on success,
//         { ok: false, reason, status?, code?, detail? } on failure.
export async function syncFirebaseAuthUser(env, info) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    return { ok: false, reason: 'FIREBASE_SERVICE_ACCOUNT no configurado en Cloudflare Pages.' };
  }
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  } catch (e) {
    return { ok: false, reason: 'FIREBASE_SERVICE_ACCOUNT no es un JSON válido.', detail: e.message };
  }
  const projectId = sa.project_id || env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    return { ok: false, reason: 'project_id no disponible en el service account ni en FIREBASE_PROJECT_ID.' };
  }

  let accessToken;
  try { accessToken = await getFirebaseToken(sa); }
  catch (e) {
    return { ok: false, reason: 'No se pudo obtener un OAuth2 token con el service account.', detail: e.message };
  }

  const base = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`;

  const baseBody = {
    localId:       info.uid,
    email:         info.email,
    emailVerified: !!info.emailVerified,
    displayName:   info.displayName || '',
    photoUrl:      info.photoUrl || ''
  };
  if (info.kind === 'password' && info.password) baseBody.password = info.password;
  if (info.kind === 'google' && info.googleId) {
    baseBody.providerUserInfo = [{
      providerId:  'google.com',
      rawId:       info.googleId,
      email:       info.email,
      displayName: info.displayName || '',
      photoUrl:    info.photoUrl || ''
    }];
  }
  if (info.kind === 'github' && info.githubId) {
    baseBody.providerUserInfo = [{
      providerId:  'github.com',
      rawId:       info.githubId,
      email:       info.email,
      displayName: info.displayName || '',
      photoUrl:    info.photoUrl || ''
    }];
  }

  // Intentar signUp primero (crea la cuenta).
  let signUpResp;
  try {
    signUpResp = await fetch(base, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseBody)
    });
  } catch (e) {
    return { ok: false, reason: 'Error de red llamando a Identity Toolkit.', detail: e.message };
  }
  if (signUpResp.ok) return { ok: true, action: 'created', projectId };

  const errBody = await signUpResp.json().catch(() => ({}));
  const code = errBody?.error?.message || '';
  if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID|RAW_ID_ALREADY_EXISTS/.test(code)) {
    return {
      ok: false,
      reason: 'signUp rechazado por Firebase Authentication.',
      status: signUpResp.status,
      code,
      detail: errBody?.error?.errors?.[0]?.message || ''
    };
  }

  // La cuenta ya existe → update.
  const updateBody = { ...baseBody };
  delete updateBody.password;
  if ((info.kind === 'google' && info.googleId) || (info.kind === 'github' && info.githubId)) {
    updateBody.linkProviderUserInfo = baseBody.providerUserInfo;
    delete updateBody.providerUserInfo;
  }
  let updateResp;
  try {
    updateResp = await fetch(`${base}:update`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody)
    });
  } catch (e) {
    return { ok: false, reason: 'Error de red en accounts:update.', detail: e.message };
  }
  if (updateResp.ok) return { ok: true, action: 'updated', projectId };

  const upErr = await updateResp.json().catch(() => ({}));
  return {
    ok: false,
    reason: 'update rechazado por Firebase Authentication.',
    status: updateResp.status,
    code: upErr?.error?.message || '',
    detail: upErr?.error?.errors?.[0]?.message || ''
  };
}

// Diagnóstico para GET /api/health/firebase-auth
export async function diagnoseFirebaseAuth(env) {
  const out = {
    serviceAccount:  !!env.FIREBASE_SERVICE_ACCOUNT,
    projectId:       '',
    oauth2Token:     false,
    identityToolkit: false,
    detail:          ''
  };
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    out.detail = 'Falta FIREBASE_SERVICE_ACCOUNT en Cloudflare Pages → Settings → Environment variables.';
    return out;
  }
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  } catch (e) {
    out.detail = 'FIREBASE_SERVICE_ACCOUNT no es un JSON válido: ' + e.message;
    return out;
  }
  out.projectId = sa.project_id || env.FIREBASE_PROJECT_ID || '';
  if (!out.projectId) {
    out.detail = 'El JSON del service account no incluye project_id (y FIREBASE_PROJECT_ID no está definido).';
    return out;
  }

  let accessToken;
  try {
    accessToken = await getFirebaseToken(sa);
    out.oauth2Token = true;
  } catch (e) {
    out.detail = 'getFirebaseToken falló: ' + e.message;
    return out;
  }

  // Read-only ping: list config (no modifica ninguna cuenta).
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${out.projectId}/config`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (r.ok) {
      out.identityToolkit = true;
      out.detail = 'Firebase Authentication accesible. Si no aparecen usuarios, asegúrate de habilitar Email/Password y Google en Authentication → Sign-in method.';
    } else {
      const errBody = await r.json().catch(() => ({}));
      out.detail = `Identity Toolkit ${r.status}: ${errBody?.error?.message || r.statusText}`;
    }
  } catch (e) {
    out.detail = 'Error de red llamando Identity Toolkit: ' + e.message;
  }
  return out;
}
