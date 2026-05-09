/**
 * GET /api/user/dashboard
 *
 * Resumen rápido: # de proyectos, # de archivos y storage usado.
 */
import { requireAuth } from '../../_lib/auth.js';
import { fbGet }       from '../../_lib/firebase.js';
import { jsonRes, ok } from '../../_lib/response.js';

export async function onRequestGet(context) {
  const { user, errorResponse } = await requireAuth(context.request, context.env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  // Read from all paths where files/publications can land (API key vs dashboard upload)
  const [projData, filesData, pubData, pubData2] = await Promise.all([
    fbGet(`userProjects/${user.uid}`,              tok, db),
    fbGet(`userFiles/${user.uid}`,                 tok, db),
    fbGet(`userRecentPublications/${user.uid}`,    tok, db),
    fbGet(`user_recent_publications/${user.uid}`,  tok, db)
  ]);

  const seen = new Map();
  for (const src of [filesData, pubData, pubData2]) {
    if (src && typeof src === 'object') {
      for (const [id, f] of Object.entries(src)) {
        if (!seen.has(id) && f && typeof f === 'object') seen.set(id, f);
      }
    }
  }

  const files = Array.from(seen.values());
  return jsonRes(ok({
    projectCount: projData ? Object.keys(projData).length : 0,
    fileCount:    files.length,
    storageUsed:  files.reduce((s, f) => s + (f.fileSize || f.size || 0), 0)
  }));
}
