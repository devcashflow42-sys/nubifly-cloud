/**
 * functions/_lib/notifications.js
 *
 * Lógica interna de creación de notificaciones — sin push externo.
 * El backend solo persiste; la app Android consulta en polling y crea
 * la notificación local con NotificationManager.
 *
 * PostgreSQL:
 *   user_inbox        — notificaciones por usuario
 *   user_milestones   — flags antispam de logros (uid, milestone_key)
 *   notifications     — broadcasts globales
 *
 * Exports públicos:
 *   notifVigente(item)                 — helper de filtrado por expira
 *   crearNotificacionLogro(...)        — logros con antispam
 *   crearNotificacionUsuario(...)      — notificaciones sociales
 *   crearAvisoSistema(...)             — avisos automáticos
 */

// ── Hitos de número redondo ───────────────────────────────────────────────────
const HITOS = [10, 50, 100, 500, 1000, 5000];

// ── Helper: ID único de notificación ─────────────────────────────────────────
function newNotifId() {
  return `n_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Devuelve true si la notificación no ha expirado.
 * null en expira = sin expiración = siempre vigente.
 */
export function notifVigente(item) {
  if (!item) return false;
  if (!item.expira) return true;
  return item.expira > Date.now();
}

// ── Helper interno: persistir en user_inbox ──────────────────────────────────
async function guardarEnInbox(userId, campos, sql) {
  const id  = newNotifId();
  const now = Date.now();
  await sql`
    insert into user_inbox
      (notif_id, uid, tipo, nivel, origen, emisor, titulo, mensaje, accion, recurso_id, leida, expira, created_at)
    values
      (${id}, ${userId}, ${campos.tipo || null}, ${campos.nivel || null}, ${campos.origen || null},
       ${campos.emisor || null}, ${campos.titulo || null}, ${campos.mensaje || null}, ${campos.accion || null},
       ${campos.recursoId || null}, false, ${campos.expira || null}, ${now})
  `;
  return id;
}

// ── Helper interno: comprobar/marcar un hito (antispam) ──────────────────────
// Devuelve true si el hito YA existía (bloquea), false si lo creó ahora.
async function hitoYaMarcado(userId, milestoneKey, sql) {
  const res = await sql`
    insert into user_milestones (uid, milestone_key, achieved)
    values (${userId}, ${milestoneKey}, true)
    on conflict (uid, milestone_key) do nothing
  `;
  return res.count === 0; // 0 filas insertadas = ya existía
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGROS  —  antispam con flags en user_milestones
// ─────────────────────────────────────────────────────────────────────────────

const LOGRO_META = {
  primer_archivo: {
    titulo:  '¡Primer archivo subido!',
    mensaje: 'Has subido tu primer archivo. ¡Bienvenido a Nubifly!',
    accion:  'open_files'
  },
  primer_proyecto: {
    titulo:  '¡Primer proyecto creado!',
    mensaje: 'Has creado tu primer proyecto. Comienza a organizar tus archivos.',
    accion:  'open_projects'
  }
};

function hitoMeta(dominio, count) {
  const labels = { hito_archivos: 'archivos subidos', hito_proyectos: 'proyectos creados' };
  const accion  = dominio === 'hito_archivos' ? 'open_files' : 'open_projects';
  return {
    titulo:  `¡${count} ${labels[dominio] || 'elementos'}!`,
    mensaje: `Alcanzaste ${count} ${labels[dominio] || 'elementos'} en Nubifly. ¡Sigue así!`,
    accion
  };
}

/**
 * Crea una notificación de logro. Incluye antispam:
 * - primer_archivo / primer_proyecto → solo una vez por usuario
 * - hito_archivos / hito_proyectos   → solo si count está en HITOS y no fue notificado antes
 *
 * @param {string} userId
 * @param {string} tipo       'primer_archivo' | 'primer_proyecto' | 'hito_archivos' | 'hito_proyectos'
 * @param {string|null} recursoId
 * @param {import('postgres').Sql} sql
 * @param {number} count      Requerido para hito_archivos / hito_proyectos
 * @returns {string|null}     ID de la notificación creada, null si antispam bloqueó
 */
export async function crearNotificacionLogro(userId, tipo, recursoId, sql, count = 0) {
  try {
    // ── Primer archivo ────────────────────────────────────────────────────────
    if (tipo === 'primer_archivo') {
      if (await hitoYaMarcado(userId, 'primerArchivoNotif', sql)) return null;
      return guardarEnInbox(userId, {
        tipo: 'logro', nivel: 'success', origen: 'sistema', emisor: 'sistema',
        recursoId: recursoId || null, expira: null, ...LOGRO_META.primer_archivo
      }, sql);
    }

    // ── Primer proyecto ───────────────────────────────────────────────────────
    if (tipo === 'primer_proyecto') {
      if (await hitoYaMarcado(userId, 'primerProyectoNotif', sql)) return null;
      return guardarEnInbox(userId, {
        tipo: 'logro', nivel: 'success', origen: 'sistema', emisor: 'sistema',
        recursoId: recursoId || null, expira: null, ...LOGRO_META.primer_proyecto
      }, sql);
    }

    // ── Hitos numéricos ───────────────────────────────────────────────────────
    if (tipo === 'hito_archivos' || tipo === 'hito_proyectos') {
      if (!HITOS.includes(count)) return null; // no es un número redondo
      const flagNode = tipo === 'hito_archivos' ? 'hitosArchivos' : 'hitosProyectos';
      if (await hitoYaMarcado(userId, `${flagNode}_${count}`, sql)) return null;
      return guardarEnInbox(userId, {
        tipo: 'logro', nivel: 'success', origen: 'sistema', emisor: 'sistema',
        recursoId: recursoId || null, expira: null, ...hitoMeta(tipo, count)
      }, sql);
    }

    console.warn('[notifications] crearNotificacionLogro: tipo desconocido:', tipo);
    return null;

  } catch (e) {
    console.error('[notifications] crearNotificacionLogro error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// USUARIO → USUARIO  (vista, compartido, like)
// ─────────────────────────────────────────────────────────────────────────────

const SOCIAL_META = {
  vista: {
    nivel: 'info',
    titulo:  'Alguien vio tu publicación',
    mensaje: 'Un usuario visitó tu publicación.',
    accion:  'open_publication'
  },
  compartido: {
    nivel: 'info',
    titulo:  'Publicación compartida',
    mensaje: 'Alguien compartió tu publicación.',
    accion:  'open_publication'
  },
  like: {
    nivel: 'success',
    titulo:  '¡Te dieron like!',
    mensaje: 'A alguien le gustó tu publicación.',
    accion:  'open_publication'
  }
};

/**
 * Crea una notificación social de usuario a usuario.
 * 1 documento en user_inbox del destinatario; el emisor no recibe copia.
 *
 * @param {string} destinatarioId
 * @param {string} emisorId
 * @param {string} tipo           'vista' | 'compartido' | 'like'
 * @param {string|null} recursoId ID de la publicación/archivo
 * @param {import('postgres').Sql} sql
 * @returns {string|null}
 */
export async function crearNotificacionUsuario(destinatarioId, emisorId, tipo, recursoId, sql) {
  try {
    const meta = SOCIAL_META[tipo];
    if (!meta) {
      console.warn('[notifications] crearNotificacionUsuario: tipo desconocido:', tipo);
      return null;
    }
    return guardarEnInbox(destinatarioId, {
      tipo: 'social', nivel: meta.nivel, origen: 'usuario',
      titulo: meta.titulo, mensaje: meta.mensaje, accion: meta.accion,
      recursoId: recursoId || null, emisor: emisorId,
      expira: null
    }, sql);
  } catch (e) {
    console.error('[notifications] crearNotificacionUsuario error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS AUTOMÁTICOS DEL SISTEMA
// (almacenamiento, seguridad, etc.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un aviso del sistema para un usuario específico.
 *
 * @param {string}      userId
 * @param {string}      nivel      'info' | 'warning' | 'error'
 * @param {string}      titulo
 * @param {string}      mensaje
 * @param {number|null} expiraMs   Timestamp ms de expiración, null = permanente
 * @param {import('postgres').Sql} sql
 * @returns {string|null}
 */
export async function crearAvisoSistema(userId, nivel, titulo, mensaje, expiraMs, sql) {
  try {
    return guardarEnInbox(userId, {
      tipo: 'aviso', nivel, origen: 'sistema',
      titulo, mensaje, accion: 'open_settings',
      recursoId: null, emisor: 'sistema',
      expira: expiraMs || null
    }, sql);
  } catch (e) {
    console.error('[notifications] crearAvisoSistema error:', e.message);
    return null;
  }
}
