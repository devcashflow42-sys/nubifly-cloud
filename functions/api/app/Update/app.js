/**
 * GET /api/app/Update/app — estado y versión de la aplicación
 *
 * Query: ?version=1.0  (versión instalada para comparar)
 *
 * Responde:
 *   - Si hay mantenimiento:  503 + code APP_MAINTENANCE
 *   - Si está suspendida:    503 + code APP_SUSPENDED
 *   - Si hay actualización:  200 + updateRequired:true
 *   - Si está al día:        200 + updateRequired:false
 *
 * Auto-crea appConfig en Firebase si no existe (solo la primera vez).
 */
import { fbGet, fbUpdate } from '../../../../_lib/firebase.js';
import { jsonRes, fail }   from '../../../../_lib/response.js';

const DEFAULT_CONFIG = {
  version:     '1.0',
  maintenance: false,
  suspension:  false,
  appUrl:      'https://nubifly.com/app.apk',
  downloads:   0
};

function compareVersions(server, client) {
  const pa = String(server || '0').split('.').map(Number);
  const pb = String(client || '0').split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff; // >0 → server newer
  }
  return 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db } = context.data;

  const clientVersion = new URL(request.url).searchParams.get('version') || null;

  // ── Leer appConfig; crear con defaults si no existe ───────────────────
  let config;
  try { config = await fbGet('appConfig', tok, db); }
  catch (e) {
    console.error('[app/Update] fbGet:', e.message);
    return jsonRes(fail('Error al leer configuración.', 'DB_ERROR'), 500);
  }

  if (!config) {
    const now = Date.now();
    config = { ...DEFAULT_CONFIG, createdAt: now, updatedAt: now };
    try { await fbUpdate({ appConfig: config }, tok, db); }
    catch (e) { console.warn('[app/Update] no se pudo crear appConfig:', e.message); }
  }

  // ── Chequeo de suspensión y mantenimiento ─────────────────────────────
  if (config.suspension) {
    return jsonRes({
      success: false,
      code:    'APP_SUSPENDED',
      message: 'La aplicación está suspendida temporalmente.'
    }, 503);
  }

  if (config.maintenance) {
    return jsonRes({
      success: false,
      code:    'APP_MAINTENANCE',
      message: 'La aplicación está en mantenimiento temporalmente.'
    }, 503);
  }

  // ── Comparación de versión ────────────────────────────────────────────
  const serverVersion = config.version || DEFAULT_CONFIG.version;
  let updateRequired  = false;
  let message         = 'La aplicación está actualizada.';

  if (clientVersion !== null) {
    updateRequired = compareVersions(serverVersion, clientVersion) > 0;
    if (updateRequired) message = 'Hay una nueva versión disponible.';
  }

  return jsonRes({
    success: true,
    updateRequired,
    message,
    data: {
      version:     serverVersion,
      maintenance: config.maintenance  ?? false,
      suspension:  config.suspension   ?? false,
      appUrl:      config.appUrl       || DEFAULT_CONFIG.appUrl,
      downloads:   config.downloads    || 0
    }
  });
}
