/**
 * functions/_lib/storage.js
 *
 * Helpers para subir bytes a Firebase Storage.
 */
import { getFirebaseToken } from './firebase.js';
import { jsonRes, fail }    from './response.js';

// Resuelve un OAuth2 token utilizable contra Firebase Storage.
//
// Si ya tenemos OAuth2 (FIREBASE_SERVICE_ACCOUNT) lo reusamos.
// Si tok es "secret:..." (FIREBASE_DB_SECRET) necesitamos un token aparte
// para Storage usando el service account.
export async function resolveStorageToken(env, tok) {
  if (!tok.startsWith('secret:')) return { storageTok: tok };
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    return { errorResponse: jsonRes(fail(
      'Agrega FIREBASE_SERVICE_ACCOUNT en Cloudflare Pages → Settings → Environment variables.',
      'CONFIG_ERROR'), 500) };
  }
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    return { storageTok: await getFirebaseToken(sa) };
  } catch (e) {
    console.error('[resolveStorageToken]', e);
    return { errorResponse: jsonRes(fail('FIREBASE_SERVICE_ACCOUNT tiene formato inválido.', 'CONFIG_ERROR'), 500) };
  }
}

export async function uploadBytesToStorage(env, storageTok, storagePath, mimeType, fileBytes) {
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) {
    return { errorResponse: jsonRes(fail(
      'Agrega FIREBASE_STORAGE_BUCKET en Cloudflare Pages → Settings → Environment variables. ' +
      'El valor es el nombre de tu bucket, p.ej. "mi-proyecto.appspot.com".',
      'CONFIG_ERROR'), 500) };
  }
  const encodedPath = encodeURIComponent(storagePath);
  const uploadUrl   = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;
  try {
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${storageTok}`,
        'Content-Type':   mimeType,
        'Content-Length': String(fileBytes.byteLength)
      },
      body: fileBytes
    });
    if (!uploadRes.ok) {
      const errTxt = await uploadRes.text().catch(() => '');
      console.error('[uploadBytesToStorage]', uploadRes.status, errTxt);
      return { errorResponse: jsonRes(fail('Error al subir el archivo a Firebase Storage.', 'UPLOAD_ERROR'), 502) };
    }
    const storageData   = await uploadRes.json();
    const downloadToken = storageData.downloadTokens;
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media${downloadToken ? `&token=${downloadToken}` : ''}`;
    return { fileUrl, storageData };
  } catch (e) {
    console.error('[uploadBytesToStorage] fetch', e);
    return { errorResponse: jsonRes(fail('Error de conexión con Firebase Storage.', 'UPLOAD_ERROR'), 502) };
  }
}
