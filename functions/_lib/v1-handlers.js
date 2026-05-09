/**
 * functions/_lib/v1-handlers.js
 *
 * Handlers compartidos para los endpoints públicos v1.
 * Extraídos para mantener las rutas (functions/api/v1/*.js) cortas.
 *
 *   - v1Upload          → user key, sube a Firebase Storage
 *   - v1ListFiles       → user key, lista archivos del proyecto asociado
 *   - v1KeyStatus       → user key, info de la clave + uso
 *   - v1ProjectUpload   → user key o project key, sube a un proyecto específico
 *   - v1PublicationUpload → user key o project key, crea publicación
 *   - v1ProjectRequest  → project key, dispatcher de acciones (ping/echo/store/fetch)
 *   - v1ProjectStatus   → project key, info del proyecto + uso
 */
import { fbGet, fbSet, fbUpdate }   from './firebase.js';
import { sanitizeUploadName }       from './helpers.js';
import { resolveStorageToken,
         uploadBytesToStorage }     from './storage.js';
import { requirePermission,
         requireProjectUploadPermission,
         requirePublicationPermission,
         buildDefaultPermissions }  from './permissions.js';
import { PLAN_LIMITS }              from './plans.js';
import { jsonRes, ok, fail }        from './response.js';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

// ═══════════════════════════════════════════════════════════
// USER KEY — POST /api/v1/upload
// ═══════════════════════════════════════════════════════════

export async function v1Upload(req, kd, tok, db, env) {
  if (!requirePermission(kd.keyData, 'files', 'write'))
    return jsonRes({ success: false, error: 'PERMISSION_DENIED',
      message: 'Tu API Key no tiene permisos para subir archivos (files:write requerido).' }, 403);

  let form;
  try { form = await req.formData(); }
  catch { return jsonRes(fail('Se esperaba multipart/form-data con campo "file".', 'INVALID_FORM'), 400); }

  const fileInput = form.get('file');
  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Campo "file" requerido en el body (multipart/form-data).', 'FILE_REQUIRED'), 400);

  const projectId = (form.get('projectId') || '').trim() || (kd.keyData.projectId || '').trim();
  if (!projectId)
    return jsonRes(fail('projectId requerido. Inclúyelo en el form-data o asocia un proyecto a tu API Key.', 'PROJECT_REQUIRED'), 400);

  const project = await fbGet(`projects/${projectId}`, tok, db).catch(() => null);
  if (!project) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (project.ownerId !== kd.uid)
    return jsonRes(fail('No tienes permiso para subir archivos a este proyecto.', 'FORBIDDEN'), 403);

  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)             return jsonRes(fail('El archivo está vacío.', 'BAD_REQUEST'), 400);
  if (fileBytes.byteLength > MAX_SIZE)         return jsonRes(fail('El archivo supera el límite de 50 MB.', 'FILE_TOO_LARGE'), 413);

  const mimeType     = fileInput.type || 'application/octet-stream';
  const originalName = fileInput.name || 'file';
  const safeFilename = sanitizeUploadName(originalName);

  const now         = Date.now();
  const nowIso      = new Date(now).toISOString();
  const fileId      = crypto.randomUUID();
  const storagePath = `uploads/${kd.uid}/${projectId}/${now}-${safeFilename}`;

  const storageCtx = await resolveStorageToken(env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const fileMeta = {
    fileId, fileName: safeFilename, originalName,
    name: safeFilename, mimeType,
    fileSize: fileBytes.byteLength, size: fileBytes.byteLength,
    storagePath, url: upload.fileUrl, fileUrl: upload.fileUrl,
    projectId, ownerId: kd.uid, userId: kd.uid,
    apiKeyId: kd.keyId, status: 'published',
    createdAt: nowIso, updatedAt: nowIso
  };

  await fbUpdate({
    [`files/${fileId}`]:                     fileMeta,
    [`projectFiles/${projectId}/${fileId}`]: fileMeta,
    [`userFiles/${kd.uid}/${fileId}`]:       fileMeta
  }, tok, db);

  // Best-effort: storageUsed
  fbGet(`projects/${projectId}/storageUsed`, tok, db)
    .then(used => fbSet(`projects/${projectId}/storageUsed`, (used || 0) + fileBytes.byteLength, tok, db))
    .catch(() => {});

  // Best-effort: usage counters + activity log
  const today = nowIso.slice(0, 10);
  const month = today.slice(0, 7);
  const [todayCnt, monthCnt] = await Promise.all([
    fbGet(`apiUsage/${projectId}/${today}`, tok, db).catch(() => 0),
    fbGet(`apiUsage/${projectId}/${month}`, tok, db).catch(() => 0)
  ]);
  const eventId = crypto.randomUUID();
  fbUpdate({
    [`userApiKeys/${kd.uid}/${kd.keyId}/calls`]:    (kd.keyData.calls || 0) + 1,
    [`userApiKeys/${kd.uid}/${kd.keyId}/lastUsed`]: now,
    [`apiUsage/${projectId}/${today}`]:             (todayCnt || 0) + 1,
    [`apiUsage/${projectId}/${month}`]:             (monthCnt || 0) + 1,
    [`userApiActivity/${kd.uid}/${eventId}`]: {
      id: eventId, ts: now, createdAt: nowIso,
      endpoint: '/api/v1/upload', method: 'POST', status: 'success',
      kind: 'file', projectId, fileId, fileName: safeFilename,
      apiKeyId: kd.keyId, apiKeyName: kd.keyData.name || '', source: 'userKey'
    }
  }, tok, db).catch(() => {});

  return jsonRes(ok({ file: fileMeta }, 'Archivo subido correctamente.'), 201);
}

