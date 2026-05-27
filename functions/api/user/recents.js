/**
 * GET /api/user/recents
 *
 * Feed unificado de recientes del usuario autenticado.
 * Combina proyectos y publicaciones ordenados por fecha descendente
 * (el más nuevo primero). Devuelve TODOS los elementos, sin límite.
 *
 * Query params opcionales:
 *   ?type=project      → solo proyectos
 *   ?type=publication  → solo publicaciones
 *   (sin type)         → ambos tipos mezclados
 */
import { requireAuth }     from '../../_lib/auth.js';
import { fbGet, fbUpdate } from '../../_lib/firebase.js';
import { jsonRes, ok }     from '../../_lib/response.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte cualquier valor de fecha (timestamp numérico o string ISO) a ms */
function toTs(v) {
  if (!v) return 0;
  const n = typeof v === 'number' ? v : new Date(v).getTime();
  return isNaN(n) ? 0 : n;
}

/** Elige el timestamp más reciente entre updatedAt y createdAt del item */
function itemTs(item) {
  return Math.max(toTs(item.updatedAt), toTs(item.createdAt));
}

// ── Fetchers (misma lógica que los endpoints originales) ──────────────────────

/**
 * Obtiene los proyectos del usuario.
 * Lógica idéntica a GET /api/projects (fast path + fallback + backfill).
 */
async function fetchProjects(user, tok, db) {
  let data = await fbGet(`userProjects/${user.uid}`, tok, db).catch(() => null);

  if (!data) {
    const all = await fbGet('projects', tok, db).catch(() => null);
    if (all) {
      const owned = {};
      for (const [id, p] of Object.entries(all)) {
        if (p && p.ownerId === user.uid) owned[id] = p;
      }
      if (Object.keys(owned).length > 0) {
        const backfill = {};
        for (const [id, p] of Object.entries(owned)) {
          backfill[`userProjects/${user.uid}/${id}`] = p;
        }
        await fbUpdate(backfill, tok, db).catch(() => {});
        data = owned;
      }
    }
  }

  if (!data) return [];
  return Object.entries(data).map(([id, p]) => ({ type: 'project', id, ...p }));
}

/**
 * Obtiene las publicaciones del usuario.
 * Lógica idéntica a GET /api/user/publications (dual-index + fallback global).
 */
async function fetchPublications(user, tok, db) {
  const collected = new Map();

  // 1. Índices user-scoped (fast path)
  for (const key of [`user_recent_publications/${user.uid}`, `userRecentPublications/${user.uid}`]) {
    try {
      const data = await fbGet(key, tok, db);
      if (data && typeof data === 'object') {
        for (const [id, item] of Object.entries(data)) {
          if (!collected.has(id)) collected.set(id, { type: 'publication', id, ...item });
        }
      }
    } catch (err) {
      console.warn(`[recents] read ${key} failed:`, err.message);
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
              collected.set(id, { type: 'publication', id, ...item });
            }
          }
        }
      } catch (err) {
        console.warn(`[recents] scan ${key} failed:`, err.message);
      }
    }
  }

  return Array.from(collected.values());
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  const url       = new URL(context.request.url);
  const typeParam = (url.searchParams.get('type') || '').trim().toLowerCase();

  const wantProjects     = !typeParam || typeParam === 'project';
  const wantPublications = !typeParam || typeParam === 'publication';

  // Ambas consultas en paralelo; si el tipo no aplica se resuelve de inmediato
  const [projects, publications] = await Promise.all([
    wantProjects     ? fetchProjects(user, tok, db)     : Promise.resolve([]),
    wantPublications ? fetchPublications(user, tok, db) : Promise.resolve([]),
  ]);

  // Combinar y ordenar por fecha descendente (sin límite)
  const recents = [...projects, ...publications]
    .sort((a, b) => itemTs(b) - itemTs(a));

  return jsonRes(ok({ recents, count: recents.length }));
}
