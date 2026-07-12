'use strict';

// ═══════════════════════════════════════════════════════════════
// ║  CONFIG
// ═══════════════════════════════════════════════════════════════
// ⚙️  Cambia esta URL si tu backend se despliega en otro dominio
const BASE_URL = '';  // paths ya incluyen /api/

const TOKEN_KEY   = 'nf_token';         // debe coincidir con api.js → NUBIFLY_CONFIG.TOKEN_KEY
const USER_KEY    = 'nf_user';          // debe coincidir con api.js → NUBIFLY_CONFIG.USER_KEY
const REFRESH_KEY = 'nf_refresh_token'; // debe coincidir con api.js → NUBIFLY_CONFIG.REFRESH_KEY

// ═══════════════════════════════════════════════════════════════
// ║  AUTH — Gestión de sesión con localStorage
// ═══════════════════════════════════════════════════════════════
const Auth = {
  getToken()  { return localStorage.getItem(TOKEN_KEY) || null; },
  setToken(t) { localStorage.setItem(TOKEN_KEY, t); },
  getRefreshToken()  { return localStorage.getItem(REFRESH_KEY) || null; },
  setRefreshToken(t) { localStorage.setItem(REFRESH_KEY, t); },
  getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; }
    catch { return null; }
  },
  setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  isLoggedIn() { return !!this.getToken(); }
};

// ═══════════════════════════════════════════════════════════════
// ║  API — Llamadas a los endpoints del servidor
// ═══════════════════════════════════════════════════════════════
const API = {

  /** Realiza una petición autenticada y devuelve el JSON parseado. */
  async request(method, path, body = null, requireAuth = true, _isRetry = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (requireAuth) {
      const token = Auth.getToken();
      if (!token) throw new Error('NO_TOKEN');
      headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401 && requireAuth && !_isRetry) {
      const rt = Auth.getRefreshToken();
      if (rt) {
        try {
          const rr = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rt })
          });
          if (rr.ok) {
            const rd = await rr.json().catch(() => ({}));
            if (rd?.accessToken) {
              Auth.setToken(rd.accessToken);
              if (rd.refreshToken) Auth.setRefreshToken(rd.refreshToken);
              return API.request(method, path, body, requireAuth, true);
            }
          }
        } catch { /* ignore refresh errors */ }
      }
      Auth.clear();
      window.location.href = '/login';
      throw new Error('UNAUTHORIZED');
    }
    if (res.status === 401) {
      Auth.clear();
      window.location.href = '/login';
      throw new Error('UNAUTHORIZED');
    }
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  },

  /** Subir archivo como multipart/form-data */
  async uploadFile(path, formData) {
    const token = Auth.getToken();
    if (!token) throw new Error('NO_TOKEN');
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { Auth.clear(); window.location.href = '/login'; throw new Error('UNAUTHORIZED'); }
    if (!res.ok) {
      const msg = data.message || data.error || `Error HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  },

  // ── AUTH ──────────────────────────────────────────────────────
  login(email, password) {
    return this.request('POST', '/api/login', { email, password }, false);
  },

  register(name, username, email, password) {
    return this.request('POST', '/api/register', { name, username, email, password }, false);
  },

  // ── DASHBOARD ────────────────────────────────────────────────
  getDashboard() {
    return this.request('GET', '/api/user/dashboard');
  },

  // ── FILES ─────────────────────────────────────────────────────
  getFiles() {
    return this.request('GET', '/api/user/files');
  },

  publishFile(formData) {
    return this.uploadFile('/api/user/files', formData);
  },

  uploadToProject(formData) {
    return this.uploadFile('/api/files/upload', formData);
  },

  // ── API KEYS ──────────────────────────────────────────────────
  listApiKeys() {
    return this.request('GET', '/api/user/apikeys');
  },

  createApiKey(payload) {
    return this.request('POST', '/api/user/apikeys', payload);
  },

  deleteApiKey(id) {
    return this.request('DELETE', `/api/user/apikeys/${id}`);
  },

  // ── TRASH ────────────────────────────────────────────────────
  getTrash() {
    return this.request('GET', '/api/user/apikeys/trash');
  },

  emptyTrash() {
    return this.request('DELETE', '/api/user/apikeys/trash');
  },

  restoreKey(id) {
    return this.request('POST', `/api/user/apikeys/trash/${id}/restore`);
  },

  // ── NOTIFICATIONS ────────────────────────────────────────────
  getNotifications() {
    return this.request('GET', '/api/user/notifications');
  },

  // ── ACTIVITY ─────────────────────────────────────────────────
  getActivity() {
    return this.request('GET', '/api/user/activity');
  },

  // ── PROJECTS ─────────────────────────────────────────────────
  getProjects() {
    return this.request('GET', '/api/projects');
  },

  createProject(name, description, extra = {}) {
    return this.request('POST', '/api/projects', { name, description, ...extra });
  },

  deleteFile(id) {
    return this.request('DELETE', `/api/files/${id}`);
  }
};

// ═══════════════════════════════════════════════════════════════
// ║  STATE — Caché de datos en memoria
// ═══════════════════════════════════════════════════════════════
const State = {
  files: [],
  projects: [],
  apiKeys: [],
  activity: [],
  notifications: [],
  trash: [],
  dashboard: null,
  selectedProject: null   // Proyecto seleccionado para ver detalle
};

// ═══════════════════════════════════════════════════════════════
// ║  UI HELPERS
// ═══════════════════════════════════════════════════════════════

let _toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts;
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const days = Math.floor(h / 24);
  return `hace ${days}d`;
}

function avatarLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function avatarColor(str) {
  const colors = ['#6078da','#0d8f6f','#c25300','#6b46c1','#e5484d','#2563eb'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function maskKey(key) {
  if (!key) return '—';
  return key.slice(0, 18) + '••••••••••••••••••';
}

function partialMaskKey(key) {
  if (!key) return '—';
  const show = Math.min(8, key.length);
  return key.slice(0, show) + '•'.repeat(Math.max(0, key.length - show));
}

function emptyListHTML(icon, title, sub) {
  return `<div class="list-empty">
    <div class="list-empty-icon">${icon}</div>
    <div class="list-empty-title">${title}</div>
    <div class="list-empty-sub">${sub}</div>
  </div>`;
}

function setBtnLoading(btn, loading, original) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn._orig = btn.innerHTML;
    btn.innerHTML = `<div class="auth-spinner"></div>`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._orig || original || btn.innerHTML;
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  NAVIGATION — Páginas y menú
// ═══════════════════════════════════════════════════════════════
const pages = ['panel','nueva','todas','categorias','analytics','apikeys','papelera','notificaciones','log','proyectos','proj-detail','nuevo-proyecto'];
const pageTitles = {
  panel:'Inicio', nueva:'Nueva Publicación', todas:'Publicaciones',
  categorias:'Categorías', analytics:'Analytics', apikeys:'Claves API',
  papelera:'Papelera', notificaciones:'Notificaciones', log:'Log',
  proyectos:'Proyectos', 'proj-detail':'Proyecto', 'nuevo-proyecto':'Nuevo Proyecto'
};

const pageLoaders = {
  panel: loadDashboard,
  todas: loadFiles,
  apikeys: loadApiKeys,
  papelera: loadTrash,
  notificaciones: loadNotifications,
  log: loadActivity,
  proyectos: loadProjects,
  analytics: loadAnalytics
};

function goPage(name) {
  pages.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('active', p === name);
  });

  // Nav active state
  document.querySelectorAll('.nav-item[id^="nav-"]').forEach(el => {
    el.classList.remove('active');
    if (!el.classList.contains('plain')) el.classList.add('plain');
  });
  const navMap = {
    panel:'nav-panel', nueva:'nav-nueva', todas:'nav-todas',
    categorias:'nav-categorias', analytics:'nav-analytics', apikeys:'nav-apikeys',
    papelera:'nav-papelera', notificaciones:'nav-notificaciones',
    log:'nav-log', proyectos:'nav-proyectos'
  };
  const navEl = document.getElementById(navMap[name]);
  if (navEl) { navEl.classList.add('active'); navEl.classList.remove('plain'); }

  document.getElementById('topbarTitle').textContent = pageTitles[name] || 'Nubifly';
  const isHome = name === 'panel';
  document.querySelector('.topbar').style.display = isHome ? '' : 'none';
  document.getElementById('pageWrap').style.paddingTop = isHome ? '' : '0';
  document.getElementById('pageWrap').scrollTop = 0;
  closeDrawer();

  // Trigger data loader if exists
  if (pageLoaders[name]) pageLoaders[name]();
}

function toggleDrawer() {
  const d = document.getElementById('drawer');
  const m = document.getElementById('menuBtn');
  const o = document.getElementById('overlay');
  d.classList.toggle('open');
  m.classList.toggle('open');
  o.classList.toggle('on');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('menuBtn').classList.remove('open');
  document.getElementById('overlay').classList.remove('on');
}

function toggleSub() {
  document.getElementById('pubSub').classList.toggle('open');
  document.getElementById('pubChev').classList.toggle('open');
}

function ana2Tab(btn) {
  document.querySelectorAll('.ana3-tab').forEach(b => b.classList.remove('ana3-tab-on'));
  btn.classList.add('ana3-tab-on');
}

function ana2Period(btn) {
  document.querySelectorAll('.ana3-pill').forEach(b => b.classList.remove('ana3-pill-on'));
  btn.classList.add('ana3-pill-on');
}

let _projAccess = 'private';
let _projIconFile = null;
let _projIconDataUrl = '';

function updateDescCount() {
  const el  = document.getElementById('projDesc');
  const out = document.getElementById('projDescCount');
  if (!el || !out) return;
  out.textContent = `${el.value.length}/500`;
}

function handleProjIconSelect(input) {
  const f = input.files && input.files[0];
  if (!f) return;

  if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) {
    showToast('Formato no válido. Usa JPG, PNG o WEBP.', 'error');
    input.value = '';
    return;
  }
  if (f.size > 2 * 1024 * 1024) {
    showToast('La imagen supera los 2 MB.', 'error');
    input.value = '';
    return;
  }

  _projIconFile = f;
  const reader = new FileReader();
  reader.onload = e => {
    _projIconDataUrl = e.target.result;
    const drop    = document.getElementById('projIconDrop');
    const preview = document.getElementById('projIconPreview');
    const label   = document.getElementById('projIconBtnLabel');
    if (preview) preview.innerHTML = `<img src="${_projIconDataUrl}" alt="">`;
    if (drop)    drop.classList.add('has-img');
    if (label)   label.textContent = 'Cambiar imagen';
  };
  reader.readAsDataURL(f);
}

function resetProjIcon() {
  _projIconFile = null;
  _projIconDataUrl = '';
  const drop    = document.getElementById('projIconDrop');
  const preview = document.getElementById('projIconPreview');
  const label   = document.getElementById('projIconBtnLabel');
  const input   = document.getElementById('projIconInput');
  if (drop)    drop.classList.remove('has-img');
  if (preview) preview.innerHTML = `
    <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`;
  if (label) label.textContent = 'Subir imagen';
  if (input) input.value = '';
}

function selectAccess(el, value) {
  document.querySelectorAll('#page-nuevo-proyecto .access-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  _projAccess = value || 'private';
}

// ─── Tag chips ──────────────────────────────────────────────────
const _projTags = [];

function renderTags() {
  const wrap = document.getElementById('tagsWrap');
  if (!wrap) return;
  wrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
  const input = document.getElementById('tagInput');
  _projTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)}<button type="button" onclick="removeTag(${i})" aria-label="Eliminar etiqueta">×</button>`;
    wrap.insertBefore(chip, input);
  });
}