// ═══════════════════════════════════════════════════════════
// USER KEY — GET /api/v1/files
// ═══════════════════════════════════════════════════════════

export async function v1ListFiles(kd, tok, db) {
  if (!requirePermission(kd.keyData, 'files', 'read'))
    return jsonRes({ success: false, error: 'PERMISSION_DENIED',
      message: 'Tu API Key no tiene permisos para leer archivos.' }, 403);

  const projectId = kd.keyData.projectId || '';
  const raw = projectId
    ? await fbGet(`projectFiles/${projectId}`, tok, db)
    : await fbGet(`userFiles/${kd.uid}`,       tok, db);

  const toTs = f => f.createdAt ? new Date(f.createdAt).getTime() : (f.uploadedAt || 0);
  const files = raw
    ? Object.entries(raw).map(([id, f]) => ({ id, ...f })).sort((a, b) => toTs(b) - toTs(a))
    : [];

  return jsonRes({ success: true, data: { files, count: files.length } });
}

// ═══════════════════════════════════════════════════════════
// USER KEY — GET /api/v1/key/status   (también /v1/status si user key)
// ═══════════════════════════════════════════════════════════

export async function v1KeyStatus(kd, tok, db) {
  const projectId = kd.keyData.projectId || '';
  const today  = new Date().toISOString().slice(0, 10);
  const month  = today.slice(0, 7);
  const usage  = projectId
    ? ((await fbGet(`apiUsage/${projectId}`, tok, db)) || {})
    : {};

  return jsonRes({ success: true, data: {
    key: {
      id:       kd.keyId,
      name:     kd.keyData.name,
      active:   kd.keyData.active !== false,
      calls:    kd.keyData.calls   || 0,
      lastUsed: kd.keyData.lastUsed || null,
      created:  kd.keyData.created  || null
    },
    permissions:      kd.keyData.permissions || buildDefaultPermissions(kd.keyData.perm || 'all'),
    permissionPreset: kd.keyData.perm || 'custom',
    projectId,
    usage: { today: usage[today] || 0, month: usage[month] || 0 }
  }});
}

// ═══════════════════════════════════════════════════════════
// BEARER — POST /api/v1/projects/:projectId/files/upload
// (acepta user key o project key)
// ═══════════════════════════════════════════════════════════

