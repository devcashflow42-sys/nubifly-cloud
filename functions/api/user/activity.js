/**
 * GET /api/user/activity
 *
 * Lee userApiActivity/<uid>/<eventId> escrito por los handlers v1 de upload
 * y devuelve los últimos 100 eventos ordenados desc por timestamp.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let data = await fbGet(`userApiActivity/${user.uid}`, tok, db).catch(() => null);
  if (!data || typeof data !== 'object') data = {};

  const activity = Object.entries(data)
    .map(([id, ev]) => ({ id, ...ev }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 100);

  return jsonRes(ok({ activity, count: activity.length }));
}