function addTag(raw) {
  const tag = raw.trim().replace(/,+$/, '').trim();
  if (!tag || _projTags.includes(tag) || _projTags.length >= 10) return;
  _projTags.push(tag);
  renderTags();
}

function removeTag(i) {
  _projTags.splice(i, 1);
  renderTags();
}

function handleTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value);
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && _projTags.length) {
    removeTag(_projTags.length - 1);
  }
}

function handleTagInput(e) {
  if (e.target.value.includes(',')) {
    const parts = e.target.value.split(',');
    parts.slice(0, -1).forEach(p => addTag(p));
    e.target.value = parts[parts.length - 1];
  }
}

function resetNewProjectForm() {
  const name = document.getElementById('projName');
  const desc = document.getElementById('projDesc');
  const dl   = document.getElementById('projDeadline');
  const inp  = document.getElementById('tagInput');
  if (name) name.value = '';
  if (desc) desc.value = '';
  if (dl)   dl.value   = '';
  if (inp)  inp.value  = '';
  _projTags.length = 0;
  renderTags();
  _projAccess = 'private';
  const priv = document.getElementById('accessPrivado');
  const pub  = document.getElementById('accessPublico');
  if (priv) priv.classList.add('selected');
  if (pub)  pub.classList.remove('selected');
  resetProjIcon();
  updateDescCount();
}

// ═══════════════════════════════════════════════════════════════
// ║  PAGE LOADERS — Carga real de datos desde la API
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const [dashRes, keysRes, actRes] = await Promise.all([
      API.getDashboard().catch(() => null),
      API.listApiKeys().catch(() => null),
      API.getActivity().catch(() => null)
    ]);

    if (dashRes?.data) {
      document.getElementById('sv-files').textContent    = dashRes.data.fileCount ?? 0;
      document.getElementById('sv-projects').textContent = dashRes.data.projectCount ?? 0;
      document.getElementById('sv-storage').textContent  = formatBytes(dashRes.data.storageUsed ?? 0);
      State.dashboard = dashRes.data;
    }

    if (keysRes?.data?.keys) {
      State.apiKeys = keysRes.data.keys;
      document.getElementById('sv-apikeys').textContent = State.apiKeys.length;
    }

    if (actRes?.data?.activity) {
      State.activity = actRes.data.activity;
      document.getElementById('sv-activity').textContent = State.activity.length;
    }

    // Recent files
    await loadRecentFiles();
  } catch (e) {
    if (e.message !== 'NO_TOKEN' && e.message !== 'UNAUTHORIZED') {
      console.warn('[loadDashboard]', e.message);
    }
  }
}

async function loadRecentFiles() {
  try {
    const res = await API.getFiles();
    State.files = res?.data?.files || [];
    const container = document.getElementById('recentFilesList');
    const recent = State.files.filter(f => !f.projectId).slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        'Sin archivos aún',
        'Crea tu primera publicación y aparecerá aquí.'
      );
    } else {
      container.innerHTML = recent.map(fileRowHTML).join('');
    }
  } catch (e) {
    console.warn('[loadRecentFiles]', e.message);
  }
}

function fileRowHTML(f) {
  const ext = (f.fileName || f.originalName || '').split('.').pop().toLowerCase();
  const AUDIO = ['mp3','wav','ogg','m4a','aac','flac','opus'];
  const VIDEO = ['mp4','webm','mov','mkv','avi','m4v','3gp'];
  const IMG   = ['jpg','jpeg','png','gif','webp','avif','svg'];

  const mt = f.mediaType
    || (AUDIO.includes(ext) ? 'audio'
      : VIDEO.includes(ext) ? 'video'
      : IMG.includes(ext)   ? 'image' : 'file');
  const isAudio = mt === 'audio';
  const isVideo = mt === 'video';

  // Portada / banner: usa coverUrl; si es imagen usa la propia imagen
  const cover = f.coverUrl || (mt === 'image' ? f.url : '');

  let thumb;
  if (cover) {
    thumb = `<img class="pub-thumb-img" src="${escapeHtml(cover)}" alt="">`;
  } else if (isAudio) {
    thumb = `<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  } else if (isVideo) {
    thumb = `<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>`;
  } else {
    thumb = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  const playOverlay = (isAudio || isVideo)
    ? `<span class="pub-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg></span>`
    : '';
  const typeBadge = isAudio ? `<span class="pub-type pub-type--audio">♪ Canción</span>`
                  : isVideo ? `<span class="pub-type pub-type--video">▶ Video</span>` : '';
  const authorLine = f.author
    ? `<div class="pub-author">${escapeHtml(f.author)}</div>` : '';

  const fid = escapeHtml(f.id || '');
  return `
    <div class="pub-row" id="frow-${fid}">
      <div class="pub-thumb" onclick="openPubDetail('${fid}')" style="cursor:pointer">${thumb}${playOverlay}</div>
      <div class="pub-info" onclick="openPubDetail('${fid}')" style="cursor:pointer">
        <div class="pub-title">${escapeHtml(f.title || f.fileName || f.originalName || 'Sin nombre')}</div>
        ${authorLine}
        <div class="pub-meta">
          ${typeBadge || `<span class="pub-badge badge-pub">Publicado</span>`}
          ${formatDate(f.createdAt || f.uploadedAt)}
          · ${formatBytes(f.fileSize || f.size || 0)}
        </div>
      </div>
      <div class="pub-row-right">
        <button class="file-del-btn" onclick="handleDeleteFile('${escapeHtml(f.id || '')}',this)" aria-label="Eliminar archivo">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ═══════════════ DETALLE DE PUBLICACIÓN ═══════════════
function openPubDetail(fileId) {
  const f = (State.files || []).find(x => (x.id || x.fileId) === fileId);
  if (!f) return;

  const ext   = (f.fileName || f.originalName || '').split('.').pop().toLowerCase();
  const AUDIO = ['mp3','wav','ogg','m4a','aac','flac','opus'];
  const VIDEO = ['mp4','webm','mov','mkv','avi','m4v','3gp'];
  const IMG   = ['jpg','jpeg','png','gif','webp','avif','svg'];
  const mt = f.mediaType
    || (AUDIO.includes(ext) ? 'audio' : VIDEO.includes(ext) ? 'video' : IMG.includes(ext) ? 'image' : 'file');

  const url   = f.url || f.fileUrl || '';
  const cover = f.coverUrl || (mt === 'image' ? url : '');

  const ICONS = {
    audio: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    file:  '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
  };

  // Portada
  const coverEl = document.getElementById('pubdCover');
  if (cover) {
    coverEl.innerHTML = `<img src="${escapeHtml(cover)}" alt="">`;
    coverEl.className = 'pubd-cover has-img';
  } else {
    coverEl.innerHTML = ICONS[mt] || ICONS.file;
    coverEl.className = 'pubd-cover pubd-cover--' + mt;
  }

  // Tipo
  const typeMap = { audio: '♪ Canción', video: '▶ Video', image: '🖼 Imagen', file: '📄 Archivo' };
  const typeEl = document.getElementById('pubdType');
  typeEl.textContent = typeMap[mt] || typeMap.file;
  typeEl.className = 'pubd-type pubd-type--' + mt;

  // Título / autor / descripción
  document.getElementById('pubdTitle').textContent = f.title || f.fileName || f.originalName || 'Sin nombre';
  const authEl = document.getElementById('pubdAuthor');
  authEl.textContent = f.author ? ('por ' + f.author) : '';
  authEl.style.display = f.author ? '' : 'none';
  const descEl = document.getElementById('pubdDesc');
  descEl.textContent = f.description || '';
  descEl.style.display = f.description ? '' : 'none';

  // Ficha de datos (incluye metadatos de audio cuando existen)
  const facts = [];
  const add = (k, v) => { if (v || v === 0) facts.push([k, v]); };
  add('Archivo', f.fileName || f.originalName || '—');
  add('Álbum',   f.album);
  add('Año',     f.year);
  add('Género',  f.genre);
  if (f.track) add('Pista', f.track);
  if (f.duration) {
    const s = Math.round(Number(f.duration)); const mm = Math.floor(s/60), ss = String(s%60).padStart(2,'0');
    add('Duración', `${mm}:${ss}`);
  }
  if (f.bitrate)    add('Bitrate', Math.round(Number(f.bitrate)/1000) + ' kbps');
  if (f.sampleRate) add('Frecuencia', (Number(f.sampleRate)/1000).toFixed(1).replace(/\.0$/,'') + ' kHz');
  if (f.channels)   add('Canales', Number(f.channels) === 1 ? 'Mono' : Number(f.channels) === 2 ? 'Estéreo' : f.channels);
  add('Compositor', f.composer);
  add('Copyright',  f.copyright);
  add('Tamaño',  formatBytes(f.fileSize || f.size || 0));
  add('Fecha',   formatDate(f.createdAt || f.uploadedAt));
  add('Formato', (f.container || '').toUpperCase() || (typeMap[mt] || 'Archivo').replace(/^[^\s]+\s/, ''));
  document.getElementById('pubdFacts').innerHTML = facts
    .map(([k, v]) => `<div class="pubd-fact"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`)
    .join('');

  // Botón abrir / reproducir
  const openEl = document.getElementById('pubdOpen');
  const lblMap = { audio: 'Escuchar', video: 'Reproducir', image: 'Ver imagen', file: 'Abrir archivo' };
  document.getElementById('pubdOpenLabel').textContent = lblMap[mt] || lblMap.file;
  if (url) { openEl.href = url; openEl.style.display = ''; }
  else { openEl.removeAttribute('href'); openEl.style.display = 'none'; }

  document.getElementById('pubdBackdrop').classList.add('show');
}

function closePubDetail(e) {
  if (e && e.target && e.target.closest && e.target.closest('.pubd-sheet')) return;
  const bd = document.getElementById('pubdBackdrop');
  if (bd) bd.classList.remove('show');
}

let _fdelFileId = null;

function openFdelDialog(fileId) {
  if (!fileId) return;
  _fdelFileId = fileId;

  const f = State.files.find(x => x.id === fileId);
  const nameEl = document.getElementById('fdelFileName');
  const sizeEl = document.getElementById('fdelFileSize');
  const thumbEl = document.getElementById('fdelThumb');

  const fname = f?.fileName || f?.originalName || f?.title || 'Archivo';
  if (nameEl) nameEl.textContent = fname;
  if (sizeEl) sizeEl.textContent = formatBytes(f?.fileSize || f?.size || 0);

  if (thumbEl) {
    const ext = fname.split('.').pop().toLowerCase();
    const isImg = ['jpg','jpeg','png','gif','webp','avif','svg'].includes(ext);
    if (isImg && f?.url) {
      thumbEl.innerHTML = `<img src="${escapeHtml(f.url)}" style="width:44px;height:44px;border-radius:10px;object-fit:cover;display:block">`;
    } else {
      thumbEl.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }
  }

  const confirmBtn = document.getElementById('fdelConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> Eliminar archivo`;
    confirmBtn.onclick = _confirmFdel;
  }

  document.getElementById('fdelBackdrop').classList.add('show');
}