export async function v1ProjectUpload(request, projectId, access, tok, db, env) {
  // Permisos / ownership
  if (access.kind === 'userKey') {
    if (access.projectId && access.projectId !== projectId) {
      return jsonRes(fail('Tu API Key está asociada a otro proyecto.', 'FORBIDDEN'), 403);
    }
    if (!requireProjectUploadPermission(access.keyData)) {
      return jsonRes({ success: false, error: 'PERMISSION_DENIED',
        message: 'Tu API Key no tiene permisos para subir o modificar archivos del proyecto.' }, 403);
    }
  } else if (access.projectId !== projectId) {
    return jsonRes(fail('La API Key no pertenece a este proyecto.', 'FORBIDDEN'), 403);
  }

  const project = (access.kind === 'projectKey' && access.project)
    ? access.project
    : await fbGet(`projects/${projectId}`, tok, db).catch(() => null);
  if (!project) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
  if (project.ownerId !== access.ownerId) {
    return jsonRes(fail('No tienes permiso para acceder a este proyecto.', 'FORBIDDEN'), 403);
  }

  let form;
  try { form = await request.formData(); }
  catch { return jsonRes(fail('Se esperaba multipart/form-data con campo "file".', 'INVALID_FORM'), 400); }

  const fileInput = form.get('file');
  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Campo "file" requerido en el body (multipart/form-data).', 'FILE_REQUIRED'), 400);

  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)      return jsonRes(fail('El archivo está vacío.', 'BAD_REQUEST'), 400);
  if (fileBytes.byteLength > MAX_SIZE) return jsonRes(fail('El archivo supera el límite de 50 MB.', 'FILE_TOO_LARGE'), 413);

  const mimeType     = fileInput.type || 'application/octet-stream';
  const originalName = fileInput.name || 'file';
  const safeFilename = sanitizeUploadName(originalName);

  const now         = Date.now();
  const nowIso      = new Date(now).toISOString();
  const fileId      = crypto.randomUUID();
  const storagePath = `uploads/${access.ownerId}/${projectId}/${now}-${safeFilename}`;

  const storageCtx = await resolveStorageToken(env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const fileMeta = {
    fileId, fileName: safeFilename, originalName,
    name: safeFilename, mimeType,
    fileSize: fileBytes.byteLength, size: fileBytes.byteLength,
    storagePath, url: upload.fileUrl, fileUrl: upload.fileUrl,
    projectId, ownerId: access.ownerId, userId: access.ownerId,
    apiKeyId: access.apiKeyId || '', source: 'api_key',
    status: 'published', createdAt: nowIso, updatedAt: nowIso
  };

  const eventId = crypto.randomUUID();
  await fbUpdate({
    [`files/${fileId}`]:                       fileMeta,
    [`projectFiles/${projectId}/${fileId}`]:   fileMeta,
    [`userFiles/${access.ownerId}/${fileId}`]: fileMeta,
    [`userApiActivity/${access.ownerId}/${eventId}`]: {
      id: eventId, ts: now, createdAt: nowIso,
      endpoint: `/api/v1/projects/${projectId}/files/upload`,
      method: 'POST', status: 'success',
      kind: 'file', projectId, fileId, fileName: safeFilename,
      apiKeyId: access.apiKeyId || '', apiKeyName: access.apiKeyName || '',
      source: access.kind
    }
  }, tok, db);

  // Best-effort: storageUsed
  fbGet(`projects/${projectId}/storageUsed`, tok, db)
    .then(used => fbSet(`projects/${projectId}/storageUsed`, (used || 0) + fileBytes.byteLength, tok, db))
    .catch(() => {});

  // Best-effort: API key usage counters
  if (access.kind === 'userKey' && access.apiKeyId) {
    fbUpdate({
      [`userApiKeys/${access.ownerId}/${access.apiKeyId}/calls`]:    Number(access.keyData.calls || 0) + 1,
      [`userApiKeys/${access.ownerId}/${access.apiKeyId}/lastUsed`]: now
    }, tok, db).catch(() => {});
  }

  return jsonRes(ok({ file: fileMeta }, 'Archivo subido correctamente.'), 201);
}

// ═══════════════════════════════════════════════════════════
// BEARER — POST /api/v1/publications/upload
// (acepta user key o project key)
// ═══════════════════════════════════════════════════════════

