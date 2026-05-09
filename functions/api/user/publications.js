/**
 * GET /api/user/publications
 *
 * Devuelve las publicaciones subidas vía /api/v1/publications/upload.
 * Lee del índice user-scoped (rápido) y, si está vacío, hace fallback
 * a un escaneo del nodo global filtrando por ownerId/userId.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const toTs = (item) => item?.createdAt
    ? new Date(item.createdAt).getTime()
    : (item?.updatedAt || 0);

  const collected = new Map();   // id → publication

  // 1. Índices user-scoped (fast path)
  for (const key of [`user_recent_publications/${user.uid}`, `userRecentPublications/${user.uid}`]) {
    try {
      const data = await fbGet(key, tok, db);
      if (data && typeof data === 'object') {
        for (const [id, item] of Object.entries(data)) {
          if (!collected.has(id)) collected.set(id, { id, ...item });
        }
      }
    } catch (err) {
      console.warn(`[handleListUserPublications] read ${key} failed:`, err.message);
    }
  }

  // 2. Fallback al nodo global (filtrar por ownerId/userId)
  if (!collected.size) {
    for (const key of ['recent_publications', 'recentPublications']) {
      try {
        const data = await fbGet(key, tok, db);
        if (data && typeof data === 'object') {
          for (const [id, item] of Object.entries(data)) {
            const owner = item?.ownerId || item?.userId || '';
            if (owner === user.uid && !collected.has(id)) {
              collected.set(id, { id, ...item });
            }
          }
        }
      } catch (err) {
        console.warn(`[handleListUserPublications] scan ${key} failed:`, err.message);
      }
    }
  }

  const publications = Array.from(collected.values())
    .sort((a, b) => toTs(b) - toTs(a))
    .slice(0, 50);

  return jsonRes(ok({ publications, count: publications.length }));
}
