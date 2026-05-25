/**
 * functions/_lib/storage.js
 *
 * Helpers para subir bytes a Backblaze B2 Storage.
 * Drop-in replacement de Firebase Storage — mantiene las mismas firmas
 * de función para compatibilidad total con todos los callers.
 *
 * Flujo B2 API v2:
 *   1. b2_authorize_account  → authToken, apiUrl, downloadUrl
 *   2. b2_get_upload_url     → uploadUrl, uploadAuthToken
 *   3. POST uploadUrl        → fileId, fileName
 *   4. URL pública           → {downloadUrl}/file/{bucketName}/{storagePath}
 */

import { jsonRes, fail } from './response.js';

// ─── Cache de autorización B2 (válida 24 h, renovamos a las 23 h) ────────────
let _b2Auth       = null;
let _b2AuthExpiry = 0;
const B2_AUTH_TTL_MS = 23 * 60 * 60 * 1000; // 23 horas

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Convierte ArrayBuffer → string hexadecimal */
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Calcula SHA-1 de un ArrayBuffer y devuelve el hex */
async function sha1Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-1', arrayBuffer);
  return bufToHex(digest);
}

/**
 * Autoriza la cuenta B2.
 * Almacena el resultado en caché para no repetir la llamada en cada subida.
 */
async function authorizeB2(keyId, appKey) {
  const now = Date.now();
  if (_b2Auth && now < _b2AuthExpiry) return _b2Auth;

  const credentials = btoa(`${keyId}:${appKey}`);
  let res;
  try {
    res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: { Authorization: `Basic ${credentials}` },
    });
  } catch (e) {
    throw new Error(`B2 authorize network error: ${e.message || e}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`B2 authorize failed (HTTP ${res.status}): ${txt}`);
  }

  const data = await res.json();
  _b2Auth = {
    authToken:    data.authorizationToken,
    apiUrl:       data.apiInfo?.storageApi?.apiUrl ?? data.apiUrl,
    downloadUrl:  data.downloadUrl,
    accountId:    data.accountId,
    // Si la Application Key está restringida a un bucket, B2 devuelve su id/name directamente.
    bucketId:     data.allowed?.bucketId   ?? null,
    bucketName:   data.allowed?.bucketName ?? null,
  };
  _b2AuthExpiry = now + B2_AUTH_TTL_MS;
  return _b2Auth;
}

// ─── Exports públicos (firmas idénticas a la versión Firebase Storage) ────────

/**
 * resolveStorageToken(env, tok)
 *
 * Autoriza con Backblaze B2 y devuelve un objeto de contexto opaco
 * que uploadBytesToStorage usará internamente.
 *
 * @param  {object} env  Variables de entorno de Cloudflare Pages
 * @param  {string} tok  Token Firebase DB (ignorado para B2; se mantiene por compatibilidad)
 * @returns {{ storageTok: object } | { errorResponse: Response }}
 */
export async function resolveStorageToken(env, tok) {
  const keyId  = env.BACKBLAZE_KEY_ID;
  const appKey = env.BACKBLAZE_APPLICATION_KEY;

  if (!keyId || !appKey) {
    return {
      errorResponse: jsonRes(fail(
        'Backblaze B2 no está configurado. ' +
        'Agrega BACKBLAZE_KEY_ID y BACKBLAZE_APPLICATION_KEY en ' +
        'Cloudflare Pages → Settings → Environment variables.',
        'CONFIG_ERROR'), 500),
    };
  }

  let auth;
  try {
    auth = await authorizeB2(keyId, appKey);
  } catch (e) {
    console.error('[resolveStorageToken]', e.message || e);
    return {
      errorResponse: jsonRes(fail(
        'No se pudo autenticar con Backblaze B2. ' +
        'Verifica que BACKBLAZE_KEY_ID y BACKBLAZE_APPLICATION_KEY sean correctos.',
        'B2_AUTH_ERROR'), 502),
    };
  }

  // Si la Application Key no tiene un bucket asignado, necesitamos BACKBLAZE_BUCKET_NAME.
  const bucketName = auth.bucketName ?? env.BACKBLAZE_BUCKET_NAME ?? null;
  if (!bucketName) {
    return {
      errorResponse: jsonRes(fail(
        'BACKBLAZE_BUCKET_NAME no está configurado. ' +
        'Agrégalo en Cloudflare Pages → Settings → Environment variables ' +
        'con el nombre de tu bucket de Backblaze B2.',
        'CONFIG_ERROR'), 500),
    };
  }

  return {
    storageTok: {
      authToken:   auth.authToken,
      apiUrl:      auth.apiUrl,
      downloadUrl: auth.downloadUrl,
      accountId:   auth.accountId,
      bucketId:    auth.bucketId,   // puede ser null si la key no es de bucket
      bucketName,
    },
  };
}

/**
 * uploadBytesToStorage(env, storageTok, storagePath, mimeType, fileBytes)
 *
 * Sube bytes a Backblaze B2 y devuelve la URL pública de descarga.
 *
 * @param  {object}      env          Variables de entorno de Cloudflare Pages
 * @param  {object}      storageTok   Objeto de auth retornado por resolveStorageToken
 * @param  {string}      storagePath  Ruta dentro del bucket, e.g. "uploads/uid/file.jpg"
 * @param  {string}      mimeType     MIME type del archivo
 * @param  {ArrayBuffer} fileBytes    Contenido del archivo
 * @returns {{ fileUrl: string, storageData: object } | { errorResponse: Response }}
 */
export async function uploadBytesToStorage(env, storageTok, storagePath, mimeType, fileBytes) {
  const { authToken, apiUrl, downloadUrl, bucketName } = storageTok;
  let   { bucketId } = storageTok;

  // ── 1. Resolver bucketId si no lo tenemos (key no restringida a bucket) ──────
  if (!bucketId) {
    const bucketNameEnv = bucketName;
    let listRes;
    try {
      listRes = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
        method:  'POST',
        headers: {
          Authorization:  authToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountId:  storageTok.accountId,
          bucketName: bucketNameEnv,
          bucketTypes: ['allPublic', 'allPrivate'],
        }),
      });
    } catch (e) {
      console.error('[uploadBytesToStorage] b2_list_buckets network error:', e.message || e);
      return {
        errorResponse: jsonRes(fail(
          'No se pudo conectar con Backblaze B2 para obtener el bucket.',
          'B2_NETWORK_ERROR'), 502),
      };
    }
    if (!listRes.ok) {
      const txt = await listRes.text().catch(() => '');
      console.error('[uploadBytesToStorage] b2_list_buckets error:', listRes.status, txt);
      return {
        errorResponse: jsonRes(fail(
          `No se encontró el bucket "${bucketNameEnv}" en Backblaze B2 (HTTP ${listRes.status}). ` +
          'Verifica BACKBLAZE_BUCKET_NAME y los permisos de la Application Key.',
          'B2_BUCKET_NOT_FOUND'), 502),
      };
    }
    const listData = await listRes.json();
    const bucket   = (listData.buckets ?? []).find(b => b.bucketName === bucketNameEnv);
    if (!bucket) {
      return {
        errorResponse: jsonRes(fail(
          `El bucket "${bucketNameEnv}" no existe en tu cuenta de Backblaze B2. ` +
          'Verifica el valor de BACKBLAZE_BUCKET_NAME.',
          'B2_BUCKET_NOT_FOUND'), 502),
      };
    }
    bucketId = bucket.bucketId;
    // Actualizar caché
    if (_b2Auth) _b2Auth.bucketId = bucketId;
    storageTok.bucketId = bucketId;
  }

  // ── 2. Obtener URL de subida ───────────────────────────────────────────────
  let uploadUrlData;
  try {
    const urlRes = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
      method:  'POST',
      headers: {
        Authorization:  authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucketId }),
    });
    if (!urlRes.ok) {
      const txt = await urlRes.text().catch(() => '');
      console.error('[uploadBytesToStorage] b2_get_upload_url error:', urlRes.status, txt);

      if (urlRes.status === 401) {
        // Token expirado — limpiar caché para forzar re-autorización en próxima llamada
        _b2Auth       = null;
        _b2AuthExpiry = 0;
      }

      return {
        errorResponse: jsonRes(fail(
          `No se pudo obtener la URL de subida de Backblaze B2 (HTTP ${urlRes.status}). ` +
          'Revisa los permisos de la Application Key.',
          'B2_GET_UPLOAD_URL_ERROR'), 502),
      };
    }
    uploadUrlData = await urlRes.json();
  } catch (e) {
    console.error('[uploadBytesToStorage] b2_get_upload_url network error:', e.message || e);
    return {
      errorResponse: jsonRes(fail(
        'No se pudo conectar con Backblaze B2 para obtener la URL de subida.',
        'B2_NETWORK_ERROR'), 502),
    };
  }

  const { uploadUrl, authorizationToken: uploadToken } = uploadUrlData;

  // ── 3. Calcular SHA-1 ──────────────────────────────────────────────────────
  let sha1;
  try {
    sha1 = await sha1Hex(fileBytes);
  } catch (e) {
    console.warn('[uploadBytesToStorage] SHA-1 compute failed, using do_not_verify:', e.message);
    sha1 = 'do_not_verify';
  }

  // ── 4. Subir el archivo ────────────────────────────────────────────────────
  // Nota: Content-Length ES requerido por B2 y está permitido en Cloudflare Workers
  // cuando se asigna como header explícito en POST (no es un header "prohibido").
  const byteLength = fileBytes instanceof ArrayBuffer
    ? fileBytes.byteLength
    : fileBytes.byteLength ?? fileBytes.length ?? 0;

  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        Authorization:       uploadToken,
        'Content-Type':      mimeType,
        'Content-Length':    String(byteLength),
        'X-Bz-File-Name':    encodeURIComponent(storagePath),
        'X-Bz-Content-Sha1': sha1,
      },
      body: fileBytes,
    });
  } catch (e) {
    console.error('[uploadBytesToStorage] upload network error:', e.message || e);
    return {
      errorResponse: jsonRes(fail(
        'No se pudo conectar con Backblaze B2 para subir el archivo.',
        'UPLOAD_NETWORK_ERROR'), 502),
    };
  }

  if (!uploadRes.ok) {
    const errTxt = await uploadRes.text().catch(() => '');
    console.error('[uploadBytesToStorage] B2 upload error:', uploadRes.status, errTxt);

    let msg;
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      _b2Auth       = null;
      _b2AuthExpiry = 0;
      msg = `Backblaze B2 rechazó la subida (HTTP ${uploadRes.status}): sin permisos. ` +
            'Verifica los permisos de la Application Key y las reglas del bucket.';
    } else if (uploadRes.status === 404) {
      msg = `El bucket de Backblaze B2 no fue encontrado (HTTP 404). ` +
            `Verifica que BACKBLAZE_BUCKET_NAME="${bucketName}" sea correcto.`;
    } else if (uploadRes.status === 413 || uploadRes.status === 400) {
      msg = 'El archivo es demasiado grande o tiene un formato no soportado por Backblaze B2.';
    } else if (uploadRes.status === 503) {
      msg = 'Backblaze B2 no está disponible en este momento. Intenta de nuevo en unos segundos.';
    } else {
      msg = `Backblaze B2 devolvió un error al subir el archivo (HTTP ${uploadRes.status}). ` +
            'Revisa los logs de Cloudflare para más detalles.';
    }

    return { errorResponse: jsonRes(fail(msg, 'UPLOAD_ERROR'), 502) };
  }

  let storageData;
  try {
    storageData = await uploadRes.json();
  } catch (e) {
    console.error('[uploadBytesToStorage] Failed to parse B2 upload response:', e.message);
    return {
      errorResponse: jsonRes(fail(
        'Backblaze B2 devolvió una respuesta inesperada al subir el archivo.',
        'UPLOAD_PARSE_ERROR'), 502),
    };
  }

  // ── 5. Construir URL de descarga pública ───────────────────────────────────
  // Formato: {downloadUrl}/file/{bucketName}/{storagePath}
  const fileUrl = `${downloadUrl}/file/${bucketName}/${storagePath}`;

  return { fileUrl, storageData };
}