export async function v1PublicationUpload(request, access, tok, db, env) {
  if (access.kind === 'userKey' && !requirePublicationPermission(access.keyData, 'write')) {
    return jsonRes({ success: false, error: 'PERMISSION_DENIED',
      message: 'Tu API Key no tiene permisos para publicar archivos (publications:write o files:write requerido).' }, 403);
  }

  let form;
  try { form = await request.formData(); }
  catch { return jsonRes(fail('Se esperaba multipart/form-data con campo "file".', 'INVALID_FORM'), 400); }

  const fileInput = form.get('file');
  if (!fileInput || typeof fileInput === 'string')
    return jsonRes(fail('Campo "file" requerido en el body (multipart/form-data).', 'FILE_REQUIRED'), 400);

  const fileBytes = await fileInput.arrayBuffer();
  if (fileBytes.byteLength === 0)      return jsonRes(fail('El archivo está vacío.', 'BAD_REQUEST'), 400);
  if (fileBytes.byteLength > MAX_SIZE) return jsonRes(fail('El archivo supera el límite de 50 MB.', 'FILE_TOO_LARGE'), 413);

  const mimeType     = fileInput.type || 'application/octet-stream';
  const originalName = fileInput.name || 'file';
  const safeFilename = sanitizeUploadName(originalName);

  const now           = Date.now();
  const nowIso        = new Date(now).toISOString();
  const publicationId = crypto.randomUUID();
  const projectId     = access.projectId || (form.get('projectId') || '').trim() || '';

  if (projectId) {
    const project = (access.kind === 'projectKey' && access.projectId === projectId)
      ? (access.project || null)
      : await fbGet(`projects/${projectId}`, tok, db).catch(() => null);
    if (!project) return jsonRes(fail('Proyecto no encontrado.', 'NOT_FOUND'), 404);
    if (project.ownerId !== access.ownerId) {
      return jsonRes(fail('No tienes permiso para publicar en este proyecto.', 'FORBIDDEN'), 403);
    }
  }

  const storagePath = `publications/${access.ownerId}/${projectId || 'general'}/${now}-${safeFilename}`;

  const storageCtx = await resolveStorageToken(env, tok);
  if (storageCtx.errorResponse) return storageCtx.errorResponse;

  const upload = await uploadBytesToStorage(env, storageCtx.storageTok, storagePath, mimeType, fileBytes);
  if (upload.errorResponse) return upload.errorResponse;

  const title       = String(form.get('title') || '').trim().slice(0, 120) || safeFilename;
  const description = String(form.get('description') || '').trim().slice(0, 500);

  const publication = {
    publicationId, id: publicationId, fileId: publicationId,
    fileName: safeFilename, originalName, name: safeFilename,
    title, description, mimeType,
    fileSize: fileBytes.byteLength, size: fileBytes.byteLength,
    storagePath, url: upload.fileUrl, fileUrl: upload.fileUrl,
    projectId: projectId || '',
    ownerId: access.ownerId, userId: access.ownerId,
    apiKeyId: access.apiKeyId || '', apiKeyName: access.apiKeyName || '',
    source: 'api_key', status: 'published',
    createdAt: nowIso, updatedAt: nowIso
  };

  const updates = {
    [`recentPublications/${publicationId}`]:                       publication,
    [`recent_publications/${publicationId}`]:                      publication,
    [`userRecentPublications/${access.ownerId}/${publicationId}`]: publication,
    [`user_recent_publications/${access.ownerId}/${publicationId}`]: publication
  };
  if (projectId) {
    updates[`projectRecentPublications/${projectId}/${publicationId}`]   = publication;
    updates[`project_recent_publications/${projectId}/${publicationId}`] = publication;
  }

  if (access.kind === 'userKey' && access.apiKeyId) {
    updates[`userApiKeys/${access.ownerId}/${access.apiKeyId}/calls`]          = Number(access.keyData.calls || 0) + 1;
    updates[`userApiKeys/${access.ownerId}/${access.apiKeyId}/lastUsed`]       = now;
    updates[`userApiKeys/${access.ownerId}/${access.apiKeyId}/uploadsCount`]   = Number(access.keyData.uploadsCount || 0) + 1;
    updates[`userApiKeys/${access.ownerId}/${access.apiKeyId}/lastUploadAt`]   = nowIso;
    updates[`userApiKeys/${access.ownerId}/${access.apiKeyId}/lastUploadName`] = safeFilename;
  }

  const eventId = crypto.randomUUID();
  updates[`userApiActivity/${access.ownerId}/${eventId}`] = {
    id: eventId, ts: now, createdAt: nowIso,
    endpoint: '/api/v1/publications/upload', method: 'POST', status: 'success',
    kind: 'publication', projectId: projectId || '',
    fileId: publicationId, fileName: safeFilename,
    title, apiKeyId: access.apiKeyId || '',
    apiKeyName: access.apiKeyName || '', source: access.kind
  };

  await fbUpdate(updates, tok, db);
  return jsonRes(ok({ publication }, 'Publicación creada correctamente.'), 201);
}