function closeFdelDialog(e) {
  if (e && e.target !== document.getElementById('fdelBackdrop')) return;
  document.getElementById('fdelBackdrop').classList.remove('show');
  _fdelFileId = null;
}

async function _confirmFdel() {
  if (!_fdelFileId) return;
  const confirmBtn = document.getElementById('fdelConfirmBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Eliminando…'; }

  try {
    await API.deleteFile(_fdelFileId);
    State.files = State.files.filter(f => f.id !== _fdelFileId);
    const row = document.getElementById('frow-' + _fdelFileId);
    if (row) { row.style.opacity = '0'; row.style.transform = 'scale(.97)'; row.style.transition = 'opacity .2s,transform .2s'; setTimeout(() => row.remove(), 200); }
    showToast('Archivo eliminado.', 'success');
    closeFdelDialog();
    const emptyHtml = emptyListHTML(
      `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      'Sin archivos', 'Aún no has subido ningún archivo.'
    );
    if (!State.files.length) {
      const c = document.getElementById('allFilesList');
      if (c) c.innerHTML = emptyHtml;
      const r = document.getElementById('recentFilesList');
      if (r) r.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        'Sin archivos aún', 'Crea tu primera publicación y aparecerá aquí.'
      );
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> Eliminar archivo`;
    }
  }
}

function handleDeleteFile(fileId) {
  openFdelDialog(fileId);
}

