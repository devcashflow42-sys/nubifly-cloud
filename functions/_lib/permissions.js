/**
 * functions/_lib/permissions.js
 *
 * Utilidades de permisos para User API Keys.
 *
 *   resource : 'posts' | 'categories' | 'images' | 'videos' | 'files'
 *              | 'analytics' | 'projects' | 'publications'
 *   level    : 'read' | 'write'   ('write' implica 'read')
 */

export function requirePermission(keyData, resource, level) {
  const preset = keyData.perm;
  if (preset === 'all')  return true;
  if (preset === 'none') return false;
  if (preset === 'read') return level === 'read';
  // Granular per-resource object
  const perm = (keyData.permissions || {})[resource];
  if (!perm || perm === 'none') return false;
  if (level === 'read')  return perm === 'read' || perm === 'write';
  if (level === 'write') return perm === 'write';
  return false;
}

export function buildDefaultPermissions(preset) {
  const resources = ['posts', 'categories', 'images', 'videos', 'files', 'publications', 'analytics', 'projects'];
  const level = preset === 'all' ? 'write' : preset === 'read' ? 'read' : 'none';
  return Object.fromEntries(resources.map(r => [r, level]));
}

export function requireProjectUploadPermission(keyData) {
  return requirePermission(keyData, 'files', 'write')
      || requirePermission(keyData, 'projects', 'write');
}

export function requirePublicationPermission(keyData, level = 'write') {
  return requirePermission(keyData, 'publications', level)
      || requirePermission(keyData, 'files', level);
}
