'use strict';

// ═══════════════════════════════════════════════════════════════
// ║  CONFIG
// ═══════════════════════════════════════════════════════════════
// ⚙️  Cambia esta URL si tu backend se despliega en otro dominio
const BASE_URL = '';  // paths ya incluyen /api/

const TOKEN_KEY = 'nf_token';   // debe coincidir con api.js → NUBIFLY_CONFIG.TOKEN_KEY
const USER_KEY  = 'nf_user';    // debe coincidir con api.js → NUBIFLY_CONFIG.USER_KEY

// ═══════════════════════════════════════════════════════════════
// ║  AUTH — Gestión de sesión con localStorage
// ═══════════════════════════════════════════════════════════════
const Auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY) || null;
  },
  setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; }
    catch { return null; }
  },
  setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  isLoggedIn() {
    return !!this.getToken();
  }
};

// ═══════════════════════════════════════════════════════════════
// ║  API — Llamadas a los endpoints del servidor
// ═══════════════════════════════════════════════════════════════
const API = {

  /** Realiza una petición autenticada y devuelve el JSON parseado. */
  async request(method, path, body = null, requireAuth = true) {
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
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
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
    const token = Auth.getToken();
    if (!token) throw new Error('NO_TOKEN');
    return this.uploadFile('/api/v1/publications/upload', formData);
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
  document.querySelectorAll('.ana2-tab').forEach(b => b.classList.remove('ana2-tab-on'));
  btn.classList.add('ana2-tab-on');
}

function ana2Period(btn) {
  document.querySelectorAll('.ana2-pill').forEach(b => b.classList.remove('ana2-pill-on'));
  btn.classList.add('ana2-pill-on');
}

let _projAccess = 'private';

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
    const recent = State.files.slice(0, 5);

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
  const isImg = ['jpg','jpeg','png','gif','webp','avif','svg'].includes(ext);
  const thumb = (isImg && f.url)
    ? `<img src="${escapeHtml(f.url)}" style="width:44px;height:44px;border-radius:10px;object-fit:cover;display:block">`
    : `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  return `
    <div class="pub-row" id="frow-${escapeHtml(f.id || '')}">
      <div class="pub-thumb">${thumb}</div>
      <div class="pub-info">
        <div class="pub-title">${escapeHtml(f.fileName || f.originalName || 'Sin nombre')}</div>
        <div class="pub-meta">
          <span class="pub-badge badge-pub">Publicado</span>
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

async function handleDeleteFile(fileId, btn) {
  if (!fileId) return;
  if (!confirm('¿Eliminar este archivo? Esta acción no se puede deshacer.')) return;
  if (btn) { btn.disabled = true; btn.style.opacity = '.4'; }
  try {
    await API.deleteFile(fileId);
    State.files = State.files.filter(f => f.id !== fileId);
    const row = document.getElementById('frow-' + fileId);
    if (row) row.remove();
    showToast('Archivo eliminado.', 'success');
    if (!State.files.length) {
      const c = document.getElementById('allFilesList');
      if (c) c.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        'Sin archivos', 'Aún no has subido ningún archivo.'
      );
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function loadFiles() {
  const container   = document.getElementById('allFilesList');
  const searchInput = document.getElementById('searchInput');

  if (container) container.innerHTML = `<div class="list-loading"><div class="auth-spinner"></div></div>`;

  try {
    const res = await API.getFiles();
    State.files = res?.data?.files || [];

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

    renderFiles(State.files);

    if (searchInput) {
      searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase();
        const filtered = q
          ? State.files.filter(f => (f.fileName || f.originalName || '').toLowerCase().includes(q))
          : State.files;
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

      const totalCalls = State.apiKeys.reduce((s, k) => s + (k.calls || 0), 0);
      document.getElementById('totalCalls').textContent = totalCalls;

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
    }

    // Update nav badge
    const badge = document.getElementById('badge-papelera');
    if (badge) { badge.style.display = 'none'; }

  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando claves. <button onclick="loadApiKeys()" style="color:var(--blue);font-weight:600">Reintentar</button></div>`;
    console.warn('[loadApiKeys]', e.message);
  }
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
      container.innerHTML = notifs.map(n => `
        <div class="notif-row">
          <div class="notif-dot${n.read ? ' read' : ''}"></div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-desc">${escapeHtml(n.body)}</div>
            <div class="notif-time">${timeAgo(n.createdAt)}</div>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando notificaciones.</div>`;
    console.warn('[loadNotifications]', e.message);
  }
}

async function loadActivity() {
  const container = document.getElementById('activityList');

  try {
    const res = await API.getActivity();
    State.activity = res?.data?.activity || [];

    if (State.activity.length === 0) {
      container.innerHTML = emptyListHTML(
        `<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        'Sin actividad', 'Tu actividad de API aparecerá aquí.'
      );
    } else {
      const methodClass = { GET:'method-get', POST:'method-post', DELETE:'method-delete' };
      container.innerHTML = State.activity.map(ev => {
        const method = (ev.method || 'GET').toUpperCase();
        const cls = methodClass[method] || 'method-get';
        return `
          <div class="log-row">
            <span class="log-method ${cls}">${method}</span>
            <div class="log-body">
              <div class="log-path">${escapeHtml(ev.path || ev.endpoint || '/api/v1')}</div>
              <div class="log-status">${ev.status ? ev.status + ' · ' : ''}${ev.ms ? ev.ms + 'ms' : 'OK'}</div>
            </div>
            <span class="log-time">${timeAgo(ev.ts || ev.createdAt)}</span>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Error cargando actividad.</div>`;
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
let _selectedFile = null;

function handleFileSelect(input) {
  _selectedFile = input.files[0] || null;
  const titleEl = document.getElementById('uploadTitle');
  if (_selectedFile) {
    titleEl.textContent = _selectedFile.name;
  } else {
    titleEl.textContent = 'Subir Archivo';
  }
}

async function handlePublish() {
  const title = document.getElementById('pubTitle')?.value.trim();
  const desc  = document.getElementById('pubDesc')?.value.trim();
  const btn   = document.getElementById('pubBtn');
  const btn2  = document.getElementById('pubBtn2');

  if (!_selectedFile) {
    showToast('Selecciona un archivo primero', 'error');
    return;
  }

  setBtnLoading(btn, true);
  setBtnLoading(btn2, true);

  try {
    const fd = new FormData();
    fd.append('file', _selectedFile);
    if (title) fd.append('title', title);
    if (desc)  fd.append('description', desc);

    await API.publishFile(fd);

    showToast('¡Publicación creada correctamente!', 'success');
    _selectedFile = null;
    document.getElementById('pubTitle').value = '';
    document.getElementById('pubDesc').value  = '';
    document.getElementById('uploadTitle').textContent = 'Subir Archivo';
    document.getElementById('fileInput').value = '';
    goPage('panel');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
    setBtnLoading(btn2, false);
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

  document.getElementById('projDetailContent').innerHTML = `
    <div class="proj-info-card">
      <div class="proj-info-top">
        <div class="proj-avatar" style="background:${color};width:48px;height:48px;border-radius:14px;font-size:20px">${letter}</div>
        <div class="proj-info-meta">
          <div class="proj-info-name">${escapeHtml(proj.name)}</div>
          <div class="proj-info-date">Creado el ${formatDate(proj.createdAt)}</div>
        </div>
      </div>
      ${proj.description ? `<div class="proj-info-desc">${escapeHtml(proj.description)}</div>` : ''}
    </div>

    <div class="pdm-card">
      <div class="pdm-row">
        <div class="pdm-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8A96" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></div>
        <div class="pdm-body">
          <div class="pdm-label">Project ID</div>
          <div class="pdm-val">${escapeHtml(proj.projectId || proj.id)}</div>
        </div>
        <button class="pdm-btn" onclick="copyToClipboard('${escapeHtml(proj.projectId || proj.id)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
      </div>
      <div class="pdm-sep"></div>
      <div class="pdm-row">
        <div class="pdm-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8A96" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778"/></svg></div>
        <div class="pdm-body">
          <div class="pdm-label">API Key del proyecto</div>
          <div class="pdm-val">${maskedKey}</div>
        </div>
        ${proj.apiKey ? `<button class="pdm-btn" onclick="copyToClipboard('${escapeHtml(proj.apiKey)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>` : ''}
      </div>
    </div>
  `;

  goPage('proj-detail');
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
    if (display) display.textContent = rawKey.replace(/./g, '•');
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
  if (display) display.textContent = _apiKeyVisible ? _apiNewKey : _apiNewKey.replace(/./g, '•');
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
  const name = user.name || user.username || 'Usuario';
  const email = user.email || '';
  const letter = avatarLetter(name);

  const el = document.getElementById('greetingName');
  if (el) el.textContent = name.split(' ')[0];
  const uName = document.getElementById('uName');
  if (uName) uName.textContent = name;
  const uEmail = document.getElementById('uEmail');
  if (uEmail) uEmail.textContent = email;
  const uAvatar = document.getElementById('uAvatar');
  if (uAvatar) uAvatar.textContent = letter;
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

  if (!Auth.isLoggedIn()) {
    window.location.href = '/login';
    return;
  }

  const user = Auth.getUser();
  if (user) updateUserUI(user);
  await loadDashboard();
}

window.addEventListener('DOMContentLoaded', init);
