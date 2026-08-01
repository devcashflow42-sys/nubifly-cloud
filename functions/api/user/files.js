/**
 * GET  /api/user/files — lista todos los archivos subidos por el usuario.
 * POST /api/user/files — sube un archivo (JWT auth, multipart/form-data).
 * Datos en PostgreSQL (context.data.sql).
 */
import { requireAuth }               from '../../_lib/auth.js';
import { sanitizeUploadName }        from '../../_lib/helpers.js';
import { resolveStorageToken,
         uploadBytesToStorage }      from '../../_lib/storage.js';
import { jsonRes, ok, fail }         from '../../_lib/response.js';
import { rowToFile }                 from '../../_lib/models.js';
import { crearNotificacionLogro }    from '../../_lib/notifications.js';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;

  const rows = await sql`
    select * from files
    where owner_id = ${user.uid}
    order by created_at desc nulls last
    limit 200
  `;
  const files = rows.map(rowToFile);
  return jsonRes(ok({ files }));
}

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { sql } = context.data;
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
  const safeFilename = sanitizeUploadName(originalName); // solo para la ruta de almacenamiento
  const title        = String(form.get('title')       || '').trim().slice(0, 120) || originalName;
  const description  = String(form.get('description') || '').trim().slice(0, 500);
  const projectId    = String(form.get('projectId')   || '').trim();
  const author       = String(form.get('author')      || '').trim().slice(0, 120);

  // Tipo de medio (para pintar la publicación como canción / video / imagen)
  const mediaType = mimeType.startsWith('audio/') ? 'audio'
                  : mimeType.startsWith('video/') ? 'video'
                  : mimeType.startsWith('image/') ? 'image'
                  : 'file';

  const now         = Date.now();
  const fileId      = crypto.randomUUID();
  const storagePath = `publications/${user.uid}/${projectId || 'general'}/${now}-${safeFilename}`;

  const storageCtx = await resolveStorageToken(env, null);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  // Portada / banner opcional (imagen ≤ 5 MB) para canciones y videos
  let coverUrl = '';
  const coverInput = form.get('cover');
  if (coverInput && typeof coverInput !== 'string') {
    try {
      const coverBytes = await coverInput.arrayBuffer();
      const COVER_MAX  = 5 * 1024 * 1024;
      const coverMime  = coverInput.type || 'image/jpeg';
      if (coverBytes.byteLength > 0 && coverBytes.byteLength <= COVER_MAX && coverMime.startsWith('image/')) {
        const coverName = sanitizeUploadName(coverInput.name || 'cover.jpg');
        const coverPath = `covers/${user.uid}/${now}-${coverName}`;
        const cup = await uploadBytesToStorage(env, storageCtx.storageTok, coverPath, coverMime, coverBytes);
        if (!cup.errorResponse) coverUrl = cup.fileUrl;
      }
    } catch (e) {
      console.warn('[POST /api/user/files] cover upload:', e.message);
    }
  }

  try {
    await sql`
      insert into files
        (file_id, owner_id, project_id, file_name, original_name, title, description,
         author, media_type, mime_type, cover_url, url, storage_path, file_size,
         source, status, visibility, created_at, updated_at)
      values
        (${fileId}, ${user.uid}, ${projectId || null}, ${originalName}, ${originalName},
         ${title}, ${description}, ${author}, ${mediaType}, ${mimeType}, ${coverUrl || null},
         ${upload.fileUrl}, ${storagePath}, ${fileBytes.byteLength}, ${'dashboard'},
         ${'published'}, ${'private'}, ${now}, ${now})
    `;
  } catch (e) {
    console.error('[POST /api/user/files] insert:', e.message);
    return jsonRes(fail('Error guardando el archivo. Inténtalo de nuevo.', 'DB_ERROR'), 500);
  }

  const fileMeta = rowToFile({
    file_id: fileId, owner_id: user.uid, project_id: projectId || null,
    file_name: originalName, original_name: originalName, title, description,
    author, media_type: mediaType, mime_type: mimeType, cover_url: coverUrl,
    url: upload.fileUrl, storage_path: storagePath, file_size: fileBytes.byteLength,
    source: 'dashboard', status: 'published', visibility: 'private',
    created_at: now, updated_at: now
  });

  // context.waitUntil mantiene el worker vivo hasta que la notificación se guarde
  context.waitUntil(
    crearNotificacionLogro(user.uid, 'primer_archivo', fileId, sql)
      .catch(e => console.warn('[notify/primer_archivo]', e.message))
  );

  return jsonRes(ok({ file: fileMeta }, 'Archivo publicado correctamente.'), 201);
}
