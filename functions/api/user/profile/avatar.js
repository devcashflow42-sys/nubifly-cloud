/**
 * POST /api/user/profile/avatar
 *
 * Sube una imagen de perfil.
 * Requiere: Authorization: Bearer TOKEN
 * Body: multipart/form-data con campo "avatar" (archivo de imagen)
 * Acepta: image/jpeg, image/png, image/webp
 * Máximo: 5 MB
 */
import { requireAuth }                         from '../../../_lib/auth.js';
import { fbGet, fbUpdate }                     from '../../../_lib/firebase.js';
import { resolveStorageToken,
         uploadBytesToStorage }                from '../../../_lib/storage.js';
import { jsonRes, ok, fail }                   from '../../../_lib/response.js';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_AVATAR_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg',  'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp']
]);

export async function onRequestPost(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  // ── Parse multipart ───────────────────────────────────────────────────────
  let form;
  try { form = await context.request.formData(); }
  catch { return jsonRes(fail('El Content-Type debe ser multipart/form-data.', 'BAD_REQUEST'), 400); }

  const fileInput = form.get('avatar');
  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Se requiere el campo "avatar" con el archivo de imagen.', 'MISSING_FILE'), 400);

  // ── MIME type ─────────────────────────────────────────────────────────────
  const mimeType = (fileInput.type || '').toLowerCase();
  const ext = ALLOWED_AVATAR_MIME.get(mimeType);
  if (!ext)
    return jsonRes(fail('Solo se permiten imágenes JPG, PNG y WebP.', 'UNSUPPORTED_MEDIA_TYPE'), 415);

  // ── Size ──────────────────────────────────────────────────────────────────
  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)
    return jsonRes(fail('El archivo está vacío.', 'EMPTY_FILE'), 400);
  if (fileBytes.byteLength > MAX_AVATAR_SIZE)
    return jsonRes(fail('La imagen no puede superar 5 MB.', 'FILE_TOO_LARGE'), 413);

  // ── Upload to Backblaze B2 Storage ───────────────────────────────────────
  const storageCtx = await resolveStorageToken(context.env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const timestamp   = Date.now();
  const storagePath = `avatars/${user.uid}/profile-${timestamp}.${ext}`;

  const upload = await uploadBytesToStorage(context.env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const avatarUrl = upload.fileUrl;

  // ── Update user record ────────────────────────────────────────────────────
  try {
    await fbUpdate({
      [`users/${user.uid}/avatar`]:    avatarUrl,
      [`users/${user.uid}/updatedAt`]: timestamp
    }, tok, db);
  } catch (e) {
    console.error('[POST profile/avatar]', e.message);
    return jsonRes(fail('Error guardando el avatar: ' + e.message, 'DB_WRITE_ERROR'), 503);
  }

  return jsonRes(ok({ avatar: avatarUrl }, 'Avatar actualizado correctamente.'));
}
