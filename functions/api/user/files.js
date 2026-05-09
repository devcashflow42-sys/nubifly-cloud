/**
 * GET /api/user/files — todos los archivos que el usuario haya subido.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const data = await fbGet(`userFiles/${user.uid}`, tok, db);
  const toTs = f => f.createdAt ? new Date(f.createdAt).getTime() : (f.uploadedAt || 0);
  const files = data
    ? Object.entries(data).map(([id, f]) => ({ id, ...f })).sort((a, b) => toTs(b) - toTs(a))
    : [];
  return jsonRes(ok({ files }));
}
