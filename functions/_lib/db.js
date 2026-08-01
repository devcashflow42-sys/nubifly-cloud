/**
 * functions/_lib/db.js
 *
 * Capa de acceso a PostgreSQL para Cloudflare Pages Functions.
 * Reemplaza a firebase.js. Usa el driver postgres.js sobre la conexión
 * definida en la variable de entorno DATABASE_URL (cualquier proveedor).
 *
 * Requisitos en Cloudflare Pages:
 *   - Compatibility flag: nodejs_compat  (Settings → Functions)
 *   - Variable de entorno: DATABASE_URL  (cadena de conexión, de preferencia
 *     la de "pooler"/pgbouncer del proveedor para menos conexiones)
 *   - Dependencia "postgres" en package.json (Pages la empaqueta sola)
 *
 * Uso típico (el middleware crea el cliente y lo cierra tras la respuesta):
 *   const sql = getDb(env);
 *   const rows = await sql`select * from users where uid = ${uid}`;
 *   const user = rows[0] || null;
 */
import postgres from 'postgres';

// Crea un cliente Postgres para ESTA petición.
// max:1 y prepare:false → compatible con poolers (pgbouncer) y con el
// modelo de peticiones cortas del edge.
export function getDb(env) {
  if (!env || !env.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurado');
  }
  return postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false,
    fetch_types: false,
    idle_timeout: 20,
    connect_timeout: 15
  });
}

// Cierra el cliente sin lanzar (para usar con context.waitUntil).
export async function endDb(sql) {
  try { if (sql) await sql.end({ timeout: 5 }); } catch { /* ignore */ }
}

// ¿Este email es el administrador configurado en la variable ADMIN_EMAIL?
export function isAdminEmail(env, email) {
  const admin = String(env && env.ADMIN_EMAIL || '').trim().toLowerCase();
  const e     = String(email || '').trim().toLowerCase();
  return !!admin && !!e && admin === e;
}

// ── Helpers de conveniencia ────────────────────────────────────────────────

// Primera fila o null.
export async function one(rows) {
  return (rows && rows.length) ? rows[0] : null;
}

// Ejecuta un bloque dentro de una transacción.
export async function tx(sql, fn) {
  return sql.begin(fn);
}
