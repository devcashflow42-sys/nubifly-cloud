/**
 * GET /api/health
 *
 * Comprueba que el worker está vivo y que la conexión a Firebase funciona.
 */
import { fbGet }  from '../_lib/firebase.js';
import { jsonRes } from '../_lib/response.js';

export async function onRequestGet(context) {
  const { tok, db } = context.data;
  let firebase = 'ok';
  try {
    await fbGet('_healthcheck_', tok, db);
  } catch (err) {
    firebase = err.message;
  }
  const allOk = firebase === 'ok';
  return jsonRes({
    success: allOk,
    message: allOk ? '🚀 Nubifly Cloud API is running' : '⚠️ API running pero Firebase tiene error',
    firebase,
    database_url: db,
    ts: Date.now()
  }, allOk ? 200 : 503);
}
