/**
 * GET /api/user/publications
 *
 * Devuelve las publicaciones subidas vía /api/v1/publications/upload
 * y /api/user/files.
 *
 * ── Modos ──────────────────────────────────────────────────────────────────
 *  • ?projectId=XXX  → archivos de ESE proyecto, leídos del índice exacto
 *                      `projectFiles/{projectId}` (conteo fiable, sin tope).
 *  • (sin projectId) → feed reciente del usuario (índice user-scoped, máx. 50).
 *
 * El filtrado por proyecto se añadió porque antes el endpoint ignoraba el
 * parámetro y devolvía los recientes globales, lo que hacía que el contador
 * "N archivos" mostrara el total del usuario en todos los proyectos.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const url       = new URL(context.request.url);
  const projectId = (url.searchParams.get('projectId') || '').trim();

  const toTs = (item) => item?.createdAt
    ? new Date(item.createdAt).getTime()
    : (item?.updatedAt || 0);

  // ── MODO A: filtrado por proyecto ─────────────────────────────────────────
  // Lee del índice por proyecto `projectFiles/{projectId}` que mantienen
  // files.js y v1-handlers.js. Devuelve TODOS los archivos del proyecto
  // (sin recorte a 50), filtrando por dueño como defensa de seguridad:
  // si llega un projectId ajeno, no se filtra nada del usuario → lista vacía.
  if (projectId) {
    const filesData = await fbGet(`projectFiles/${projectId}`, tok, db).catch(() => null);

    const publications = (filesData && typeof filesData === 'object')
      ? Object.entries(filesData)
          .map(([id, item]) => ({ id, ...item }))
          .filter(p => (p.ownerId || p.userId || '') === user.uid)
          .sort((a, b) => toTs(b) - toTs(a))
      : [];

    return jsonRes(ok({ publications, count: publications.length }));
  }

  // ── MODO B: feed reciente del usuario (comportamiento original) ────────────
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
