/**
 * functions/_lib/helpers.js
 *
 * Helpers pequeños sin dependencias.
 */

export const toEmailKey    = (e) => e.trim().toLowerCase().replace(/\./g, ',');
export const toEmailNormal = (e) => e.trim().toLowerCase();

export function encodeApiKey(key) {
  return key.replace(/\./g, '__DOT__').replace(/\//g, '__SL__');
}

export function generateApiKey() {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  return 'nf_live_' + Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sanitiza un nombre de archivo conservando el subset ASCII seguro.
export function sanitizeUploadName(originalName) {
  const extMatch = originalName.match(/(\.[^.]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const baseName = originalName.replace(/\.[^.]+$/, '');
  const sanitized = baseName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-. ]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .slice(0, 100) || 'file';
  return sanitized + ext;
}