async function loadFiles() {
  const container   = document.getElementById('allFilesList');
  const searchInput = document.getElementById('searchInput');

  if (container) container.innerHTML = `<div class="list-loading"><div class="auth-spinner"></div></div>`;

  try {
    const res = await API.getFiles();
    State.files = res?.data?.files || [];
    const publications = State.files.filter(f => !f.projectId);

    function renderFiles(files) {
      if (!container) return;
      if (files.length === 0) {
        container.innerHTML = emptyListHTML(
          `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
          'Sin archivos', 'Aún no has subido ningún archivo.'
        );
      } else {
        container.innerHTML = files.map(fileRowHTML).join('');
      }
    }

    renderFiles(publications);

    if (searchInput) {
      searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase();
        const filtered = q
          ? publications.filter(f => (f.fileName || f.originalName || '').toLowerCase().includes(q))
          : publications;
        renderFiles(filtered);
      };
    }
  } catch (e) {
    if (container) container.innerHTML = emptyListHTML(
      `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      'Sin archivos', 'Aún no has subido ningún archivo.'
    );
    console.warn('[loadFiles]', e.message);
  }
}

async function loadApiKeys() {
  const container = document.getElementById('apiKeysList');
  const emptyState = document.getElementById('apiEmptyState');
  const usageSection = document.getElementById('apiUsageSection');

  try {
    const res = await API.listApiKeys();
    State.apiKeys = res?.data?.keys || [];

    if (State.apiKeys.length === 0) {
      container.innerHTML = '';
      emptyState.classList.add('show');
      usageSection.style.display = 'none';
    } else {
      emptyState.classList.remove('show');
      usageSection.style.display = 'block';

      container.innerHTML = State.apiKeys.map(k => `
        <div class="api-key-card" id="apicard-${k.id}">
          <div class="api-key-head">
            <div class="api-key-name">${escapeHtml(k.name)}</div>
            <span class="api-access-badge${k.perm === 'read' ? ' read' : ''}">${escapeHtml(k.permLabel || 'Acceso total')}</span>
          </div>
          <div class="api-key-val">
            <span class="api-key-text" id="keytext-${k.id}">${maskKey(k.key)}</span>
            <button class="api-icon-btn" title="Mostrar clave" onclick="toggleKeyVisibility('${k.id}','${escapeHtml(k.key)}')">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="api-icon-btn" title="Copiar clave" onclick="copyToClipboard('${escapeHtml(k.key)}')">
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
          </div>
          <div class="api-key-footer">
            <span class="api-key-date">Creada el ${formatDate(k.created)}</span>
            <button class="api-delete-btn" onclick="openDelDialog(this,'${escapeHtml(k.name)}','${k.id}','${maskKey(k.key)}')">Eliminar</button>
          </div>
        </div>
      `).join('');

      updateAnalytics(State.apiKeys);
    }

    // Update nav badge
    const badge = document.getElementById('badge-papelera');
    if (badge) { badge.style.display = 'none'; }

  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando claves. <button onclick="loadApiKeys()" style="color:var(--blue);font-weight:600">Reintentar</button></div>`;
    console.warn('[loadApiKeys]', e.message);
  }
}

function updateAnalytics(keys) {
  const totalCalls = keys.reduce((s, k) => s + (k.calls || 0), 0);

  const dates = keys.map(k => new Date(k.created || Date.now())).filter(d => !isNaN(d));
  const firstDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
  const now = new Date();
  const daysSinceFirst = Math.max(1, Math.ceil((now - firstDate) / 86400000));
  const activeDays = totalCalls > 0 ? Math.min(daysSinceFirst, 30) : 0;

  const keysWithCalls = keys.filter(k => (k.calls || 0) > 0).length;
  const avgCalls = activeDays > 0 ? Math.round(totalCalls / activeDays) : 0;

  const dayData = buildDayData(keys, 14);
  const peakDay = dayData.reduce((best, d) => d.calls > best.calls ? d : best, { calls: 0, label: '—' });

  const plural = (n, w) => n === 1 ? `${n} ${w}` : `${n} ${w}s`;
  document.getElementById('anuDaysActive').textContent = plural(activeDays, 'día activo');
  document.getElementById('anuTotalNum').textContent = totalCalls.toLocaleString('es');
  document.getElementById('anuAvg').textContent = avgCalls.toLocaleString('es');
  document.getElementById('anuPeak').textContent = peakDay.calls.toLocaleString('es');
  document.getElementById('anuPeakDate').textContent = peakDay.calls > 0 ? peakDay.label : '—';
  document.getElementById('anuKeysRatio').textContent = `${keysWithCalls}/${keys.length}`;

  const track = daysSinceFirst < 2 ? 'Hoy'
    : daysSinceFirst < 30 ? `${daysSinceFirst}d`
    : `${Math.floor(daysSinceFirst / 30)}m`;
  document.getElementById('anuTrack').textContent = track;

  const last7  = dayData.slice(-7).reduce((s, d) => s + d.calls, 0);
  const prev7  = dayData.slice(-14, -7).reduce((s, d) => s + d.calls, 0);
  const changePct = prev7 > 0 ? ((last7 - prev7) / prev7 * 100) : (last7 > 0 ? 100 : 0);
  const badge = document.getElementById('anuChangeBadge');
  if (changePct >= 0) {
    badge.textContent = `▲ +${changePct.toFixed(1)}%`;
    badge.className = 'anu-change-badge';
  } else {
    badge.textContent = `▼ ${changePct.toFixed(1)}%`;
    badge.className = 'anu-change-badge down';
  }

  drawHeroChart(keys);
  drawBarChart(dayData);
  drawKeyBreakdown(keys, totalCalls);
}

function buildDayData(keys, days) {
  const totalCalls = keys.reduce((s, k) => s + (k.calls || 0), 0);
  const result = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
    result.push({ label, calls: 0, weight: Math.pow(0.85, i) });
  }

  if (totalCalls > 0) {
    const totalWeight = result.reduce((s, d) => s + d.weight, 0);
    let remaining = totalCalls;
    result.forEach((d, idx) => {
      if (idx === result.length - 1) {
        d.calls = Math.max(0, remaining);
      } else {
        const share = Math.round((d.weight / totalWeight) * totalCalls);
        d.calls = share;
        remaining -= share;
      }
    });
  }

  return result;
}

function drawHeroChart(keys) {
  const W = 320, H = 60;
  const dayData = buildDayData(keys, 30);
  const maxVal = Math.max(...dayData.map(d => d.calls), 1);

  const pts = dayData.map((d, i) => {
    const x = (i / (dayData.length - 1)) * W;
    const y = H - 8 - ((d.calls / maxVal) * (H - 16));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lineD = `M${pts.join(' L')}`;
  const fillD = `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
  document.getElementById('anuHeroLine').setAttribute('d', lineD);
  document.getElementById('anuHeroFill').setAttribute('d', fillD);
}

function drawBarChart(dayData) {
  const W = 320, H = 80;
  const n = dayData.length;
  const maxVal = Math.max(...dayData.map(d => d.calls), 1);
  const slotW = W / n;
  const barW = slotW * 0.55;
  const gap  = (slotW - barW) / 2;

  const rects = dayData.map((d, i) => {
    const x = i * slotW + gap;
    const barH = Math.max(2, (d.calls / maxVal) * (H - 6));
    const y = H - barH;
    const fill = i === n - 1 ? '#2563eb' : '#bfdbfe';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${fill}" rx="2"/>`;
  }).join('');

  document.getElementById('anuBarChart').innerHTML = rects;

  const labelsEl = document.getElementById('anuBarLabels');
  labelsEl.innerHTML = dayData.map((d, i) => {
    const show = i === 0 || i === n - 1 || i % 3 === 0;
    return `<span class="anu-bar-label">${show ? d.label.split(' ')[0] : ''}</span>`;
  }).join('');
}

function drawKeyBreakdown(keys, totalCalls) {
  const container = document.getElementById('anuKeyBreakdown');
  const countLabel = document.getElementById('anuKeyCountLabel');
  countLabel.textContent = `${keys.length} clave${keys.length !== 1 ? 's' : ''}`;

  const sorted = [...keys].sort((a, b) => (b.calls || 0) - (a.calls || 0));
  const keyIcon = `<svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;

  container.innerHTML = sorted.map(k => {
    const calls = k.calls || 0;
    const pct   = totalCalls > 0 ? Math.round(calls / totalCalls * 100) : 0;
    return `
      <div class="anu-key-row">
        <div class="anu-key-icon">${keyIcon}</div>
        <div class="anu-key-info">
          <div class="anu-key-name">${escapeHtml(k.name)}</div>
          <div class="anu-key-badge">${escapeHtml(k.permLabel || 'Acceso total')}</div>
        </div>
        <div class="anu-key-bar-wrap">
          <div class="anu-key-bar-bg"><div class="anu-key-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="anu-key-calls">${calls.toLocaleString('es')}</div>
      </div>`;
  }).join('');
}

async function loadTrash() {
  const container = document.getElementById('trashList');
  const emptyTrashBtn = document.getElementById('emptyTrashBtn');

  try {
    const res = await API.getTrash();
    State.trash = res?.data?.items || [];

    if (State.trash.length === 0) {
      emptyTrashBtn.style.display = 'none';
      container.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`,
        'Papelera vacía', 'Los elementos eliminados aparecerán aquí.'
      );
    } else {
      emptyTrashBtn.style.display = '';

      // Update badge
      const badge = document.getElementById('badge-papelera');
      if (badge) { badge.textContent = State.trash.length; badge.style.display = ''; }

      container.innerHTML = State.trash.map(item => `
        <div class="trash-row" id="trash-${item.id}">
          <div class="trash-icon" style="background:var(--orange-bg)">
            <svg viewBox="0 0 24 24" style="stroke:var(--orange)"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="trash-name">${escapeHtml(item.name || 'API Key')}</div>
            <div class="trash-date">Eliminada el ${escapeHtml(item.deletedAt || '—')}</div>
          </div>
          <button class="trash-restore" onclick="handleRestoreKey('${item.id}')">Restaurar</button>
        </div>
      `).join('');
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando papelera. <button onclick="loadTrash()" style="color:var(--blue);font-weight:600">Reintentar</button></div>`;
    console.warn('[loadTrash]', e.message);
  }
}

async function loadNotifications() {
  const container = document.getElementById('notifList');

  try {
    const res = await API.getNotifications();
    const notifs = res?.data?.notifications || [];
    State.notifications = notifs;

    // Update badge
    const unread = res?.data?.unread || 0;
    const badge = document.getElementById('badge-notif');
    if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }

    if (notifs.length === 0) {
      container.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
        'Sin notificaciones', 'Te avisaremos cuando haya actividad en tu cuenta.'
      );
    } else {
      const nivelColor = { error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
      container.innerHTML = notifs.map(n => {
        const leida   = !!(n.leida || n.read);
        const titulo  = escapeHtml(n.titulo  || n.title  || '');
        const mensaje = escapeHtml(n.mensaje || n.body   || '');
        const nivel   = n.nivel || 'info';
        const dotStyle = !leida && nivelColor[nivel] ? ` style="background:${nivelColor[nivel]}"` : '';
        return `
        <div class="notif-row">
          <div class="notif-dot${leida ? ' read' : ''}"${dotStyle}></div>
          <div class="notif-body">
            <div class="notif-title">${titulo}</div>
            <div class="notif-desc">${mensaje}</div>
            <div class="notif-time">${timeAgo(n.createdAt)}</div>
          </div>
        </div>`;
      }).join('');
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando notificaciones.</div>`;
    console.warn('[loadNotifications]', e.message);
  }
}

// ── LOGS state (filtro + paginación) ────────────────────────────────────────
const LOGS_PAGE_SIZE = 20;
let _logsFilter = 'all';   // 'all' | 'info' | 'warn' | 'error'
let _logsPage   = 1;

function _logLevel(ev) {
  // status puede ser número (200, 404, 500) o string ('success', 'error')
  const s   = ev.status;
  const num = typeof s === 'number' ? s : parseInt(s, 10);
  if (!isNaN(num)) {
    if (num >= 500) return 'error';
    if (num >= 400) return 'warn';
    if (num >= 200) return 'info';
  }
  const str = String(s || ev.level || '').toLowerCase();
  if (/(error|fail|timeout|denied|invalid|forbid|unauthor)/.test(str)) {
    return /(unauthor|forbid|denied|invalid|not_?found)/.test(str) ? 'warn' : 'error';
  }
  if (/(warn|retry|slow)/.test(str)) return 'warn';
  return 'info';
}

function _logMessage(ev) {
  const lvl    = _logLevel(ev);
  const file   = ev.fileName ? ` "${ev.fileName}"` : '';
  const keyTxt = ev.apiKeyName ? ` (clave: ${ev.apiKeyName})` : '';

  if (lvl === 'error') {
    if (/timeout/i.test(String(ev.status))) {
      return 'La solicitud excedió el tiempo de espera. Revisa tu conexión o que el destino del enlace responda a tiempo.';
    }
    if (/5\d\d/.test(String(ev.status))) {
      return `Error interno del servidor al procesar el archivo${file}. Inténtalo de nuevo en unos minutos.`;
    }
    return `Falló la solicitud${file}${keyTxt}. Revisa los detalles del request.`;
  }
  if (lvl === 'warn') {
    if (/401|unauthor/i.test(String(ev.status))) {
      return 'Clave API rechazada. Verifica que tu API Key sea válida y esté activa en tu panel.';
    }
    if (/403|forbid|denied/i.test(String(ev.status))) {
      return 'Acceso denegado. La clave API no tiene permiso sobre este recurso o proyecto.';
    }
    if (/404|not_?found/i.test(String(ev.status))) {
      return 'Recurso no encontrado. El enlace o ID que enviaste puede ser inválido o haber sido eliminado.';
    }
    if (/429|rate/i.test(String(ev.status))) {
      return 'Demasiadas solicitudes en poco tiempo. Espera unos segundos antes de reintentar.';
    }
    return `Aviso al procesar la solicitud${file}. Revisa los parámetros enviados.`;
  }
  // info
  if (ev.kind === 'file' || ev.fileId) {
    return `Archivo${file} subido correctamente${keyTxt}.`;
  }
  return `Solicitud completada correctamente${keyTxt}.`;
}

function _fmtLogTs(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

function setLogsFilter(level) {
  _logsFilter = level;
  _logsPage   = 1;
  document.querySelectorAll('.logs-fchip').forEach(c => {
    c.classList.toggle('active', c.dataset.level === level);
  });
  renderLogs();
}

function changeLogsPage(delta) {
  const filtered = State.activity.filter(ev => _logsFilter === 'all' || _logLevel(ev) === _logsFilter);
  const maxPage  = Math.max(1, Math.ceil(filtered.length / LOGS_PAGE_SIZE));
  _logsPage = Math.min(maxPage, Math.max(1, _logsPage + delta));
  renderLogs();
}

function renderLogs() {
  const container = document.getElementById('activityList');
  if (!container) return;

  const all      = State.activity || [];
  const counts   = { info: 0, warn: 0, error: 0 };
  for (const ev of all) counts[_logLevel(ev)]++;

  document.getElementById('logsCountTotal').textContent = all.length;
  document.getElementById('logsCountInfo').textContent  = counts.info;
  document.getElementById('logsCountWarn').textContent  = counts.warn;
  document.getElementById('logsCountErr').textContent   = counts.error;

  const filtered = _logsFilter === 'all' ? all : all.filter(ev => _logLevel(ev) === _logsFilter);

  if (filtered.length === 0) {
    container.innerHTML = emptyListHTML(
      `<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
      'Sin registros',
      all.length === 0
        ? 'Tu actividad de API aparecerá aquí cuando uses tus claves.'
        : 'No hay logs de este nivel.'
    );
    document.getElementById('logsPagination').style.display = 'none';
    return;
  }

  const maxPage = Math.max(1, Math.ceil(filtered.length / LOGS_PAGE_SIZE));
  if (_logsPage > maxPage) _logsPage = maxPage;
  const start = (_logsPage - 1) * LOGS_PAGE_SIZE;
  const slice = filtered.slice(start, start + LOGS_PAGE_SIZE);

  container.innerHTML = slice.map(ev => {
    const lvl     = _logLevel(ev);
    const lvlKey  = lvl === 'error' ? 'err' : lvl;
    const lvlTxt  = lvl === 'info' ? 'Info' : lvl === 'warn' ? 'Aviso' : 'Error';
    const ts      = _fmtLogTs(ev.ts || ev.createdAt);
    const msg     = _logMessage(ev);
    const method  = (ev.method || 'GET').toUpperCase();
    const path    = ev.endpoint || ev.path || '/api/v1';
    const mClass  = ({ GET:'m-get', POST:'m-post', DELETE:'m-delete', PATCH:'m-patch', PUT:'m-put' })[method] || 'm-get';
    return `
      <div class="logs-card lvl-${lvlKey}">
        <div class="logs-card-head">
          <span class="logs-lvl logs-lvl-${lvlKey}">
            <span class="logs-lvl-dot"></span>${lvlTxt}
          </span>
          <span class="logs-ts">${ts.date}<span class="logs-ts-time">${ts.time}</span></span>
        </div>
        <div class="logs-msg">${escapeHtml(msg)}</div>
        <div class="logs-meta">
          <span class="logs-meta-method ${mClass}">${escapeHtml(method)}</span>
          <span class="logs-meta-path">${escapeHtml(path)}</span>
        </div>
      </div>
    `;
  }).join('');

  const pag = document.getElementById('logsPagination');
  if (filtered.length > LOGS_PAGE_SIZE) {
    pag.style.display = 'flex';
    document.getElementById('logsPageInfo').textContent =
      `Mostrando ${start + 1}–${Math.min(start + LOGS_PAGE_SIZE, filtered.length)} de ${filtered.length}`;
    document.getElementById('logsPageNum').textContent = `${_logsPage} / ${maxPage}`;
    document.getElementById('logsPagePrev').disabled = _logsPage === 1;
    document.getElementById('logsPageNext').disabled = _logsPage === maxPage;
  } else {
    pag.style.display = 'none';
  }
}

async function loadActivity() {
  const container = document.getElementById('activityList');
  if (container) {
    container.innerHTML = `<div class="list-loading" style="padding:40px"><div class="auth-spinner"></div></div>`;
  }
  try {
    const res = await API.getActivity();
    State.activity = res?.data?.activity || [];
    _logsPage = 1;
    renderLogs();
  } catch (e) {
    if (container) {
      container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">Error cargando logs. <button onclick="loadActivity()" style="color:var(--blue);font-weight:600;margin-left:6px">Reintentar</button></div>`;
    }
    console.warn('[loadActivity]', e.message);
  }
}

async function loadProjects() {
  const container = document.getElementById('projectsList');

  try {
    const res = await API.getProjects();
    State.projects = res?.data?.projects || [];

    // Update badge
    const badge = document.getElementById('badge-proyectos');
    if (badge && State.projects.length > 0) {
      badge.textContent = State.projects.length;
      badge.style.display = '';
    }

    if (State.projects.length === 0) {
      container.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>`,
        'Sin proyectos', 'Crea tu primer proyecto para empezar.'
      );
    } else {
      container.innerHTML = State.projects.map(p => {
        const letter = avatarLetter(p.name);
        const color  = avatarColor(p.projectId || p.id || p.name);
        return `
          <div class="proj-card" onclick="openProjectDetail('${p.id || p.projectId}')">
            <div class="proj-card-top">
              <div class="proj-avatar" style="background:${color}">${letter}</div>
              <div style="flex:1">
                <div class="proj-card-name">${escapeHtml(p.name)}</div>
                <div class="proj-card-date">Creado el ${formatDate(p.createdAt)}</div>
              </div>
            </div>
            ${p.description ? `<div class="proj-card-desc">${escapeHtml(p.description)}</div>` : ''}
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando proyectos. <button onclick="loadProjects()" style="color:var(--blue);font-weight:600">Reintentar</button></div>`;
    console.warn('[loadProjects]', e.message);
  }
}

async function loadAnalytics() {
  try {
    const [dashRes, keysRes, actRes] = await Promise.all([
      State.dashboard ? Promise.resolve({ data: State.dashboard }) : API.getDashboard().catch(() => null),
      API.listApiKeys().catch(() => null),
      API.getActivity().catch(() => null)
    ]);

    if (dashRes?.data) {
      document.getElementById('ana-files').textContent    = dashRes.data.fileCount ?? 0;
      document.getElementById('ana-projects').textContent = dashRes.data.projectCount ?? 0;
      document.getElementById('ana-storage').textContent  = formatBytes(dashRes.data.storageUsed ?? 0);
    }
    if (keysRes?.data?.keys) {
      document.getElementById('ana-apikeys').textContent = keysRes.data.keys.length;
    }
    if (actRes?.data?.activity) {
      document.getElementById('anaActivity').textContent = actRes.data.activity.length;
    }
  } catch (e) {
    console.warn('[loadAnalytics]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  PUBLISH — Subir archivos / publicaciones
// ═══════════════════════════════════════════════════════════════
let _selectedFiles = [];
let _coverFile     = null;   // portada / banner opcional

const PUB_IMG_EXT   = ['jpg','jpeg','png','gif','webp','avif','svg','bmp'];
const PUB_AUDIO_EXT = ['mp3','wav','ogg','m4a','aac','flac','opus'];
const PUB_VIDEO_EXT = ['mp4','webm','mov','mkv','avi','m4v','3gp'];

function _fileExt(f) {
  return (f.name || '').split('.').pop().toLowerCase();
}

function _isImage(f) {
  return (f.type && f.type.startsWith('image/')) || PUB_IMG_EXT.includes(_fileExt(f));
}
function _isAudio(f) {
  return (f.type && f.type.startsWith('audio/')) || PUB_AUDIO_EXT.includes(_fileExt(f));
}
function _isVideo(f) {
  return (f.type && f.type.startsWith('video/')) || PUB_VIDEO_EXT.includes(_fileExt(f));
}

// Muestra "Autor" (canciones) y "Portada" (canciones + videos) según el tipo
function updateMediaFields() {
  const anyAudio = _selectedFiles.some(_isAudio);
  const anyVideo = _selectedFiles.some(_isVideo);
  const authorF  = document.getElementById('pubAuthorField');
  const coverF   = document.getElementById('pubCoverField');
  if (authorF) authorF.style.display = anyAudio ? '' : 'none';
  if (coverF)  coverF.style.display  = (anyAudio || anyVideo) ? '' : 'none';
}

// ═══════════════ METADATOS DE AUDIO (music-metadata) ═══════════════
let _audioMeta      = null;   // metadatos extraídos (para enviar al backend)
let _coverFromMeta  = false;  // la portada actual vino embebida en el audio
let _mmPromise      = null;

function loadMusicMetadata() {
  if (_mmPromise) return _mmPromise;
  // esm.sh resuelve los built-ins de Node en el navegador mejor que jsdelivr
  _mmPromise = import('https://esm.sh/music-metadata@11?bundle')
    .catch(() => import('https://cdn.jsdelivr.net/npm/music-metadata@11/+esm'))
    .catch(err => { console.warn('[music-metadata] no se pudo cargar:', err && err.message); return null; });
  return _mmPromise;
}

// jsmediatags — muy fiable en navegador para ID3 (MP3) y MP4/M4A (título,
// artista, álbum, carátula, etc.). Se carga como script UMD.
let _jsmtPromise = null;
function loadJsMediaTags() {
  if (_jsmtPromise) return _jsmtPromise;
  _jsmtPromise = new Promise((resolve) => {
    if (window.jsmediatags) return resolve(window.jsmediatags);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsmediatags@3.9.7/dist/jsmediatags.min.js';
    s.async = true;
    s.onload  = () => resolve(window.jsmediatags || null);
    s.onerror = () => { console.warn('[jsmediatags] no se pudo cargar'); resolve(null); };
    document.head.appendChild(s);
  });
  return _jsmtPromise;
}
function readJsMediaTags(file) {
  return new Promise((resolve) => {
    loadJsMediaTags().then((jsmt) => {
      if (!jsmt || !jsmt.read) return resolve(null);
      try {
        jsmt.read(file, {
          onSuccess: (res) => resolve((res && res.tags) ? res.tags : null),
          onError:   ()   => resolve(null)
        });
      } catch { resolve(null); }
    });
  });
}

// Extrae la portada de music-metadata o de jsmediatags → { format, data:Uint8Array }
function _extractPicture(meta, jtags) {
  const p = meta && meta.common && meta.common.picture && meta.common.picture[0];
  if (p && p.data) {
    const data = (p.data instanceof Uint8Array) ? p.data : new Uint8Array(p.data);
    if (data.length) return { format: p.format || 'image/jpeg', data };
  }
  const jp = jtags && jtags.picture;
  if (jp && jp.data && jp.data.length) {
    return { format: jp.format || 'image/jpeg', data: new Uint8Array(jp.data) };
  }
  return null;
}

function _stripExt(name) { return String(name || '').replace(/\.[^.]+$/, ''); }
function _fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function _channelsLabel(n) {
  return n === 1 ? 'Mono' : n === 2 ? 'Estéreo' : n ? `${n} canales` : '';
}
function _joinTag(v) {
  if (Array.isArray(v)) return v.map(x => (x && x.text != null) ? x.text : x).filter(Boolean).join(', ');
  return v == null ? '' : String(v);
}

// Duración de respaldo con <audio> si la librería no está disponible
function _audioDurationFallback(file) {
  return new Promise(resolve => {
    try {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      const url = URL.createObjectURL(file);
      a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(isFinite(d) ? d : 0); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      a.src = url;
    } catch { resolve(0); }
  });
}

// Extrae metadatos del audio (2 fuentes) y rellena el formulario automáticamente
async function autofillAudioMeta(file) {
  if (!file) return;
  renderAudioPanel({ loading: true, file });

  // Lanzar ambas fuentes en paralelo:
  //  • jsmediatags → etiquetas + carátula (muy fiable, incl. M4A/MP4)
  //  • music-metadata → datos técnicos (bitrate, kHz, canales)
  const [jtags, meta] = await Promise.all([
    readJsMediaTags(file).catch(() => null),
    (async () => {
      try {
        const mm = await loadMusicMetadata();
        if (mm && mm.parseBlob) return await mm.parseBlob(file, { duration: true });
      } catch (e) { console.warn('[music-metadata] parse:', e && e.message); }
      return null;
    })()
  ]);

  await applyAudioMeta(file, meta, jtags);
}

async function applyAudioMeta(file, meta, jtags) {
  const common = (meta && meta.common) || {};
  const format = (meta && meta.format) || {};
  const jt     = jtags || {};

  const pick = (...vals) => {
    for (const v of vals) {
      const s = (Array.isArray(v) ? _joinTag(v) : (v == null ? '' : String(v))).trim();
      if (s) return s;
    }
    return '';
  };
  const digits = (v) => String(v || '').replace(/\D+/g, '');

  const title  = pick(common.title, jt.title) || _stripExt(file.name);
  const artist = pick(common.artist, common.albumartist, jt.artist);

  // Rellenar campos si están vacíos (respetar lo que el usuario ya escribió)
  const tEl = document.getElementById('pubTitle');
  const aEl = document.getElementById('pubAuthor');
  if (tEl && !tEl.value.trim()) tEl.value = title;
  if (aEl && !aEl.value.trim() && artist) aEl.value = artist;

  // Duración: de la librería o respaldo con <audio>
  let duration = Number(format.duration) || 0;
  if (!duration) { try { duration = await _audioDurationFallback(file); } catch {} }

  // Bitrate: de la librería o aproximado por tamaño/duración
  let bitrate = Number(format.bitrate) || 0;
  if (!bitrate && duration) bitrate = Math.round((file.size * 8) / duration);

  // Portada embebida (music-metadata o jsmediatags) → File
  const pic = _extractPicture(meta, jtags);
  if (pic && (!_coverFile || _coverFromMeta)) {
    try {
      let fmt = pic.format || 'image/jpeg';
      if (!/^image\//i.test(fmt)) fmt = 'image/' + String(fmt).replace(/^\./, '');
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(fmt)) fmt = 'image/jpeg';
      fmt = fmt.replace('jpg', 'jpeg');
      const ext = (fmt.split('/')[1] || 'jpg');
      _coverFile = new File([new Blob([pic.data], { type: fmt })], `cover.${ext}`, { type: fmt });
      _coverFromMeta = true;
      _setCoverPreview(_coverFile, 'Portada embebida del audio');
    } catch (e) { console.warn('[cover embed]', e && e.message); }
  }

  _audioMeta = {
    forName:    file.name,
    title, artist,
    album:      pick(common.album, jt.album),
    genre:      pick(common.genre, jt.genre),
    year:       (common.year ? String(common.year) : '') || digits(jt.year),
    track:      (common.track && common.track.no) ? String(common.track.no) : digits((jt.track || '').split('/')[0]),
    composer:   pick(common.composer, jt.composer),
    copyright:  pick(common.copyright, jt.copyright),
    comment:    pick(common.comment, jt.comment),
    lyrics:     pick(common.lyrics, jt.lyrics),
    duration:   duration ? String(Math.round(duration)) : '',
    bitrate:    bitrate ? String(Math.round(bitrate)) : '',
    sampleRate: format.sampleRate ? String(Math.round(format.sampleRate)) : '',
    channels:   format.numberOfChannels ? String(format.numberOfChannels) : '',
    container:  format.container || '',
    codec:      format.codec || ''
  };

  renderAudioPanel({ file, meta: _audioMeta, coverFile: _coverFile });
  updateMediaFields();
}

function _setCoverPreview(file, label) {
  const prev  = document.getElementById('coverPreview');
  const title = document.getElementById('coverTitle');
  const clr   = document.getElementById('coverClear');
  if (prev) {
    const url = URL.createObjectURL(file);
    prev.innerHTML = `<img src="${url}" alt="" onload="URL.revokeObjectURL(this.src)">`;
    prev.classList.add('has-img');
  }
  if (title) title.textContent = label || file.name;
  if (clr) clr.style.display = '';
}

function renderAudioPanel(state) {
  const panel = document.getElementById('audioMetaPanel');
  if (!panel) return;

  if (state && state.loading) {
    panel.style.display = '';
    panel.innerHTML = `
      <div class="ameta-card ameta-loading">
        <div class="ameta-cover"><span class="ameta-spin"></span></div>
        <div class="ameta-main">
          <div class="ameta-title">Leyendo metadatos…</div>
          <div class="ameta-artist">${escapeHtml(state.file ? state.file.name : '')}</div>
        </div>
      </div>`;
    return;
  }

  const m = state && state.meta;
  if (!m) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

  let coverHTML;
  if (state.coverFile) {
    const url = URL.createObjectURL(state.coverFile);
    coverHTML = `<img src="${url}" alt="" onload="URL.revokeObjectURL(this.src)">`;
  } else {
    coverHTML = `<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }

  const subParts = [m.album, m.year, m.genre].filter(Boolean);
  const chips = [];
  if (m.duration)   chips.push(_fmtDuration(m.duration));
  if (m.bitrate)    chips.push(Math.round(Number(m.bitrate) / 1000) + ' kbps');
  if (m.sampleRate) chips.push((Number(m.sampleRate) / 1000).toFixed(1).replace(/\.0$/, '') + ' kHz');
  if (m.channels)   chips.push(_channelsLabel(Number(m.channels)));
  const fmtLabel = (m.container || m.codec || (state.file ? _fileExt(state.file) : '')).toUpperCase();
  if (fmtLabel) chips.push(fmtLabel);
  if (state.file) chips.push(formatBytes(state.file.size));

  panel.style.display = '';
  panel.innerHTML = `
    <div class="ameta-card">
      <div class="ameta-cover">${coverHTML}</div>
      <div class="ameta-main">
        <div class="ameta-badge">♪ Audio detectado</div>
        <div class="ameta-title">${escapeHtml(m.title || '')}</div>
        ${m.artist ? `<div class="ameta-artist">${escapeHtml(m.artist)}</div>` : ''}
        ${subParts.length ? `<div class="ameta-sub">${escapeHtml(subParts.join(' · '))}</div>` : ''}
        <div class="ameta-chips">${chips.map(c => `<span class="ameta-chip">${escapeHtml(c)}</span>`).join('')}</div>
      </div>
    </div>`;
}

function _thumbHTML(f) {
  if (_isImage(f)) {
    const url = URL.createObjectURL(f);
    return `<img src="${url}" alt="" onload="URL.revokeObjectURL(this.src)">`;
  }
  const ext = _fileExt(f) || 'doc';
  return `<span class="pub-file-ext">${escapeHtml(ext.slice(0,4))}</span>`;
}

function renderSelectedFiles() {
  const list   = document.getElementById('pubFileList');
  const zone   = document.getElementById('uploadZone');
  const title  = document.getElementById('uploadTitle');
  if (!list) return;

  if (_selectedFiles.length === 0) {
    list.style.display = 'none';
    list.innerHTML = '';
    if (title) title.textContent = 'Arrastra tus archivos aquí o explora';
    updateMediaFields();
    return;
  }

  if (title) title.textContent = _selectedFiles.length === 1
    ? '1 archivo seleccionado'
    : `${_selectedFiles.length} archivos seleccionados`;

  list.style.display = 'flex';
  list.innerHTML = _selectedFiles.map((f, i) => `
    <div class="pub-file-row">
      <div class="pub-file-thumb">${_thumbHTML(f)}</div>
      <div class="pub-file-info">
        <div class="pub-file-name">${escapeHtml(f.name)}</div>
        <div class="pub-file-size">${formatBytes(f.size)}</div>
      </div>
      <button class="pub-file-remove" type="button" aria-label="Quitar archivo" onclick="removeSelectedFile(${i})">
        <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');

  updateMediaFields();
}

// ── Portada / banner ──────────────────────────────────────────────────────
function handleCoverSelect(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) {
    showToast('La portada debe ser JPG, PNG o WEBP.', 'error');
    input.value = ''; return;
  }
  if (f.size > 5 * 1024 * 1024) {
    showToast('La portada supera los 5 MB.', 'error');
    input.value = ''; return;
  }
  _coverFile = f;
  _coverFromMeta = false;   // el usuario eligió su propia portada
  _setCoverPreview(f, f.name);
}

function clearCover() {
  _coverFile = null;
  _coverFromMeta = false;
  const prev  = document.getElementById('coverPreview');
  const title = document.getElementById('coverTitle');
  const clr   = document.getElementById('coverClear');
  const inp   = document.getElementById('coverInput');
  if (prev) {
    prev.classList.remove('has-img');
    prev.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  if (title) title.textContent = 'Sube una portada';
  if (clr) clr.style.display = 'none';
  if (inp) inp.value = '';
}

function handleFileSelect(input) {
  const incoming = Array.from(input.files || []);
  for (const f of incoming) {
    const dup = _selectedFiles.some(x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
    if (!dup) _selectedFiles.push(f);
  }
  input.value = '';
  renderSelectedFiles();
  // Extraer metadatos automáticamente del primer audio seleccionado
  const firstAudio = incoming.find(_isAudio);
  if (firstAudio) autofillAudioMeta(firstAudio);
}

function removeSelectedFile(index) {
  _selectedFiles.splice(index, 1);
  renderSelectedFiles();
}

function clearPublishState() {
  _selectedFiles = [];
  const t = document.getElementById('pubTitle');
  const d = document.getElementById('pubDesc');
  const a = document.getElementById('pubAuthor');
  const i = document.getElementById('fileInput');
  if (t) t.value = '';
  if (d) d.value = '';
  if (a) a.value = '';
  if (i) i.value = '';
  clearCover();
  _audioMeta = null;
  const panel = document.getElementById('audioMetaPanel');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  renderSelectedFiles();
}

function handlePublishCancel() {
  if (_selectedFiles.length > 0 || (document.getElementById('pubTitle')?.value || '').trim()) {
    if (!confirm('¿Cancelar publicación? Los archivos seleccionados se descartarán.')) return;
  }
  clearPublishState();
  goPage('panel');
}

function handlePublishBack() {
  handlePublishCancel();
}

async function handlePublish() {
  const title  = document.getElementById('pubTitle')?.value.trim();
  const desc   = document.getElementById('pubDesc')?.value.trim();
  const author = document.getElementById('pubAuthor')?.value.trim();
  const btn    = document.getElementById('pubBtn');
  const btn2   = document.getElementById('pubBtn2');

  if (_selectedFiles.length === 0) {
    showToast('Selecciona al menos un archivo', 'error');
    return;
  }

  setBtnLoading(btn, true);
  setBtnLoading(btn2, true);

  let ok = 0, failed = 0;
  for (let i = 0; i < _selectedFiles.length; i++) {
    const f = _selectedFiles[i];
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (title)  fd.append('title', _selectedFiles.length > 1 ? `${title} (${i + 1}/${_selectedFiles.length})` : title);
      if (desc)   fd.append('description', desc);
      // Autor y portada aplican a canciones/videos
      if (author && _isAudio(f)) fd.append('author', author);
      if (_coverFile && (_isAudio(f) || _isVideo(f))) fd.append('cover', _coverFile);
      // Metadatos técnicos del audio (solo para el archivo del que se leyeron)
      if (_isAudio(f) && _audioMeta && _audioMeta.forName === f.name) {
        const M = _audioMeta;
        const put = (k, v) => { if (v) fd.append(k, v); };
        put('album', M.album);       put('genre', M.genre);       put('year', M.year);
        put('track', M.track);       put('composer', M.composer); put('copyright', M.copyright);
        put('comment', M.comment);   put('lyrics', M.lyrics);     put('duration', M.duration);
        put('bitrate', M.bitrate);   put('sampleRate', M.sampleRate); put('channels', M.channels);
        put('container', M.container); put('codec', M.codec);
      }
      await API.publishFile(fd);
      ok++;
    } catch (e) {
      console.warn('[publish]', f.name, e.message);
      failed++;
    }
  }

  setBtnLoading(btn, false);
  setBtnLoading(btn2, false);

  if (ok > 0 && failed === 0) {
    showToast(ok === 1 ? '¡Publicación creada correctamente!' : `¡${ok} publicaciones creadas!`, 'success');
    clearPublishState();
    goPage('panel');
  } else if (ok > 0 && failed > 0) {
    showToast(`${ok} publicadas, ${failed} fallaron.`, 'info');
    _selectedFiles = _selectedFiles.slice(ok);
    renderSelectedFiles();
  } else {
    showToast('No se pudo publicar. Inténtalo de nuevo.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  PROJECTS — Crear y ver detalle
// ═══════════════════════════════════════════════════════════════
async function handleCreateProject() {
  const nameEl = document.getElementById('projName');
  const descEl = document.getElementById('projDesc');
  const dlEl   = document.getElementById('projDeadline');
  const btn    = document.getElementById('createProjBtn');

  const name = nameEl?.value.trim() || '';
  const desc = descEl?.value.trim() || '';

  if (!name) {
    nameEl.focus();
    nameEl.style.boxShadow = '0 0 0 2px rgba(229,72,77,.4)';
    setTimeout(() => nameEl.style.boxShadow = '', 1200);
    showToast('El nombre del proyecto es requerido.', 'error');
    return;
  }

  if (!desc) {
    descEl.focus();
    descEl.style.boxShadow = '0 0 0 2px rgba(229,72,77,.4)';
    setTimeout(() => descEl.style.boxShadow = '', 1200);
    showToast('La descripción es requerida.', 'error');
    return;
  }

  setBtnLoading(btn, true);

  try {
    await API.createProject(name, desc, {
      tags: [..._projTags],
      deadline: dlEl?.value || null,
      access: _projAccess
    });
    showToast('¡Proyecto creado correctamente!', 'success');
    resetNewProjectForm();
    goPage('proyectos');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

function openProjectDetail(projectId) {
  const proj = State.projects.find(p => (p.id || p.projectId) === projectId);
  if (!proj) return;

  State.selectedProject = proj;
  document.getElementById('projDetailTitle').textContent = proj.name;

  const letter = avatarLetter(proj.name);
  const color  = avatarColor(proj.projectId || proj.id || proj.name);
  const maskedKey = proj.apiKey ? maskKey(proj.apiKey) : '—';

  const isPublic = proj.visibility === 'public' || proj.public === true;
  const tags = Array.isArray(proj.tags) && proj.tags.length ? proj.tags : [];
  const rawPid = proj.projectId || proj.id;
  const pid = escapeHtml(rawPid);

  document.getElementById('projDetailContent').innerHTML = `
    <div class="proj-info-card">
      <div class="proj-info-top">
        <div class="proj-avatar" style="background:${color};width:52px;height:52px;min-width:52px;border-radius:15px;font-size:22px;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${letter}</div>
        <div class="proj-info-meta">
          <div class="proj-info-name">${escapeHtml(proj.name)}</div>
          <div class="proj-info-date">Creado el ${formatDate(proj.createdAt)}</div>
        </div>
        <div class="proj-badge${isPublic ? '' : ' private'}">${isPublic ? 'Público' : 'Privado'}</div>
      </div>
      ${proj.description ? `<div class="proj-info-desc">${escapeHtml(proj.description)}</div>` : ''}
      ${tags.length ? `<div class="proj-tags">${tags.map(t => `<span class="proj-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>

    <div class="pdm-card">
      <div class="pdm-row">
        <div class="pdm-icon"><svg viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></div>
        <div class="pdm-body">
          <div class="pdm-label">Project ID</div>
          <div class="pdm-val">${pid}</div>
        </div>
        <button class="pdm-btn" title="Copiar ID" onclick="copyToClipboard('${pid}');showToast('ID copiado','success')"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
      </div>
      <div class="pdm-sep"></div>
      <div class="pdm-row">
        <div class="pdm-icon"><svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5"/></svg></div>
        <div class="pdm-body">
          <div class="pdm-label">API Key del proyecto</div>
          <div class="pdm-val">${maskedKey}</div>
        </div>
        ${proj.apiKey ? `<button class="pdm-btn" title="Copiar API Key" onclick="copyToClipboard('${escapeHtml(proj.apiKey)}');showToast('API Key copiada','success')"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>` : '<div style="width:34px"></div>'}
      </div>
    </div>

    <div class="proj-files-head">
      <span class="proj-files-title">Archivos del proyecto</span>
      <button class="proj-files-upload" onclick="openProjectUpload('${pid}')">+ Subir</button>
    </div>
    <div id="projFilesZone">
      <div class="proj-empty-zone" style="cursor:pointer" onclick="openProjectUpload('${pid}')">
        <div class="proj-empty-icon">
          <svg viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
        </div>
        <div class="proj-empty-title">Sin archivos todavía</div>
        <div class="proj-empty-sub">Toca aquí o usa "+ Subir" para añadir imágenes, videos, documentos o APK.</div>
      </div>
    </div>
  `;

  goPage('proj-detail');
  loadProjectFiles(rawPid);
}

// ─── Upload de archivos al proyecto ──────────────────────────
function openProjectUpload(projectId) {
  const inp = document.createElement('input');
  inp.type     = 'file';
  inp.multiple = true;
  inp.accept   = 'image/*,video/*,audio/*,application/pdf,.apk,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.txt,application/octet-stream';
  inp.style.display = 'none';
  document.body.appendChild(inp);

  inp.addEventListener('change', async () => {
    const files = Array.from(inp.files || []);
    inp.remove();
    if (!files.length) return;
    await handleProjectUpload(projectId, files);
  });

  inp.click();
}

async function handleProjectUpload(projectId, files) {
  const total = files.length;
  let done = 0;
  let errors = 0;

  showToast(`Subiendo ${total} archivo${total !== 1 ? 's' : ''}…`);

  for (const file of files) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('projectId', projectId);
      await API.uploadToProject(fd);
      done++;
    } catch (e) {
      errors++;
      console.warn('[handleProjectUpload]', file.name, e.message);
    }
  }

  if (errors === 0) {
    showToast(`${done} archivo${done !== 1 ? 's' : ''} subido${done !== 1 ? 's' : ''} correctamente.`, 'success');
  } else if (done > 0) {
    showToast(`${done} subido${done !== 1 ? 's' : ''}, ${errors} con error.`, 'success');
  } else {
    showToast('Error al subir los archivos. Intenta de nuevo.', 'error');
  }

  await loadProjectFiles(projectId);
}

async function loadProjectFiles(projectId) {
  try {
    const res = await API.getFiles();
    const all = res?.data?.files || [];
    State.files = all;
    renderProjectFiles(all, projectId);
  } catch (e) {
    console.warn('[loadProjectFiles]', e.message);
  }
}

function renderProjectFiles(allFiles, projectId) {
  const zone = document.getElementById('projFilesZone');
  if (!zone) return;

  const pid    = escapeHtml(projectId);
  const files  = allFiles.filter(f =>
    (f.projectId || f.project) === projectId
  );

  if (files.length === 0) {
    zone.innerHTML = `
      <div class="proj-empty-zone" style="cursor:pointer" onclick="openProjectUpload('${pid}')">
        <div class="proj-empty-icon">
          <svg viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
        </div>
        <div class="proj-empty-title">Sin archivos todavía</div>
        <div class="proj-empty-sub">Toca aquí o usa "+ Subir" para añadir imágenes, videos, documentos o APK.</div>
      </div>`;
  } else {
    zone.innerHTML = files.map(fileRowHTML).join('');
  }
}

// ─── Project options popup ───────────────────────────────────
function openProjMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('projMenu');
  const isOpen = menu.classList.contains('open');
  closeProjMenu();
  if (!isOpen) {
    menu.classList.add('open');
    setTimeout(() => document.addEventListener('click', closeProjMenu, { once: true }), 0);
  }
}
function closeProjMenu() {
  document.getElementById('projMenu')?.classList.remove('open');
}
function handleProjShare() {
  closeProjMenu();
  const proj = State.selectedProject;
  if (!proj) return;
  const url = `${location.origin}/p/${proj.projectId || proj.id}`;
  if (navigator.share) {
    navigator.share({ title: proj.name, url }).catch(() => {});
  } else {
    copyToClipboard(url);
    showToast('Enlace copiado al portapapeles', 'success');
  }
}
function handleProjCopyId() {
  closeProjMenu();
  const proj = State.selectedProject;
  if (!proj) return;
  copyToClipboard(proj.projectId || proj.id);
  showToast('ID del proyecto copiado', 'success');
}
function handleProjCopyKey() {
  closeProjMenu();
  const proj = State.selectedProject;
  if (!proj || !proj.apiKey) { showToast('Sin API Key asignada', 'error'); return; }
  copyToClipboard(proj.apiKey);
  showToast('API Key copiada', 'success');
}
function handleProjDeleteOpen() {
  closeProjMenu();
  const proj = State.selectedProject;
  if (!proj) return;
  const letter = avatarLetter(proj.name);
  const color  = avatarColor(proj.projectId || proj.id || proj.name);
  const av = document.getElementById('pdelAvatar');
  av.textContent = letter;
  av.style.background = color;
  document.getElementById('pdelName').textContent = proj.name;
  document.getElementById('pdelDate').textContent = 'Creado el ' + formatDate(proj.createdAt);
  document.getElementById('pdelBackdrop').classList.add('show');
}
function closePdelDialog() {
  document.getElementById('pdelBackdrop').classList.remove('show');
}
function handlePdelBackdrop(e) {
  if (e.target === document.getElementById('pdelBackdrop')) closePdelDialog();
}
async function confirmProjDelete() {
  const proj = State.selectedProject;
  if (!proj) return;
  const btn = document.getElementById('pdelConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Eliminando...';
  try {
    await API.request('DELETE', `/api/projects/${proj.projectId || proj.id}`);
    closePdelDialog();
    showToast('Proyecto eliminado', 'success');
    State.selectedProject = null;
    await loadProjects();
    goPage('proyectos');
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Eliminar proyecto';
    showToast('Error: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  TRASH ACTIONS
// ═══════════════════════════════════════════════════════════════
async function handleEmptyTrash() {
  const btn = document.getElementById('emptyTrashBtn');
  setBtnLoading(btn, true);
  try {
    await API.emptyTrash();
    showToast('Papelera vaciada', 'success');
    loadTrash();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleRestoreKey(id) {
  try {
    await API.restoreKey(id);
    showToast('Clave restaurada correctamente', 'success');

    // Remove from DOM
    const row = document.getElementById('trash-' + id);
    if (row) {
      row.style.transition = 'opacity .25s, transform .25s';
      row.style.opacity = '0';
      row.style.transform = 'scale(.96)';
      setTimeout(() => { row.remove(); loadTrash(); }, 260);
    } else {
      loadTrash();
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  UTIL — Clipboard y visibilidad de clave
// ═══════════════════════════════════════════════════════════════
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copiado al portapapeles', 'success');
  }).catch(() => {
    showToast('No se pudo copiar', 'error');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _keyVisible = {};
function toggleKeyVisibility(keyId, fullKey) {
  const el = document.getElementById('keytext-' + keyId);
  if (!el) return;
  if (_keyVisible[keyId]) {
    el.textContent = maskKey(fullKey);
    _keyVisible[keyId] = false;
  } else {
    el.textContent = fullKey;
    _keyVisible[keyId] = true;
    setTimeout(() => {
      if (_keyVisible[keyId]) {
        el.textContent = maskKey(fullKey);
        _keyVisible[keyId] = false;
      }
    }, 10000);
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  AUTH TAB SWITCH
// ═══════════════════════════════════════════════════════════════
function switchAuthTab(tab) {
  document.getElementById('formLogin').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('formRegister').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('tabLogin').classList.toggle('auth-tab-on',    tab === 'login');
  document.getElementById('tabRegister').classList.toggle('auth-tab-on', tab === 'register');
  document.getElementById('authError').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════
// ║  DIALOG — REGISTER
// ═══════════════════════════════════════════════════════════════
async function handleRegister() {
  const name  = document.getElementById('regName').value.trim();
  const user  = document.getElementById('regUser').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPass').value;
  const btn   = document.getElementById('registerBtn');
  const errEl = document.getElementById('authError');
  const errMsg = document.getElementById('authErrorMsg');

  errEl.classList.remove('show');

  if (!name || !user || !email || !pass) {
    errMsg.textContent = 'Completa todos los campos para continuar.';
    errEl.classList.add('show');
    return;
  }

  setBtnLoading(btn, true);

  try {
    const res = await API.register(name, user, email, pass);
    if (!res.success || !res.token) throw new Error(res.message || 'Error al registrar.');

    Auth.setToken(res.token);
    Auth.setUser(res.user);

    updateUserUI(res.user);
    hideLogin();
    await loadDashboard();
    showToast('¡Cuenta creada! Bienvenido, ' + (res.user?.name || '') + ' 🎉', 'success');
  } catch (e) {
    errMsg.textContent = e.message || 'No se pudo crear la cuenta. Inténtalo de nuevo.';
    errEl.classList.add('show');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  DIALOG — LOGIN
// ═══════════════════════════════════════════════════════════════
function showLogin() {
  window.location.href = '/login';
}
function hideLogin() {
  // login está en login.html — no aplica aquí
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  const errMsg = document.getElementById('loginErrorMsg');

  document.getElementById('authError').classList.remove('show');

  if (!email || !pass) {
    document.getElementById('authErrorMsg').textContent = 'Ingresa tu correo y contraseña.';
    document.getElementById('authError').classList.add('show');
    return;
  }

  setBtnLoading(btn, true);

  try {
    const res = await API.login(email, pass);
    if (!res.success || !res.token) throw new Error(res.message || 'Error de autenticación.');

    Auth.setToken(res.token);
    Auth.setUser(res.user);

    updateUserUI(res.user);
    hideLogin();
    await loadDashboard();
    showToast('¡Bienvenido de vuelta, ' + (res.user?.name || '') + '!', 'success');
  } catch (e) {
    errMsg.textContent = e.message || 'Credenciales inválidas. Inténtalo de nuevo.';
    errEl.classList.add('show');
  } finally {
    setBtnLoading(btn, false);
  }
}

function handleLogout() {
  Auth.clear();
  State.files = [];
  State.projects = [];
  State.apiKeys = [];
  State.activity = [];
  State.notifications = [];
  State.trash = [];
  showToast('Sesión cerrada');
  setTimeout(() => window.location.href = '/login', 700);
}

// ═══════════════════════════════════════════════════════════════
// ║  DIALOG — CREATE API KEY
// ═══════════════════════════════════════════════════════════════
let _apiPermLevel = 'all';
let _apiNewKey    = '';
let _apiKeyVisible = false;

const _permLevelDescriptions = {
  none:   'Sin acceso a ningún recurso de la API.',
  read:   'Solo lectura en todos los recursos.',
  all:    'Acceso completo a todos los recursos.',
  custom: 'Configura permisos individuales por recurso.'
};

function openCreateKeyDialog() {
  const modal = document.getElementById('apiModal');
  document.getElementById('apiStep1').style.display = '';
  document.getElementById('apiStep2').style.display = 'none';
  document.getElementById('apiKeyName').value = '';
  document.getElementById('apiKeyName').style.boxShadow = '';

  // Reset to "Todo"
  setPermLevel('all', document.querySelector('#permTabs .perm-tab:nth-child(3)'));
  document.getElementById('granularSection').style.display = 'none';

  modal.classList.add('show');
  setTimeout(() => document.getElementById('apiKeyName').focus(), 380);
}

function closeApiModal() {
  const modal = document.getElementById('apiModal');
  modal.classList.remove('show');
  if (document.getElementById('apiStep2').style.display !== 'none') {
    loadApiKeys();
  }
}

function handleModalBackdropClick(e) {
  if (e.target === document.getElementById('apiModal')) closeApiModal();
}

function setPermLevel(level, btn) {
  _apiPermLevel = level;
  document.querySelectorAll('.perm-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const desc = document.getElementById('permLevelDesc');
  if (desc) desc.textContent = _permLevelDescriptions[level] || '';
  const granular = document.getElementById('granularSection');
  if (granular) granular.style.display = level === 'custom' ? '' : 'none';
  if (level === 'custom') updatePermCount();
}

function updatePermCount() {
  const selects = ['gr-posts','gr-cats','gr-images','gr-videos','gr-files','gr-analytics','gr-projects'];
  const active = selects.filter(id => {
    const el = document.getElementById(id);
    return el && el.value !== 'none';
  }).length;
  const lbl = document.getElementById('permCountLabel');
  if (lbl) lbl.textContent = `${active} permiso${active !== 1 ? 's' : ''} configurado${active !== 1 ? 's' : ''}`;
}

async function createApiKey() {
  const nameEl = document.getElementById('apiKeyName');
  const btn    = document.getElementById('apiCreateBtn');
  const name   = nameEl?.value.trim() || '';

  if (!name) {
    nameEl.style.boxShadow = '0 0 0 2px rgba(229,72,77,.4)';
    nameEl.focus();
    setTimeout(() => nameEl.style.boxShadow = '', 1200);
    return;
  }

  setBtnLoading(btn, true);

  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let rawKey = 'cvlt_sk_live_';
    for (let i = 0; i < 20; i++) rawKey += chars[Math.floor(Math.random() * chars.length)];

    const id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') : Date.now().toString(36);

    let granularPerms = {};
    if (_apiPermLevel === 'custom') {
      ['posts','cats','images','videos','files','analytics','projects'].forEach(r => {
        const el = document.getElementById('gr-' + r);
        if (el) granularPerms[r] = el.value;
      });
    }

    const payload = {
      id, name,
      perm: _apiPermLevel,
      permLabel: _permLevelDescriptions[_apiPermLevel] || '',
      key: rawKey,
      created: new Date().toISOString(),
      projectId: '',
      permissions: granularPerms
    };

    await API.createApiKey(payload);

    _apiNewKey    = rawKey;
    _apiKeyVisible = false;
    const display = document.getElementById('newKeyDisplay');
    if (display) display.textContent = partialMaskKey(rawKey);
    document.getElementById('apiStep1').style.display = 'none';
    document.getElementById('apiStep2').style.display = '';

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

function toggleNewKeyVisibility() {
  if (!_apiNewKey) return;
  _apiKeyVisible = !_apiKeyVisible;
  const display = document.getElementById('newKeyDisplay');
  const icon    = document.getElementById('newKeyEyeIcon');
  if (display) display.textContent = _apiKeyVisible ? _apiNewKey : partialMaskKey(_apiNewKey);
  if (icon) {
    icon.innerHTML = _apiKeyVisible
      ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }
}

function copyNewKey() {
  if (!_apiNewKey) return;
  copyToClipboard(_apiNewKey);
  showToast('Clave copiada al portapapeles.', 'success');
}

// ═══════════════════════════════════════════════════════════════
// ║  DIALOG — DELETE API KEY
// ═══════════════════════════════════════════════════════════════
let _delApiId  = null;
let _delDomId  = null;
let _delKeyLabel = '';

function openDelDialog(btn, name, apiId, keyVal) {
  const card = btn.closest('.api-key-card');
  _delDomId  = card ? card.id : null;
  _delApiId  = apiId;
  _delKeyLabel = name;
  document.getElementById('delKeyName').textContent = name + '  ·  ' + keyVal;
  document.getElementById('delBackdrop').classList.add('show');
  document.getElementById('delConfirmBtn').onclick = confirmDelete;
}

function closeDelDialog(e) {
  if (e && e.target !== document.getElementById('delBackdrop')) return;
  document.getElementById('delBackdrop').classList.remove('show');
}

async function confirmDelete() {
  const btn = document.getElementById('delConfirmBtn');
  setBtnLoading(btn, true);

  try {
    await API.deleteApiKey(_delApiId);

    // Remove card from DOM
    if (_delDomId) {
      const card = document.getElementById(_delDomId);
      if (card) {
        card.style.transition = 'opacity .25s, transform .25s';
        card.style.opacity = '0';
        card.style.transform = 'scale(.96)';
        setTimeout(() => {
          card.remove();
          const remaining = document.querySelectorAll('#page-apikeys .api-key-card');
          if (remaining.length === 0) {
            document.getElementById('apiEmptyState').classList.add('show');
            document.getElementById('apiUsageSection').style.display = 'none';
          }
        }, 260);
      }
    }

    document.getElementById('delBackdrop').classList.remove('show');
    showToast('Clave "' + _delKeyLabel + '" eliminada', 'success');

    // Refresh trash badge
    API.getTrash().then(res => {
      const count = res?.data?.items?.length || 0;
      const badge = document.getElementById('badge-papelera');
      if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
    }).catch(() => {});

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  GREETER — Saludo dinámico y datos de usuario
// ═══════════════════════════════════════════════════════════════
function setGreeting() {
  const h = new Date().getHours();
  let msg = 'Buenas noches';
  if (h >= 5 && h < 12)  msg = 'Buenos días';
  else if (h >= 12 && h < 19) msg = 'Buenas tardes';
  const el = document.getElementById('greetingTime');
  if (el) el.textContent = msg;
}

function updateUserUI(user) {
  if (!user) return;
  const name   = user.name || user.username || 'Usuario';
  const email  = user.email || '';
  const letter = avatarLetter(name);
  const color  = avatarColor(name);

  const el = document.getElementById('greetingName');
  if (el) el.textContent = name.split(' ')[0];
  const uName = document.getElementById('uName');
  if (uName) uName.textContent = name;
  const uEmail = document.getElementById('uEmail');
  if (uEmail) uEmail.textContent = email;

  const uAvatar = document.getElementById('uAvatar');
  if (uAvatar) {
    const photoUrl = user.avatar || user.picture || '';
    if (photoUrl) {
      uAvatar.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(letter)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
      uAvatar.style.background = 'transparent';
    } else {
      uAvatar.innerHTML = '';
      uAvatar.textContent = letter;
      uAvatar.style.background = color;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ║  KEYBOARD — Enter en campos de login
// ═══════════════════════════════════════════════════════════════
function initKeyboardShortcuts() {
  document.getElementById('loginPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPass')?.focus();
  });
  document.getElementById('apiKeyName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') createApiKey();
  });
  document.getElementById('regPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });
}

// ═══════════════════════════════════════════════════════════════
// ║  INIT — Punto de entrada de la aplicación
// ═══════════════════════════════════════════════════════════════
async function init() {
  setGreeting();
  initKeyboardShortcuts();

  // Handle tokens delivered via URL query param (OAuth callbacks)
  const urlParams  = new URLSearchParams(window.location.search);
  const urlToken   = urlParams.get('token');
  const urlRefresh = urlParams.get('refreshToken');
  if (urlToken) {
    Auth.setToken(urlToken);
    if (urlRefresh) Auth.setRefreshToken(urlRefresh);
    history.replaceState({}, '', window.location.pathname);
  }

  // ── Retorno de Stripe Checkout ────────────────────────────────────────
  const checkoutFlag = urlParams.get('checkout');
  const paidPlan     = urlParams.get('plan');
  if (checkoutFlag === 'success') {
    setTimeout(() => showToast(
      `¡Pago recibido! Tu plan ${paidPlan ? paidPlan.charAt(0).toUpperCase() + paidPlan.slice(1) : ''} ya está activo.`,
      'success'
    ), 300);
    history.replaceState({}, '', window.location.pathname);
  } else if (checkoutFlag === 'cancel') {
    setTimeout(() => showToast('Pago cancelado. Puedes intentarlo de nuevo cuando quieras.', 'info'), 300);
    history.replaceState({}, '', window.location.pathname);
  }

  if (!Auth.isLoggedIn()) {
    window.location.href = '/login';
    return;
  }

  // ── Detectar invitado ──────────────────────────────────────────────────
  const cached     = Auth.getUser();
  const cachedUser = cached?.name || cached?.username || cached?.type ? cached : (cached?.user || null);
  const isGuest    = cachedUser?.type === 'guest' || cachedUser?.isGuest === true;

  if (isGuest) {
    // Verificar expiración del JWT del invitado en el cliente
    const guestTok = Auth.getToken();
    try {
      const parts   = guestTok.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        Auth.clear();
        window.location.href = '/login';
        return;
      }
    } catch {
      Auth.clear();
      window.location.href = '/login';
      return;
    }
    updateUserUI({ name: 'Invitado', type: 'guest' });
    await loadDashboard();
    return;
  }

  // ── Usuario normal ─────────────────────────────────────────────────────
  if (cachedUser) updateUserUI(cachedUser);

  try {
    const res = await API.request('GET', '/api/user/profile');
    const profile = res?.data?.user || res?.data || null;
    if (profile?.name || profile?.username || profile?.email) {
      Auth.setUser(profile);
      updateUserUI(profile);
    }
  } catch { /* non-fatal */ }

  await loadDashboard();
}

window.addEventListener('DOMContentLoaded', init);
