/**
 * GET  /api/user/files — lista todos los archivos subidos por el usuario.
 * POST /api/user/files — sube un archivo (JWT auth, multipart/form-data).
 */
import { requireAuth }               from '../../_lib/auth.js';
import { fbGet, fbUpdate }           from '../../_lib/firebase.js';
import { sanitizeUploadName }        from '../../_lib/helpers.js';
import { resolveStorageToken,
         uploadBytesToStorage }      from '../../_lib/storage.js';
import { jsonRes, ok, fail }         from '../../_lib/response.js';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const data = await fbGet(`userFiles/${user.uid}`, tok, db);
  const toTs = f => f.createdAt ? new Date(f.createdAt).getTime() : (f.uploadedAt || 0);
  const files = data
    ? Object.entries(data).map(([id, f]) => ({ id, ...f })).sort((a, b) => toTs(b) - toTs(a))
    : [];
  return jsonRes(ok({ files }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;
  const { env } = context;

  let form;
  try { form = await context.request.formData(); }
  catch { return jsonRes(fail('Se esperaba multipart/form-data con campo "file".', 'INVALID_FORM'), 400); }

  const fileInput = form.get('file');
  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Campo "file" requerido en el body.', 'FILE_REQUIRED'), 400);

  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)      return jsonRes(fail('El archivo está vacío.', 'BAD_REQUEST'), 400);
  if (fileBytes.byteLength > MAX_SIZE) return jsonRes(fail('El archivo supera el límite de 50 MB.', 'FILE_TOO_LARGE'), 413);

  const mimeType     = fileInput.type || 'application/octet-stream';
  const originalName = fileInput.name || 'file';
  const safeFilename = sanitizeUploadName(originalName);
  const title        = String(form.get('title')       || '').trim().slice(0, 120) || safeFilename;
  const description  = String(form.get('description') || '').trim().slice(0, 500);
  const projectId    = String(form.get('projectId')   || '').trim();

  const now         = Date.now();
  const nowIso      = new Date(now).toISOString();
  const fileId      = crypto.randomUUID();
  const storagePath = `publications/${user.uid}/${projectId || 'general'}/${now}-${safeFilename}`;

  const storageCtx = await resolveStorageToken(env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const fileMeta = {
    fileId, id: fileId,
    fileName: safeFilename, originalName, name: safeFilename,
    title, description, mimeType,
    fileSize: fileBytes.byteLength, size: fileBytes.byteLength,
    storagePath, url: upload.fileUrl, fileUrl: upload.fileUrl,
    projectId: projectId || '',
    ownerId: user.uid, userId: user.uid,
    source: 'dashboard', status: 'published',
    createdAt: nowIso, updatedAt: nowIso
  };

  const updates = {
    [`files/${fileId}`]:                                           fileMeta,
    [`userFiles/${user.uid}/${fileId}`]:                           fileMeta,
    [`recentPublications/${fileId}`]:                              fileMeta,
    [`recent_publications/${fileId}`]:                             fileMeta,
    [`userRecentPublications/${user.uid}/${fileId}`]:              fileMeta,
    [`user_recent_publications/${user.uid}/${fileId}`]:            fileMeta,
  };
  if (projectId) {
    updates[`projectFiles/${projectId}/${fileId}`]                    = fileMeta;
    updates[`projectRecentPublications/${projectId}/${fileId}`]       = fileMeta;
    updates[`project_recent_publications/${projectId}/${fileId}`]     = fileMeta;
  }

  try {
    await fbUpdate(updates, tok, db);
  } catch (e) {
    console.error('[POST /api/user/files] fbUpdate:', e.message);
    return jsonRes(fail('Error guardando el archivo. Inténtalo de nuevo.', 'DB_ERROR'), 500);
  }

  return jsonRes(ok({ file: fileMeta }, 'Archivo publicado correctamente.'), 201);
}
