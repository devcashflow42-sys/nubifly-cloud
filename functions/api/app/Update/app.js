/**
 * GET  /api/app/Update/app          — estado y versión de la aplicación
 * GET  /api/app/Update/app?version= — comparar versión del cliente
 * POST /api/app/Update/app          — publicar nueva versión / cambiar estado
 *
 * GET responde:
 *   - Si hay mantenimiento:  503 + code APP_MAINTENANCE
 *   - Si está suspendida:    503 + code APP_SUSPENDED
 *   - Si hay actualización:  200 + updateRequired:true
 *   - Si está al día:        200 + updateRequired:false
 *
 * POST (requiere Authorization: Bearer <APP_ADMIN_SECRET>):
 *   Body (todos opcionales): { version, maintenance, suspension, appUrl }
 *
 * Datos en PostgreSQL (context.data.sql). La tabla app_config tiene UNA sola
 * fila (id = 1, garantizado por CHECK). Si no existe, se auto-crea con defaults.
 */
import { jsonRes, fail } from '../../../_lib/response.js';

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

// Lee la única fila de configuración; la crea con defaults si aún no existe.
async function loadConfig(sql) {
  let row = (await sql`select * from app_config where id = 1`)[0];
  if (!row) {
    const now = Date.now();
    await sql`
      insert into app_config (id, version, app_url, maintenance, suspension, downloads, created_at, updated_at)
      values (1, ${DEFAULT_CONFIG.version}, ${DEFAULT_CONFIG.appUrl}, false, false, 0, ${now}, ${now})
      on conflict (id) do nothing`;
    row = (await sql`select * from app_config where id = 1`)[0];
  }
  return row;
}

export async function onRequestGet(context) {
  const { request } = context;
  const { sql } = context.data;

  const clientVersion = new URL(request.url).searchParams.get('version') || null;

  let config;
  try { config = await loadConfig(sql); }
  catch (e) {
    console.error('[app/Update] loadConfig:', e.message);
    return jsonRes(fail('Error al leer configuración.', 'DB_ERROR'), 500);
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
      maintenance: config.maintenance ?? false,
      suspension:  config.suspension  ?? false,
      appUrl:      config.app_url      || DEFAULT_CONFIG.appUrl,
      downloads:   Number(config.downloads) || 0
    }
  });
}

// ── POST /api/app/Update/app — publicar nueva versión ────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;
  const { sql } = context.data;

  // ── Autenticación con APP_ADMIN_SECRET ────────────────────────────────
  const adminSecret = env.APP_ADMIN_SECRET;
  if (!adminSecret) {
    return jsonRes(fail('APP_ADMIN_SECRET no configurado en el servidor.', 'CONFIG_ERROR'), 503);
  }
  const auth   = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (bearer !== adminSecret) {
    return jsonRes(fail('No autorizado.', 'UNAUTHORIZED'), 401);
  }

  // ── Leer body ─────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('Body JSON inválido.', 'BAD_REQUEST'), 400); }

  const { version, maintenance, suspension, appUrl } = body || {};

  // ── Validaciones básicas ──────────────────────────────────────────────
  if (version !== undefined && (typeof version !== 'string' || !version.trim())) {
    return jsonRes(fail('version debe ser un string no vacío.', 'INVALID_VERSION'), 400);
  }
  if (maintenance !== undefined && typeof maintenance !== 'boolean') {
    return jsonRes(fail('maintenance debe ser boolean.', 'INVALID_FIELD'), 400);
  }
  if (suspension !== undefined && typeof suspension !== 'boolean') {
    return jsonRes(fail('suspension debe ser boolean.', 'INVALID_FIELD'), 400);
  }
  if (appUrl !== undefined && (typeof appUrl !== 'string' || !appUrl.startsWith('http'))) {
    return jsonRes(fail('appUrl debe ser una URL válida.', 'INVALID_URL'), 400);
  }

  // ── Asegurar que la fila existe y aplicar solo los campos enviados ─────
  let updated;
  try {
    await loadConfig(sql);
    const now = Date.now();
    updated = (await sql`
      update app_config set
        version     = coalesce(${version     !== undefined ? version.trim() : null}, version),
        maintenance = coalesce(${maintenance !== undefined ? maintenance    : null}, maintenance),
        suspension  = coalesce(${suspension  !== undefined ? suspension     : null}, suspension),
        app_url     = coalesce(${appUrl      !== undefined ? appUrl         : null}, app_url),
        updated_at  = ${now}
      where id = 1
      returning *`)[0];
  } catch (e) {
    console.error('[app/Update POST] update:', e.message);
    return jsonRes(fail('Error al guardar configuración.', 'DB_ERROR'), 500);
  }

  return jsonRes({
    success: true,
    message: 'Configuración actualizada correctamente.',
    data: {
      version:     updated.version,
      maintenance: updated.maintenance,
      suspension:  updated.suspension,
      appUrl:      updated.app_url,
      downloads:   Number(updated.downloads) || 0,
      updatedAt:   updated.updated_at
    }
  });
}
