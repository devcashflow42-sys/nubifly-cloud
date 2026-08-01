/**
 * functions/_lib/models.js
 *
 * Convierte filas de PostgreSQL a los objetos con la MISMA forma que usaba
 * el código con Firebase (control.ban.isBanned, project.ownerId, etc.), para
 * que los endpoints cambien lo mínimo. También expone helpers de escritura.
 */

// control_users → forma anidada estilo Firebase
export function rowToControl(r) {
  if (!r) return null;
  return {
    uid:           r.uid,
    accountStatus: r.account_status,
    role:          r.role,
    plan: {
      type:        r.plan_type,
      isPremium:   r.is_premium,
      purchasedAt: r.plan_purchased_at,
      amountPaid:  r.plan_amount_paid,
      currency:    r.plan_currency,
      stripe:      r.plan_stripe || {}
    },
    limits: {
      maxApiKeys:      r.max_api_keys,
      monthlyRequests: r.monthly_requests,
      maxFileSizeMB:   r.max_file_size_mb
    },
    security: {
      passwordHash:      r.password_hash,
      loginAttempts:     r.login_attempts,
      lastFailedAttempt: r.last_failed_attempt,
      lastLogin:         r.last_login,
      lastIp:            r.last_ip,
      deviceCount:       r.device_count,
      twoFactorEnabled:  r.two_factor_enabled,
      twoFactorSecret:   r.two_factor_secret
    },
    suspension: {
      isSuspended: r.susp_is_suspended,
      reason:      r.susp_reason,
      until:       r.susp_until,
      createdAt:   r.susp_created_at
    },
    ban: {
      isBanned:  r.ban_is_banned,
      reason:    r.ban_reason,
      createdAt: r.ban_created_at
    },
    permissions:  r.permissions  || {},
    verification: r.verification || {},
    moderation:   r.moderation   || {},
    createdAt:    r.created_at,
    updatedAt:    r.updated_at
  };
}

// users → objeto de perfil
export function rowToUser(r) {
  if (!r) return null;
  const base = {
    uid:       r.uid,
    type:      r.type,
    name:      r.name,
    username:  r.username,
    email:     r.email,
    avatar:    r.avatar,
    banner:    r.banner,
    bio:       r.bio,
    birthday:  r.birthday,
    location:  r.location,
    website:   r.website,
    isOnline:  r.is_online,
    lastSeen:  r.last_seen,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  // invitados: fusiona los datos guardados en guest_data (permissions, guest, etc.)
  return r.guest_data ? { ...base, ...r.guest_data } : base;
}

// projects → { projectId, ownerId, ... }
export function rowToProject(r) {
  if (!r) return null;
  return {
    projectId:   r.project_id,
    id:          r.project_id,
    ownerId:     r.owner_id,
    name:        r.name,
    description: r.description,
    tags:        r.tags || [],
    deadline:    r.deadline,
    access:      r.access,
    apiKey:      r.api_key,
    storageUsed: r.storage_used,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at
  };
}

// files → fileMeta (misma forma que devolvía el upload)
export function rowToFile(r) {
  if (!r) return null;
  return {
    fileId:       r.file_id,
    id:           r.file_id,
    ownerId:      r.owner_id,
    userId:       r.owner_id,
    projectId:    r.project_id || '',
    fileName:     r.file_name,
    originalName: r.original_name,
    name:         r.file_name,
    title:        r.title,
    description:  r.description,
    author:       r.author,
    mediaType:    r.media_type,
    mimeType:     r.mime_type,
    coverUrl:     r.cover_url,
    url:          r.url,
    fileUrl:      r.url,
    storagePath:  r.storage_path,
    fileSize:     r.file_size,
    size:         r.file_size,
    source:       r.source,
    status:       r.status,
    visibility:   r.visibility,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at
  };
}

// user_api_keys → forma usada por la app
export function rowToApiKey(r) {
  if (!r) return null;
  return {
    keyId:         r.key_id,
    id:            r.key_id,
    name:          r.name,
    key:           r.api_key,
    active:        r.active,
    perm:          r.perm,
    permissions:   r.permissions || {},
    projectId:     r.project_id || '',
    calls:         r.calls,
    uploadsCount:  r.uploads_count,
    lastUsed:      r.last_used,
    lastUploadAt:  r.last_upload_at,
    lastUploadName:r.last_upload_name,
    createdAt:     r.created_at
  };
}
