/**
 * GET /api/health/db — diagnóstico de la base de datos PostgreSQL.
 * Abre nubifly.com/api/health/db para ver el estado real (sin exponer secretos).
 */
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { sql } = context.data;

  const out = {
    env: {
      DATABASE_URL: !!env.DATABASE_URL,
      JWT_SECRET:   !!env.JWT_SECRET,
      ADMIN_EMAIL:  env.ADMIN_EMAIL || null,
      APP_SECRET:   !!env.APP_SECRET
    },
    connect: false,
    schema:  false,
    users:   null
  };

  // ¿Conecta?
  try {
    await sql`select 1 as ok`;
    out.connect = true;
  } catch (e) {
    out.connectError = e.message;
    return jsonRes(ok(out, 'No se pudo conectar a la base de datos.'));
  }

  // ¿Existe el esquema? (tabla users)
  try {
    const r = await sql`select count(*)::int as n from users`;
    out.schema = true;
    out.users  = r[0].n;
  } catch (e) {
    out.schemaError = e.message;
    return jsonRes(ok(out, 'Conectó, pero falta correr db/schema.sql (no existe la tabla users).'));
  }

  return jsonRes(ok(out, 'Base de datos OK.'));
}
