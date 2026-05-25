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
      'Firebase Storage requiere FIREBASE_SERVICE_ACCOUNT. ' +
      'Agrégalo en Cloudflare Pages → Settings → Environment variables.',
      'CONFIG_ERROR'), 500) };
  }
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    return { storageTok: await getFirebaseToken(sa) };
  } catch (e) {
    console.error('[resolveStorageToken]', e);
    return { errorResponse: jsonRes(fail(
      'FIREBASE_SERVICE_ACCOUNT tiene formato inválido. Verifica que sea JSON válido.',
      'CONFIG_ERROR'), 500) };
  }
}

export async function uploadBytesToStorage(env, storageTok, storagePath, mimeType, fileBytes) {
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) {
    return { errorResponse: jsonRes(fail(
      'FIREBASE_STORAGE_BUCKET no está configurado. ' +
      'Agrégalo en Cloudflare Pages → Settings → Environment variables. ' +
      'El valor es el nombre de tu bucket, p.ej. "mi-proyecto.appspot.com".',
      'CONFIG_ERROR'), 500) };
  }

  const encodedPath = encodeURIComponent(storagePath);
  const uploadUrl   = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

  let uploadRes;
  try {
    // NOTA: No incluir Content-Length — es un header prohibido en Cloudflare Workers
    // y causa TypeError silencioso. El runtime lo calcula automáticamente.
    uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${storageTok}`,
        'Content-Type':  mimeType,
      },
      body: fileBytes
    });
  } catch (e) {
    console.error('[uploadBytesToStorage] fetch network error:', e.message || e);
    return { errorResponse: jsonRes(fail(
      'No se pudo conectar con Firebase Storage. Verifica la configuración del proyecto.',
      'UPLOAD_NETWORK_ERROR'), 502) };
  }

  if (!uploadRes.ok) {
    const errTxt = await uploadRes.text().catch(() => '');
    console.error('[uploadBytesToStorage] Firebase Storage error:', uploadRes.status, errTxt);

    // Mensajes específicos según el código HTTP de Firebase Storage
    let msg;
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      msg = `Firebase Storage rechazó la subida (HTTP ${uploadRes.status}): sin permisos. ` +
            'Verifica las reglas de Storage y que FIREBASE_SERVICE_ACCOUNT tenga acceso.';
    } else if (uploadRes.status === 404) {
      msg = `El bucket de Firebase Storage no existe (HTTP 404). ` +
            `Verifica que FIREBASE_STORAGE_BUCKET="${bucket}" sea correcto y que Storage esté habilitado.`;
    } else if (uploadRes.status === 413) {
      msg = 'El archivo es demasiado grande para Firebase Storage.';
    } else {
      msg = `Firebase Storage devolvió un error (HTTP ${uploadRes.status}). ` +
            'Revisa los logs de Cloudflare para más detalles.';
    }

    return { errorResponse: jsonRes(fail(msg, 'UPLOAD_ERROR'), 502) };
  }

  let storageData;
  try {
    storageData = await uploadRes.json();
  } catch (e) {
    console.error('[uploadBytesToStorage] Failed to parse Storage response:', e.message);
    return { errorResponse: jsonRes(fail(
      'Firebase Storage devolvió una respuesta inesperada al subir el archivo.',
      'UPLOAD_PARSE_ERROR'), 502) };
  }

  const downloadToken = storageData.downloadTokens;
  const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}` +
                  `?alt=media${downloadToken ? `&token=${downloadToken}` : ''}`;
  return { fileUrl, storageData };
}
