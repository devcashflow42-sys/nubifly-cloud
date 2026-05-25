/**
 * functions/_lib/upload-file.js
 *
 * Lógica compartida del upload "clásico" (POST /api/files/upload).
 * Acepta tanto JWT (rutas privadas) como x-api-key con permiso files:write.
 */
import { fbGet, fbSet, fbUpdate }         from './firebase.js';
import { sanitizeUploadName }             from './helpers.js';
import { resolveStorageToken,
         uploadBytesToStorage }           from './storage.js';
import { jsonRes, ok, fail }              from './response.js';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/avif','image/tiff',
  'video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo',
  'audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/aac','audio/flac',
  'application/pdf',
  'text/plain','text/csv','text/html','text/css',
  'application/json','application/xml',
  'application/zip','application/x-zip-compressed','application/x-tar','application/gzip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint',
  'font/woff','font/woff2','font/ttf','font/otf',
  'application/octet-stream'
]);

const BLOCKED_EXT = new Set([
  '.exe','.bat','.cmd','.com','.msi','.dll','.so','.dylib',
  '.sh','.bash','.zsh','.fish','.csh',
  '.php','.php3','.php4','.php5','.phtml',
  '.py','.rb','.pl','.perl','.cgi',
  '.asp','.aspx','.jsp','.jspx',
  '.ps1','.psm1','.psd1',
  '.vbs','.vbe','.wsf','.wsh',
  '.htaccess','.htpasswd',
  '.env','.env.local','.env.production'
]);

export async function uploadFileForUser(request, user, env, tok, db) {
  // ── Parse multipart form data ─────────────────────────────
  let form;
  try { form = await request.formData(); }
  catch { return jsonRes(fail('Content-Type debe ser multipart/form-data.', 'BAD_REQUEST'), 400); }

  const fileInput  = form.get('file');
  const projectId  = (form.get('projectId') || '').trim();
  const folder     = (form.get('folder') || '').trim().replace(/[^a-zA-Z0-9_\-/]/g, '').slice(0, 100);
  const visibility = (form.get('visibility') === 'public') ? 'public' : 'private';

  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Se requiere el campo "file".', 'BAD_REQUEST'), 400);
  if (!projectId)
    return jsonRes(fail('Se requiere el campo "projectId".', 'BAD_REQUEST'), 400);

  // ── Validar ownership del proyecto ────────────────────────
  const project = await fbGet(`projects/${projectId}`, tok, db).catch(() => null);
  if (!project) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (project.ownerId !== user.uid)
    return jsonRes(fail('No tienes permiso para subir archivos a este proyecto.', 'FORBIDDEN'), 403);

  // ── Tamaño ────────────────────────────────────────────────
  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)
    return jsonRes(fail('El archivo está vacío.', 'BAD_REQUEST'), 400);
  if (fileBytes.byteLength > MAX_SIZE)
    return jsonRes(fail('El archivo excede el tamaño máximo de 50 MB.', 'FILE_TOO_LARGE'), 413);

  // ── MIME / extensión ──────────────────────────────────────
  const mimeType = fileInput.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mimeType))
    return jsonRes(fail(`Tipo de archivo no permitido: ${mimeType}.`, 'UNSUPPORTED_MEDIA_TYPE'), 415);

  const originalName = fileInput.name || 'file';
  const extMatch = originalName.match(/(\.[^.]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (BLOCKED_EXT.has(ext))
    return jsonRes(fail(`Extensión de archivo no permitida: ${ext}.`, 'UNSUPPORTED_MEDIA_TYPE'), 415);

  const safeFilename = sanitizeUploadName(originalName);

  // ── Storage path ──────────────────────────────────────────
  const timestamp   = Date.now();
  const fileId      = crypto.randomUUID();
  const subPath     = folder ? `${folder}/` : '';
  const storagePath = `uploads/${user.uid}/${projectId}/${subPath}${timestamp}-${safeFilename}`;

  // ── Subir a Backblaze B2 Storage ─────────────────────────
  const storageCtx = await resolveStorageToken(env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const fileUrl = upload.fileUrl;
  const now = new Date().toISOString();
  const fileMeta = {
    fileId, fileName: safeFilename, originalName, mimeType,
    fileSize: fileBytes.byteLength, size: fileBytes.byteLength,
    storagePath, url: fileUrl, fileUrl, projectId,
    folder: folder || null, visibility,
    ownerId: user.uid, createdAt: now, updatedAt: now
  };

  await fbUpdate({
    [`files/${fileId}`]:                     fileMeta,
    [`projectFiles/${projectId}/${fileId}`]: fileMeta,
    [`userFiles/${user.uid}/${fileId}`]:     fileMeta
  }, tok, db);

  // Best-effort: project.storageUsed
  try {
    const used = (await fbGet(`projects/${projectId}/storageUsed`, tok, db)) || 0;
    await fbSet(`projects/${projectId}/storageUsed`, used + fileBytes.byteLength, tok, db);
  } catch (e) {
    console.warn('[uploadFileForUser] storageUsed update failed:', e.message);
  }

  return jsonRes(ok({
    file: {
      fileId, fileName: safeFilename, originalName,
      url: fileUrl, fileUrl,
      size: fileBytes.byteLength, fileSize: fileBytes.byteLength,
      mimeType, projectId, folder: folder || null, visibility,
      storagePath, createdAt: now
    }
  }, 'Archivo subido correctamente'), 201);
}