// ═══════════════════════════════════════════════════════════
// PROJECT KEY — POST /api/v1/request   (action dispatcher)
// ═══════════════════════════════════════════════════════════

async function processAction(action, payload, ctx, tok, db) {
  switch (action) {
    case 'ping': return { pong: true, ts: Date.now(), projectId: ctx.projectId };
    case 'echo': return { echoed: payload };
    case 'store': {
      if (!payload.key) return { error: 'payload.key requerido' };
      const k = String(payload.key).replace(/[./#$[\]]/g, '_').slice(0, 100);
      await fbSet(`projectData/${ctx.projectId}/${k}`, { value: payload.value ?? null, updatedAt: Date.now() }, tok, db);
      return { stored: true, key: k };
    }
    case 'fetch': {
      if (!payload.key) return { error: 'payload.key requerido' };
      const k = String(payload.key).replace(/[./#$[\]]/g, '_').slice(0, 100);
      const data = await fbGet(`projectData/${ctx.projectId}/${k}`, tok, db);
      return { found: data !== null, data };
    }
    default: return { message: `Acción '${action}' recibida.` };
  }
}

export async function v1ProjectRequest(req, kd, tok, db) {
  let body;
  try { body = await req.json(); } catch { return jsonRes(fail('JSON inválido.'), 400); }

  const { projectId, ownerId, project, control } = kd;
  const { action = 'ping', payload = {} } = body;

  const limits = PLAN_LIMITS[control?.plan?.type || 'normal'] || PLAN_LIMITS.normal;
  const today  = new Date().toISOString().slice(0, 10);
  const month  = today.slice(0, 7);
  const usage  = (await fbGet(`apiUsage/${projectId}`, tok, db)) || {};

  if ((usage[today] || 0) >= limits.requestsPerDay)
    return jsonRes(fail(`Límite diario alcanzado (${limits.requestsPerDay}/día).`, 'DAILY_LIMIT_EXCEEDED'), 429);
  if ((usage[month] || 0) >= limits.requestsPerMonth)
    return jsonRes(fail(`Límite mensual alcanzado (${limits.requestsPerMonth}/mes).`, 'MONTHLY_LIMIT_EXCEEDED'), 429);

  await fbUpdate({
    [`apiUsage/${projectId}/${today}`]: (usage[today] || 0) + 1,
    [`apiUsage/${projectId}/${month}`]: (usage[month] || 0) + 1
  }, tok, db);

  const result = await processAction(action, payload, { projectId, ownerId, project }, tok, db);
  return jsonRes(ok({
    action, result,
    usage: { today: (usage[today] || 0) + 1, month: (usage[month] || 0) + 1, limits }
  }, `Acción '${action}' ejecutada correctamente.`));
}

// ═══════════════════════════════════════════════════════════
// PROJECT KEY — GET /api/v1/status
// ═══════════════════════════════════════════════════════════

export async function v1ProjectStatus(kd, tok, db) {
  const { projectId, project, control } = kd;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const usage = (await fbGet(`apiUsage/${projectId}`, tok, db)) || {};
  const limits = PLAN_LIMITS[control?.plan?.type || 'normal'] || PLAN_LIMITS.normal;
  return jsonRes(ok({
    project: { id: projectId, name: project.name },
    plan:    control?.plan?.type || 'normal',
    usage:   { today: usage[today] || 0, month: usage[month] || 0, limits }
  }));
}
