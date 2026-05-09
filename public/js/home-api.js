/* ════════════════════════════════════════════════════════════
   home-api.js — Nubifly Home Page: Backend Bridge
   Loads after home.js. Replaces mock data with real API calls.
   ════════════════════════════════════════════════════════════ */

/* ─── Auth guard ─────────────────────────────────────────── */

// Hard-fail loudly if api.js wasn't loaded — without it nothing in this
// file can run and the page would silently break.
if (typeof window.NubiflyAPI === 'undefined') {
  console.error('[home-api] api.js no se cargó: NubiflyAPI no está disponible.');
  // Don't redirect — the user might still see the static UI.
  // Boot will simply skip if NubiflyAPI is missing.
}

// Decode JWT payload without verifying signature (safe for display only).
function _decodeJwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
}

// Pick up JWT from Google OAuth redirect (?token=...)
(function () {
  if (typeof window.NubiflyAPI === 'undefined') return;
  const p = new URLSearchParams(window.location.search);
  const t = p.get('token');
  if (t) {
    const payload = _decodeJwtPayload(t);
    // Always store a user object — never null — so the drawer shows
    // something useful even before the /api/user/profile call returns.
    NubiflyAPI.setSession(t, {
      uid:      (payload?.uid)      || '',
      username: (payload?.username) || '',
      email:    (payload?.email)    || '',
      name:     (payload?.username) || (payload?.email) || ''
    });
    if (payload?.uid) localStorage.setItem('nf_uid', payload.uid);
    history.replaceState({}, '', window.location.pathname);
  }
})();

if (typeof window.NubiflyAPI !== 'undefined' && !NubiflyAPI.getToken()) {
  // Break any redirect loop: if we've bounced here more than twice without a
  // valid token, something is broken — clear state instead of looping forever.
  const _cnt = Number(sessionStorage.getItem('_nf_home_redir') || 0);
  if (_cnt < 2) {
    sessionStorage.setItem('_nf_home_redir', _cnt + 1);
    window.location.replace('/login');
  } else {
    sessionStorage.removeItem('_nf_home_redir');
    NubiflyAPI.clearSession();
  }
}

/* ─── State ──────────────────────────────────────────────── */

let _projects      = [];
let _files         = {};   // { projectId: [file, ...] }
let _publications  = [];   // populated from GET /api/user/publications
let _notifications = [];   // populated from GET /api/user/notifications
let _activity      = [];   // populated from GET /api/user/activity

/* UI rendering state shared with home.js wrappers
   ─ projects, currentProjId, projColors are declared in home.js;
     redeclaring them here would throw SyntaxError under classic <script>
     loading and would prevent this entire file from executing. ─ */

/* ─── Helper: map API project → local shape ─────────────── */

function _toLocalProj(p, i) {
  const idx = (typeof i === 'number') ? i : projects.length;
  return {
    id:        p.projectId || p.id,
    projectId: p.projectId || p.id,
    name:      p.name,
    desc:      p.description || p.desc || '',
    tags:      p.tags || [],
    access:    p.access || 'private',
    apiKey:    p.apiKey ? { key: p.apiKey } : null,
    color:     projColors[idx % projColors.length],
    files:     [],
    date:      null,
    created:   p.createdAt
      ? new Date(p.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : ''
  };
}

/* ─── Boot ───────────────────────────────────────────────── */

// Safe wrapper: invokes a render function only if it exists.
// Used in finally{} blocks so a thrown render never breaks subsequent ones.
function _safeRender(fn) {
  try { if (typeof fn === 'function') fn(); }
  catch (e) { console.warn('[render] failed:', e?.message); }
}

(async function boot() {
  // If api.js failed to load, render once with empty state and bail out.
  if (typeof window.NubiflyAPI === 'undefined') {
    _safeRender(() => typeof renderProjects     === 'function' && renderProjects());
    _safeRender(() => typeof renderRecentPubs   === 'function' && renderRecentPubs());
    _safeRender(() => typeof renderTodasPubs    === 'function' && renderTodasPubs());
    _safeRender(() => typeof renderNotifications === 'function' && renderNotifications());
    _safeRender(() => typeof renderActivity     === 'function' && renderActivity());
    return;
  }

  // Clean up old localStorage-based API key data (migrated to Firebase)
  localStorage.removeItem('nf_apiKeys');
  localStorage.removeItem('nf_trashItems');

  // Show cached user immediately so the drawer is never blank.
  // If localStorage has no user (e.g. fresh OAuth redirect stored null),
  // fall back to decoding the JWT payload — it always has username + email.
  const cachedUser = NubiflyAPI.getUser();
  if (cachedUser) {
    populateProfile(cachedUser, null);
  } else {
    const token = NubiflyAPI.getToken();
    const jwtData = token ? _decodeJwtPayload(token) : null;
    if (jwtData) {
      populateProfile({
        name:     jwtData.username || jwtData.email || '',
        username: jwtData.username || '',
        email:    jwtData.email    || ''
      }, null);
    }
  }

  try {
    // Load all data in parallel — use allSettled so a single failure doesn't block everything
    const [rUser, rDash, rProjects, rKeys, rTrash, rFiles, rPubs, rNotifs, rActivity] = await Promise.allSettled([
      NubiflyAPI.loadUserData(),
      NubiflyAPI.loadDashboard(),
      NubiflyAPI.loadProjects(),
      NubiflyAPI.listUserApiKeys(),
      NubiflyAPI.listUserApiKeyTrash(),
      NubiflyAPI.loadUserFiles(),
      NubiflyAPI.loadUserPublications(),
      NubiflyAPI.loadNotifications(),
      NubiflyAPI.loadApiActivity()
    ]);

    if (rUser.status === 'fulfilled') {
      populateProfile(rUser.value, rDash.status === 'fulfilled' ? rDash.value : null);
    } else {
      console.error('[boot] loadUserData failed:', rUser.reason);
      const status = rUser.reason?.status;
      if (status === 401 || status === 403) { NubiflyAPI.logoutUser(); return; }
    }

    if (rDash.status === 'fulfilled') {
      updateDashboardCounters(rDash.value);
    } else {
      console.warn('[boot] loadDashboard failed:', rDash.reason?.message);
    }

    const keys  = rKeys.status  === 'fulfilled' ? (rKeys.value  || []) : [];
    const trash = rTrash.status === 'fulfilled' ? (rTrash.value || []) : [];
    if (rKeys.status  !== 'fulfilled') console.warn('[boot] listUserApiKeys failed:', rKeys.reason?.message);
    if (rTrash.status !== 'fulfilled') console.warn('[boot] listUserApiKeyTrash failed:', rTrash.reason?.message);

    // Mutate the global arrays in place — ApiKeys.render() and Trash.render()
    // read directly from the globals (`apiKeys`, `trashItems`) declared in
    // home.js, NOT from Store.get(). Replacing the Store reference would
    // leave the globals empty and the dashboard stuck at 0.
    apiKeys.length = 0;    apiKeys.push(...keys);
    trashItems.length = 0; trashItems.push(...trash);
    ApiKeys.render();
    Trash.render();

    const rawProjects = rProjects.status === 'fulfilled' ? (rProjects.value || []) : [];
    if (rProjects.status !== 'fulfilled') console.warn('[boot] loadProjects failed:', rProjects.reason?.message);

    _projects = rawProjects;
    const mapped = _projects.map((p, i) => _toLocalProj(p, i));
    projects = mapped;

    // Seed project file caches from the user-files index so Publicaciones
    // Recientes is populated on first load without opening each project.
    if (rFiles.status === 'fulfilled') {
      (rFiles.value || []).forEach(f => {
        const p = projects.find(x => x.id === f.projectId || x.projectId === f.projectId);
        if (p && !p.files.find(pf => (pf.fileId || pf.id) === (f.fileId || f.id))) {
          p.files.push({
            id:       f.fileId || f.id,
            fileId:   f.fileId || f.id,
            name:     f.fileName || f.name || 'Archivo',
            size:     formatBytes(f.fileSize || f.size || 0),
            url:      f.fileUrl  || f.url  || '',
            projName: p.name
          });
        }
      });
    } else {
      console.warn('[boot] loadUserFiles failed:', rFiles.reason?.message);
    }

    if (rPubs.status === 'fulfilled') {
      _publications = rPubs.value || [];
    } else {
      console.warn('[boot] loadUserPublications failed:', rPubs.reason?.message);
      _publications = [];
    }

    // Actualizar categorías con datos reales de publicaciones (sin proyectos)
    if (typeof Categories !== 'undefined' && typeof Categories.refreshFromPublications === 'function') {
      Categories.refreshFromPublications(_publications);
    }

    if (rNotifs.status === 'fulfilled') {
      _notifications = rNotifs.value?.notifications || [];
    } else {
      console.warn('[boot] loadNotifications failed:', rNotifs.reason?.message);
      _notifications = [];
    }

    if (rActivity.status === 'fulfilled') {
      _activity = rActivity.value || [];
    } else {
      console.warn('[boot] loadApiActivity failed:', rActivity.reason?.message);
      _activity = [];
    }

  } catch (err) {
    console.error('[boot] unexpected error:', err);
  } finally {
    // Always render — even when API calls failed — so empty states show up
    // and the user sees a working UI instead of a blank page.
    _safeRender(renderProjects);
    _safeRender(renderRecentPubs);
    _safeRender(renderTodasPubs);
    _safeRender(updatePublicationCounters);
    _safeRender(renderNotifications);
    _safeRender(renderActivity);
    _safeRender(updateNotifBadge);
    // Render analytics if the API Keys page is already visible
    _safeRender(() => {
      const apiPage = document.getElementById('page-apikeys');
      if (apiPage && apiPage.classList.contains('active')) renderApiUsageAnalysis();
    });
  }
})();

/* ─── Profile UI ─────────────────────────────────────────── */

function populateProfile(user, dash) {
  if (!user) return;

  // Display name: prefer name → username → email (never leave blank)
  const displayName = user.name || user.username || user.email || '';
  const avatarChar  = (displayName[0] || 'U').toUpperCase();

  // Avatar
  document.querySelectorAll('[data-user-avatar]').forEach(el => {
    el.src = user.avatar
      ? user.avatar
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarChar)}&background=6366f1&color=fff&size=128`;
  });

  // Name / username / email / plan — always set if we have a value
  if (displayName)         setText('[data-user-name]',     displayName);
  if (user.username)       setText('[data-user-username]', '@' + user.username);
  if (user.email)          setText('[data-user-email]',    user.email);
  if (user.plan)           setText('[data-user-plan]',     user.plan);
  if (user.accountStatus)  setText('[data-user-status]',   user.accountStatus);
}

function updateDashboardCounters(dash) {
  if (!dash) return;
  setText('[data-stat-projects]', dash.projectCount ?? 0);
  setText('[data-stat-files]',    dash.fileCount    ?? 0);
  setText('[data-stat-storage]',  formatBytes(dash.storageUsed ?? 0));
}

function setText(selector, value) {
  document.querySelectorAll(selector).forEach(el => { el.textContent = value; });
}

function formatBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

/* ─── Projects: override saveProject() in home.js ───────── */

// Wrap the original saveProject so it persists to backend
const _origSaveProject = window.saveProject;
window.saveProject = async function () {
  const name        = document.getElementById('projName')?.value?.trim();
  const description = document.getElementById('projDesc')?.value?.trim() || '';

  if (!name) { showToast('⚠️ El nombre del proyecto es requerido', 'warn'); return; }

  try {
    const proj = await NubiflyAPI.createProject({ name, description });

    // Auto-generate a project API key so it's ready to use immediately
    try {
      const keyResult = await NubiflyAPI.generateApiKey(proj.projectId || proj.id);
      if (keyResult?.apiKey) proj.apiKey = keyResult.apiKey;
    } catch (_) { /* non-critical — key can be generated later */ }

    // Map to the shape renderProjects() expects and push to both arrays
    const localProj = _toLocalProj(proj, projects.length);
    _projects.unshift(proj);
    projects = [localProj, ...projects];

    closeProjModal();
    renderProjects();
    showToast('✓ Proyecto creado correctamente');
  } catch (err) {
    showToast('✗ ' + (err.message || 'Error creando proyecto'), 'error');
  }
};

/* ─── Projects: override confirmDeleteProj() in home.js ─── */

const _origConfirmDeleteProj = window.confirmDeleteProj;
window.confirmDeleteProj = async function () {
  if (!currentProjId) return;
  try {
    await NubiflyAPI.deleteProject(currentProjId);
    // Remove from local arrays
    const idx1 = _projects.findIndex(p => p.id === currentProjId || p.projectId === currentProjId);
    if (idx1 !== -1) _projects.splice(idx1, 1);
    projects = projects.filter(p => p.id !== currentProjId);

    closeDelProjModal();
    if (typeof currentPage !== 'undefined' && currentPage === 'proj-detail') goPage('proyectos');
    renderProjects();
    showToast('✓ Proyecto eliminado');
  } catch (err) {
    showToast('✗ ' + (err.message || 'Error eliminando proyecto'), 'error');
    closeDelProjModal();
  }
};

/* ─── API Keys: generate from project detail ────────────── */

window.generateProjectApiKey = async function (projectId) {
  try {
    const result = await NubiflyAPI.generateApiKey(projectId);
    showToast('✓ API Key generada');
    // Update local project
    const p = _projects.find(x => x.projectId === projectId || x.id === projectId);
    if (p) p.apiKey = { key: result.apiKey };
    const p2 = projects.find(x => x.id === projectId);
    if (p2) p2.apiKey = { key: result.apiKey };
    return result.apiKey;
  } catch (err) {
    showToast('✗ ' + (err.message || 'Error generando API Key'), 'error');
  }
};

window.regenerateProjectApiKey = async function (projectId) {
  try {
    const result = await NubiflyAPI.regenerateApiKey(projectId);
    showToast('✓ API Key regenerada');
    const p = _projects.find(x => x.projectId === projectId || x.id === projectId);
    if (p) p.apiKey = { key: result.apiKey };
    const p2 = projects.find(x => x.id === projectId);
    if (p2) p2.apiKey = { key: result.apiKey };
    return result.apiKey;
  } catch (err) {
    showToast('✗ ' + (err.message || 'Error regenerando API Key'), 'error');
  }
};

/* ─── File upload: override handleProjFiles() in home.js ─── */

const _origHandleProjFiles = window.handleProjFiles;
window.handleProjFiles = async function (fileList) {
  if (!currentProjId) { showToast('⚠️ Selecciona un proyecto primero', 'warn'); return; }

  const uploads = Array.from(fileList);
  showToast(`⬆ Subiendo ${uploads.length} archivo(s)…`);

  for (const rawFile of uploads) {
    try {
      const saved = await NubiflyAPI.uploadFile(currentProjId, rawFile);
      const p = projects.find(x => x.id === currentProjId);
      if (p) {
        p.files.push({
          id:     saved.fileId,
          fileId: saved.fileId,
          name:   saved.fileName,
          size:   formatBytes(saved.fileSize),
          url:    saved.fileUrl
        });
        renderProjFiles(p);
        renderRecentPubs();
      }
    } catch (err) {
      showToast('✗ ' + (err.message || 'Error subiendo ' + rawFile.name), 'error');
    }
  }
  showToast(`✓ ${uploads.length} archivo(s) subido(s)`);
};

/* ─── Load files when opening project detail ────────────── */

window.openProjDetail = async function (id) {
  currentProjId = id;
  goPage('proj-detail');

  const findProj = () =>
    projects.find(x => x.id === id || x.projectId === id || x.id === String(id));

  const pMeta = findProj();
  if (pMeta) {
    const setText = (elId, val) => { const e = document.getElementById(elId); if (e) e.textContent = val; };
    setText('detailTitle', pMeta.name || 'Proyecto');
    setText('detailName',  pMeta.name || '—');
    setText('detailDate',  pMeta.created || '—');
    setText('detailDesc',  pMeta.desc || '');
    const avatarEl = document.getElementById('detailAvatar');
    if (avatarEl) avatarEl.textContent = (pMeta.name || 'P')[0].toUpperCase();

    const pidStr    = String(pMeta.projectId || pMeta.id || '');
    const apiKeyStr = pMeta.apiKey?.key || '';
    const pidEl  = document.getElementById('detailProjectId');
    const keyEl  = document.getElementById('detailApiKey');
    const copyBtn = document.getElementById('btnCopyApiKey');
    if (pidEl)  { pidEl.textContent = pidStr || '—'; pidEl.dataset.val = pidStr; }
    if (keyEl)  {
      keyEl.textContent = apiKeyStr ? maskKey(apiKeyStr) : 'Sin clave asignada';
      keyEl.dataset.val = apiKeyStr;
    }
    if (copyBtn) copyBtn.style.opacity = apiKeyStr ? '1' : '0.35';
    renderProjFiles(pMeta);
  }

  try {
    const files = await NubiflyAPI.loadFiles(id);
    const p = findProj();
    if (p) {
      p.files = (files || []).map(f => ({
        id:     f.fileId,
        fileId: f.fileId,
        name:   f.fileName   || f.name || 'Archivo',
        size:   formatBytes(f.fileSize || f.size || 0),
        url:    f.fileUrl    || f.url  || ''
      }));
      renderProjFiles(p);
      renderRecentPubs();
    }
  } catch (err) {
    console.warn('[openProjDetail] no se pudieron cargar archivos:', err.message);
  }
};

/* ─── Publications (loaded from /api/v1/publications/upload) ─── */

function _isPubImage(p) {
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(
    p.fileName || p.name || p.originalName || p.url || p.fileUrl || ''
  );
}

function _pubItemHTML(p) {
  const url   = p.url || p.fileUrl || '';
  const name  = p.title || p.fileName || p.name || p.originalName || 'Archivo';
  const size  = (typeof p.size === 'number' || typeof p.fileSize === 'number')
    ? formatBytes(p.size || p.fileSize || 0)
    : '';
  const thumb = _isPubImage(p) && url
    ? `<div class="rpub-thumb"><img src="${url}" alt="" loading="lazy"></div>`
    : `<div class="rpub-thumb rpub-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`;
  const meta = [p.description || '', size].filter(Boolean).join(' · ');
  return `
    <div class="rpub-item">
      ${thumb}
      <div class="rpub-info">
        <div class="rpub-name">${name}</div>
        <div class="rpub-meta">${meta}</div>
      </div>
      ${url ? `<a class="rpub-link" href="${url}" target="_blank" rel="noopener" title="Abrir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ''}
    </div>`;
}

function _emptyPubsHTML(desc) {
  return `
    <div class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="empty-title">Sin publicaciones todavía</div>
      <div class="empty-desc">${desc}</div>
    </div>`;
}

function renderRecentPubs() {
  const wrap = document.getElementById('recentPubsWrap');
  if (!wrap) return;

  if (!_publications.length) {
    wrap.innerHTML = _emptyPubsHTML('Sube archivos vía <strong>/api/v1/publications/upload</strong><br>para verlos aparecer aquí.');
    return;
  }

  wrap.innerHTML = _publications.slice(0, 8).map(_pubItemHTML).join('');
}

function renderTodasPubs() {
  const wrap = document.getElementById('todasPubsWrap');
  if (!wrap) return;

  if (!_publications.length) {
    wrap.innerHTML = _emptyPubsHTML('Aún no has creado ninguna publicación.<br>Sube archivos vía <strong>/api/v1/publications/upload</strong>.');
    return;
  }

  wrap.innerHTML = _publications.map(_pubItemHTML).join('');
}

function updatePublicationCounters() {
  const total     = _publications.length;
  const published = _publications.filter(p => (p.status || 'published') === 'published').length;

  const totalEl = document.getElementById('statTotalPubs');
  const pubEl   = document.getElementById('statPublishedPubs');
  if (totalEl) totalEl.textContent = String(total);
  if (pubEl)   pubEl.textContent   = String(published);
}

/* ─── Notifications (admin-pushed announcements) ─────────── */

function _emptyState(svgInner, title, desc) {
  return `
    <div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${svgInner}</svg></div>
      <div class="empty-title">${title}</div>
      <div class="empty-desc">${desc}</div>
    </div>`;
}

function _escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000) return 'hace unos segundos';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 604_800_000) return `hace ${Math.floor(diff / 86_400_000)} d`;
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderNotifications() {
  const wrap = document.getElementById('notifWrap');
  if (!wrap) return;

  if (!_notifications.length) {
    wrap.innerHTML = _emptyState(
      '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
      'Sin notificaciones',
      'Aquí aparecerán las novedades de la plataforma.'
    );
    return;
  }

  wrap.innerHTML = _notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${_escape(n.id)}">
      <div class="notif-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="notif-info">
        <div class="notif-title">${_escape(n.title || 'Sin título')}</div>
        <div class="notif-body">${_escape(n.body || '')}</div>
        <div class="notif-meta">${_formatRelative(n.createdAt)}</div>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.notif-item.unread').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-id');
      el.classList.remove('unread');
      try { await NubiflyAPI.markNotificationRead(id); } catch (_) {}
      const idx = _notifications.findIndex(n => n.id === id);
      if (idx >= 0) _notifications[idx].read = true;
      updateNotifBadge();
    }, { once: true });
  });
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const unread = _notifications.filter(n => !n.read).length;
  if (unread > 0) {
    badge.textContent = String(unread);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

/* ─── Activity log (API request usage) ───────────────────── */

function _activityIcon(kind) {
  if (kind === 'publication') {
    return '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>';
  }
  return '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>';
}

function renderActivity() {
  const wrap = document.getElementById('actWrap');
  if (!wrap) return;

  if (!_activity.length) {
    wrap.innerHTML = _emptyState(
      '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      'Sin actividad todavía',
      'Tus solicitudes a la API aparecerán aquí.'
    );
    return;
  }

  wrap.innerHTML = _activity.map(ev => {
    const sourceLabel = ev.source === 'projectKey' ? 'Project key' : 'User key';
    const keyLabel = ev.apiKeyName ? _escape(ev.apiKeyName) : sourceLabel;
    return `
      <div class="act-item">
        <div class="act-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${_activityIcon(ev.kind)}</svg>
        </div>
        <div class="act-info">
          <div class="act-title">${_escape(ev.fileName || ev.title || 'Solicitud API')}</div>
          <div class="act-meta">
            <span class="act-method">${_escape(ev.method || 'POST')}</span>
            ${_escape(ev.endpoint || '')}
          </div>
          <div class="act-meta">${keyLabel} · ${_formatRelative(ev.ts)}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   API KEY USAGE ANALYTICS — renders the "Análisis de uso" panel
   Consumes _activity (events) and apiKeys (live keys) and shows:
     • Hero card with total calls + delta + flowing sparkline
     • 4-stat grid (avg/day, peak day, active keys, days tracked)
     • 14-day vertical bar chart with the peak day labelled
     • Per-key breakdown with sparkline, share %, days active
   ════════════════════════════════════════════════════════════ */

const _ANA_DAY_MS    = 86400000;
const _ANA_PERIOD    = 30;          // window in days for hero/totals
const _ANA_BAR_WIN   = 14;          // window in days for the bar chart
const _ANA_KEY_COLORS = ['#2563EB','#0D8F6F','#6B46C1','#C25300','#1E8A4A','#C93B3F'];

function _anaStartOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function _anaFormatRelative(ts) {
  if (!ts) return 'Sin uso aún';
  const diff = Date.now() - ts;
  if (diff < 60_000)        return 'Hace un momento';
  if (diff < 3_600_000)     return `Hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)    return `Hace ${Math.floor(diff / 3_600_000)} h`;
  const d = Math.floor(diff / 86_400_000);
  if (d === 1) return 'Ayer';
  if (d < 30)  return `Hace ${d} días`;
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function _anaWeekday(ts) {
  return ['D','L','M','M','J','V','S'][new Date(ts).getDay()];
}

function _anaDayMonth(ts) {
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function _anaParseCreated(k) {
  // Activity logger writes ISO strings; the keys list returns whatever the API has.
  const raw = k.created;
  if (!raw) return null;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/* ─── Build smooth cubic-bezier path for sparklines ───────── */
function _anaSmoothPath(values, w, h, pad = 2) {
  if (!values.length) return { line: '', area: '' };
  const max = Math.max(...values, 1);
  const stepX = values.length === 1 ? w : w / (values.length - 1);
  const pts = values.map((v, i) => [
    i * stepX,
    h - pad - (v / max) * (h - pad * 2)
  ]);

  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx.toFixed(2)} ${y0.toFixed(2)}, ${cx.toFixed(2)} ${y1.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const area = `${d} L ${w} ${h} L 0 ${h} Z`;
  return { line: d, area };
}

function _anaSparkSVG(values, opts = {}) {
  const w = opts.w || 320;
  const h = opts.h || 78;
  const color = opts.color || '#2563EB';
  const id = 'ag-' + Math.random().toString(36).slice(2, 9);
  const { line, area } = _anaSmoothPath(values, w, h, opts.pad ?? 4);

  if (!line) {
    // Flat baseline for an all-zero series, so the card still has shape
    const y = h - 4;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" y1="${y}" x2="${w}" y2="${y}"
            stroke="${color}" stroke-width="1.5"
            stroke-dasharray="3 4" stroke-linecap="round" opacity=".35"/>
    </svg>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${color}" stop-opacity="${opts.fillTop ?? 0.22}"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${opts.fill !== false ? `<path d="${area}" fill="url(#${id})"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}"
          stroke-width="${opts.stroke || 1.8}"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ─── Compute the analytics from raw state ────────────────── */
function _anaCompute() {
  const keys     = Array.isArray(apiKeys) ? apiKeys : [];
  // Only count user-key activity here — project keys are tracked elsewhere
  const events   = (_activity || []).filter(e => e && e.source === 'userKey' && e.apiKeyId && e.ts);

  const now      = Date.now();
  const today0   = _anaStartOfDay(now);

  // Pre-build day buckets (oldest → newest) for the hero (30d) and bar chart (14d)
  const heroBuckets = new Array(_ANA_PERIOD).fill(0);
  const heroLabels  = new Array(_ANA_PERIOD).fill(0);
  const barBuckets  = new Array(_ANA_BAR_WIN).fill(0);
  const barLabels   = new Array(_ANA_BAR_WIN).fill(0);

  for (let i = 0; i < _ANA_PERIOD; i++) {
    heroLabels[i] = today0 - (_ANA_PERIOD - 1 - i) * _ANA_DAY_MS;
  }
  for (let i = 0; i < _ANA_BAR_WIN; i++) {
    barLabels[i] = today0 - (_ANA_BAR_WIN - 1 - i) * _ANA_DAY_MS;
  }

  // Per-key sparkline buckets (last _ANA_BAR_WIN days, same axis as bar chart)
  const perKeyBuckets = {};
  const perKeyTotal30 = {};
  keys.forEach(k => {
    perKeyBuckets[k.id] = new Array(_ANA_BAR_WIN).fill(0);
    perKeyTotal30[k.id] = 0;
  });

  // Previous 30-day window for the delta calculation
  let total30 = 0, prev30 = 0;
  // For the global "active days" stat
  const activeDaySet = new Set();

  for (const ev of events) {
    const ts = ev.ts;
    const day0 = _anaStartOfDay(ts);

    // Hero / 30-day window
    const ageDays = Math.floor((today0 - day0) / _ANA_DAY_MS);
    if (ageDays >= 0 && ageDays < _ANA_PERIOD) {
      heroBuckets[_ANA_PERIOD - 1 - ageDays] += 1;
      total30 += 1;
      activeDaySet.add(day0);
    } else if (ageDays >= _ANA_PERIOD && ageDays < _ANA_PERIOD * 2) {
      prev30 += 1;
    }

    // Bar chart / 14-day window
    if (ageDays >= 0 && ageDays < _ANA_BAR_WIN) {
      barBuckets[_ANA_BAR_WIN - 1 - ageDays] += 1;

      if (perKeyBuckets[ev.apiKeyId]) {
        perKeyBuckets[ev.apiKeyId][_ANA_BAR_WIN - 1 - ageDays] += 1;
      }
    }

    // Per-key 30-day total (used for share %)
    if (ageDays >= 0 && ageDays < _ANA_PERIOD && perKeyTotal30[ev.apiKeyId] != null) {
      perKeyTotal30[ev.apiKeyId] += 1;
    }
  }

  // Per-key totals: prefer authoritative `calls` counter (covers events older
  // than the activity window), but fall back to the bucketed total.
  const perKeyDaysWithUse = {};
  keys.forEach(k => { perKeyDaysWithUse[k.id] = new Set(); });
  for (const ev of events) {
    if (perKeyDaysWithUse[ev.apiKeyId]) {
      perKeyDaysWithUse[ev.apiKeyId].add(_anaStartOfDay(ev.ts));
    }
  }

  // Delta vs the previous 30-day window (rounded to 1 decimal)
  let deltaPct = 0, deltaDir = 'flat';
  if (prev30 === 0 && total30 === 0)      { deltaPct = 0;   deltaDir = 'flat'; }
  else if (prev30 === 0)                  { deltaPct = 100; deltaDir = 'up';   }
  else {
    deltaPct = ((total30 - prev30) / prev30) * 100;
    deltaDir = deltaPct > 0.05 ? 'up' : deltaPct < -0.05 ? 'down' : 'flat';
  }

  // Peak day in the 30-day window
  let peakIdx = 0;
  for (let i = 0; i < heroBuckets.length; i++) {
    if (heroBuckets[i] > heroBuckets[peakIdx]) peakIdx = i;
  }
  const peakValue = heroBuckets[peakIdx];

  // Days the user has been tracking activity = age of oldest key (capped at period)
  const ages = keys.map(_anaParseCreated).filter(Boolean);
  const oldestKeyAge = ages.length
    ? Math.max(1, Math.floor((now - Math.min(...ages)) / _ANA_DAY_MS))
    : 0;
  const trackedDays = Math.min(oldestKeyAge || _ANA_PERIOD, _ANA_PERIOD);

  // Average per active day (more meaningful than "÷ 30")
  const activeDays = activeDaySet.size;
  const avgPerActive = activeDays ? (total30 / activeDays) : 0;

  // Per-key shape ready for rendering
  const totalCallsAllTime = keys.reduce((s, k) => s + (Number(k.calls) || 0), 0);
  const perKey = keys.map((k, i) => {
    const created = _anaParseCreated(k);
    const ageDays = created ? Math.max(1, Math.floor((now - created) / _ANA_DAY_MS)) : null;
    const calls   = Number(k.calls) || 0;
    const share30 = total30 ? (perKeyTotal30[k.id] / total30) * 100 : 0;
    const shareAllTime = totalCallsAllTime ? (calls / totalCallsAllTime) * 100 : 0;
    // When the user is in their first day, prefer share by 30-day events; otherwise by lifetime calls
    const share = total30 >= 5 ? share30 : shareAllTime;

    return {
      id:           k.id,
      name:         k.name,
      perm:         k.perm,
      permLabel:    k.permLabel,
      color:        _ANA_KEY_COLORS[i % _ANA_KEY_COLORS.length],
      calls,
      calls30:      perKeyTotal30[k.id] || 0,
      share,
      ageDays,
      created,
      lastUsed:     k.lastUsed || null,
      daysWithUse:  perKeyDaysWithUse[k.id] ? perKeyDaysWithUse[k.id].size : 0,
      sparkline:    perKeyBuckets[k.id] || []
    };
  }).sort((a, b) => b.calls - a.calls);

  return {
    keys, events,
    total30, prev30, deltaPct, deltaDir,
    heroBuckets, heroLabels,
    barBuckets,  barLabels,
    peakIdx, peakValue,
    avgPerActive, activeDays, trackedDays,
    perKey,
    totalCallsAllTime
  };
}

/* ─── Helpers for the bar chart ───────────────────────────── */
function _anaRenderBars(a) {
  const max = Math.max(...a.barBuckets, 1);
  const cols = a.barBuckets.map((v, i) => {
    const isPeak  = i === a.barBuckets.length - 1
      ? false
      : v > 0 && v === Math.max(...a.barBuckets) && a.barBuckets.indexOf(v) === i;
    // Always show a tiny stub for "no data" so the row reads as a timeline
    const heightPct = v === 0 ? 4 : 14 + (v / max) * 86;
    const date = a.barLabels[i];
    const isToday = i === a.barBuckets.length - 1;
    const showTag = isPeak || (isToday && v > 0);
    const isPeakOverall = v > 0 && v === Math.max(...a.barBuckets) && i === a.barBuckets.lastIndexOf(Math.max(...a.barBuckets));

    const classes = [
      'ana-bar-col',
      v > 0 ? 'has-data' : '',
      isPeakOverall ? 'peak' : '',
      showTag ? 'show-tag' : ''
    ].filter(Boolean).join(' ');

    const tagText = isPeakOverall ? `${v} · ${_anaDayMonth(date)}` : (isToday ? 'Hoy' : '');

    return `
      <div class="${classes}" style="--h:${heightPct}%">
        ${tagText ? `<div class="ana-bar-tag ${isPeakOverall ? 'peak' : ''}">${tagText}</div>` : ''}
        <div class="ana-bar-line" data-h="${heightPct}"></div>
        <div class="ana-bar-dot"></div>
      </div>
    `;
  }).join('');

  // Axis: show first, mid, last day labels
  const lastIdx = a.barLabels.length - 1;
  const midIdx  = Math.floor(lastIdx / 2);

  return `
    <div class="ana-bars ana-reveal" style="animation-delay:.18s">
      <div class="ana-bars-head">
        <div class="ana-bars-title">Actividad diaria</div>
        <div class="ana-bars-meta">${_ANA_BAR_WIN} días</div>
      </div>
      <div class="ana-bars-stage">${cols}</div>
      <div class="ana-bars-axis">
        <span>${_anaDayMonth(a.barLabels[0])}</span>
        <span>${_anaDayMonth(a.barLabels[midIdx])}</span>
        <span>Hoy</span>
      </div>
    </div>
  `;
}

/* ─── Per-key card ────────────────────────────────────────── */
function _anaRenderKeyCard(k, idx) {
  const lastUsedTxt = k.lastUsed ? _anaFormatRelative(k.lastUsed) : 'Sin uso aún';
  const ageTxt      = k.ageDays != null
    ? (k.ageDays === 1 ? 'Activa por 1 día' : `Activa por ${k.ageDays} días`)
    : '';
  const usedDaysTxt = k.daysWithUse
    ? (k.daysWithUse === 1 ? '1 día con uso' : `${k.daysWithUse} días con uso`)
    : '0 días con uso';

  const spark = _anaSparkSVG(k.sparkline, {
    w: 320, h: 32, color: k.color, stroke: 1.6, fillTop: 0.18, pad: 3
  });

  // SVG calendar / clock glyphs for the meta row (small, monoline)
  const clockSvg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
  const calSvg   = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';
  const sparkleSvg = '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>';

  return `
    <div class="ana-key-card ana-reveal" style="animation-delay:${0.30 + idx * 0.06}s;--keyc:${k.color}">
      <div class="ana-key-row">
        <div class="ana-key-name">${_escape(k.name)}</div>
        <div class="ana-key-calls">${k.calls.toLocaleString('es-MX')}<small>llamadas</small></div>
      </div>
      <div class="ana-key-spark">${spark}</div>
      <div class="ana-key-share">
        <div class="ana-key-share-track">
          <div class="ana-key-share-fill" style="width:${Math.min(100, k.share).toFixed(1)}%"></div>
        </div>
        <div class="ana-key-share-pct">${k.share.toFixed(1)}%</div>
      </div>
      <div class="ana-key-meta">
        <span>${sparkleSvg}${lastUsedTxt}</span>
        ${ageTxt    ? `<span>${calSvg}${ageTxt}</span>`        : ''}
        <span>${clockSvg}${usedDaysTxt}</span>
      </div>
    </div>
  `;
}

/* ─── Empty state (kept for the "have keys, no activity" case) ── */
function _anaEmptyState(message) {
  const copy = message || 'Los datos aparecerán aquí cuando uses tus claves.';
  return `
    <div class="card usage-card">
      <div class="usage-empty">
        <div class="usage-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke="currentColor">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </div>
        <div class="usage-empty-text">
          Sin resultados todavía.<br>
          ${copy}
        </div>
      </div>
    </div>
  `;
}

/* ─── Projects render ────────────────────────────────────── */
function renderProjects() {
  const list  = document.getElementById('projList');
  const empty = document.getElementById('projEmpty');
  const badge = document.getElementById('projBadge');

  if (badge) {
    badge.textContent = projects.length;
    badge.style.display = projects.length ? '' : 'none';
  }

  if (!projects.length) {
    if (empty) empty.style.display = '';
    if (list)  list.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (!list) return;

  list.innerHTML = projects.map((p, i) => {
    const bg     = projColors[i % projColors.length];
    const letter = (p.name || 'P')[0].toUpperCase();
    const files  = (p.files || []).length;
    return `
      <article class="proj-card" onclick="openProjDetail('${_escape(String(p.id))}')">
        <div class="proj-card-top">
          <div class="proj-card-avatar" style="background:${bg}">${letter}</div>
          <div class="proj-card-meta">
            <div class="proj-card-name">${_escape(p.name || '—')}</div>
            <div class="proj-card-date">${_escape(p.created || '')}</div>
          </div>
        </div>
        ${p.desc ? `<div class="proj-card-desc">${_escape(p.desc)}</div>` : ''}
        <div class="proj-card-footer">
          <span style="font-size:12px;color:var(--muted)">${files} archivo${files !== 1 ? 's' : ''}</span>
          ${p.apiKey ? '<span style="font-size:11px;font-weight:600;color:var(--success)">API Key ✓</span>' : ''}
        </div>
      </article>`;
  }).join('');
}

/* ─── Project files render ───────────────────────────────── */
function renderProjFiles(p) {
  const list  = document.getElementById('projFileList');
  const empty = document.getElementById('projFilesEmpty');
  const files = p && p.files ? p.files : [];

  if (!files.length) {
    if (empty) empty.style.display = '';
    if (list)  list.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (!list) return;

  list.innerHTML = files.map(f => `
    <div class="proj-file-item">
      <div class="proj-file-info">
        <div class="proj-file-name">${_escape(f.name || 'Archivo')}</div>
        ${f.size ? `<div class="proj-file-size">${_escape(f.size)}</div>` : ''}
      </div>
      ${f.url ? `<a class="proj-file-link" href="${f.url}" target="_blank" rel="noopener noreferrer">Ver</a>` : ''}
    </div>`).join('');
}

/* ─── Main render ─────────────────────────────────────────── */
function renderApiUsageAnalysis() {
  const wrap = document.getElementById('apiUsageBody');
  const sub  = document.getElementById('apiAnaSub');
  const per  = document.getElementById('apiAnaPeriod');
  if (!wrap) return;

  const a = _anaCompute();
  const hasAnyActivity = a.total30 > 0 || a.totalCallsAllTime > 0;
  const notEnoughData = hasAnyActivity && (a.totalCallsAllTime < 3 || a.activeDays < 2);

  if (!hasAnyActivity) {
    if (sub) sub.textContent = 'Esperando primera solicitud';
    if (per) per.textContent = `${a.keys.length} ${a.keys.length === 1 ? 'clave' : 'claves'}`;
    wrap.innerHTML = _anaEmptyState();
    return;
  }

  if (notEnoughData) {
    if (sub) sub.textContent = 'Actividad inicial';
    if (per) per.textContent = `${a.totalCallsAllTime.toLocaleString('es-MX')} ${a.totalCallsAllTime === 1 ? 'solicitud' : 'solicitudes'}`;
    wrap.innerHTML = _anaEmptyState('Necesitas un poco más de actividad para desbloquear el análisis detallado.');
    return;
  }

  // Header strip
  if (sub) sub.textContent = a.total30
    ? `${a.activeDays} ${a.activeDays === 1 ? 'día activo' : 'días activos'} · en tiempo real`
    : 'Histórico acumulado';
  if (per) per.textContent = a.total30 ? 'Últimos 30 días' : 'Histórico';

  // Hero sparkline (use 30-day buckets, falls back gracefully)
  const heroSpark = _anaSparkSVG(a.heroBuckets, {
    w: 360, h: 78, color: '#2563EB', stroke: 2, fillTop: 0.28, pad: 6
  });

  const deltaSign  = a.deltaDir === 'up' ? '+' : a.deltaDir === 'down' ? '−' : '±';
  const deltaArrow = a.deltaDir === 'up'
    ? '<svg viewBox="0 0 24 24"><polyline points="6 14 12 8 18 14"/></svg>'
    : a.deltaDir === 'down'
    ? '<svg viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>'
    : '<svg viewBox="0 0 24 24"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
  const deltaText  = a.deltaDir === 'flat'
    ? 'Sin cambio'
    : `${deltaSign}${Math.abs(a.deltaPct).toFixed(2)}%`;

  // Headline metric: prefer the windowed total, fall back to lifetime calls
  const heroN = a.total30 || a.totalCallsAllTime;

  const peakLabel = a.peakValue > 0
    ? `${a.peakValue} · ${_anaDayMonth(a.heroLabels[a.peakIdx])}`
    : '—';
  const avgLabel  = a.avgPerActive ? a.avgPerActive.toFixed(1) : '0';
  const trackedLabel = a.trackedDays
    ? (a.trackedDays === 1 ? '1 día' : `${a.trackedDays} días`)
    : '—';
  const activeKeysLabel = a.keys.filter(k => (k.calls || 0) > 0).length || '0';

  const dollarSvg = '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';

  wrap.innerHTML = `
    <!-- Hero -->
    <div class="ana-hero ana-reveal">
      <div class="ana-hero-top">
        <div class="ana-hero-left">
          <div class="ana-hero-icon">${dollarSvg}</div>
          <div class="ana-hero-label">Uso total</div>
          <div class="ana-hero-num">${heroN.toLocaleString('es-MX')}<span class="ana-hero-unit">solicitudes</span></div>
        </div>
        <div class="ana-delta ${a.deltaDir}">
          ${deltaArrow}<span>${deltaText}</span>
        </div>
      </div>
      <div class="ana-hero-spark">${heroSpark}</div>
    </div>

    <!-- Stats grid -->
    <div class="ana-grid">
      <div class="ana-stat ana-reveal" style="animation-delay:.06s">
        <div class="ana-stat-head"><span class="ana-stat-dot b"></span><span class="ana-stat-label">Promedio</span></div>
        <div class="ana-stat-num"><em>${avgLabel}</em></div>
        <div class="ana-stat-sub">por día activo</div>
      </div>
      <div class="ana-stat ana-reveal" style="animation-delay:.10s">
        <div class="ana-stat-head"><span class="ana-stat-dot t"></span><span class="ana-stat-label">Pico</span></div>
        <div class="ana-stat-num"><em>${a.peakValue.toLocaleString('es-MX')}</em></div>
        <div class="ana-stat-sub">${a.peakValue ? _anaDayMonth(a.heroLabels[a.peakIdx]) : 'sin datos'}</div>
      </div>
      <div class="ana-stat ana-reveal" style="animation-delay:.14s">
        <div class="ana-stat-head"><span class="ana-stat-dot p"></span><span class="ana-stat-label">Claves</span></div>
        <div class="ana-stat-num"><em>${activeKeysLabel}</em><span style="font-family:'Sora',sans-serif;font-style:normal;font-size:13px;color:var(--muted)"> / ${a.keys.length}</span></div>
        <div class="ana-stat-sub">en uso</div>
      </div>
      <div class="ana-stat ana-reveal" style="animation-delay:.18s">
        <div class="ana-stat-head"><span class="ana-stat-dot o"></span><span class="ana-stat-label">Rastreo</span></div>
        <div class="ana-stat-num"><em>${trackedLabel}</em></div>
        <div class="ana-stat-sub">desde la 1ª clave</div>
      </div>
    </div>

    <!-- Daily bars -->
    ${_anaRenderBars(a)}

    <!-- Per-key breakdown -->
    <div class="ana-keys-title ana-reveal" style="animation-delay:.24s">
      <span>Desglose por clave</span>
      <small>${a.perKey.length} ${a.perKey.length === 1 ? 'clave' : 'claves'}</small>
    </div>
    ${a.perKey.map((k, i) => _anaRenderKeyCard(k, i)).join('')}
  `;

  // Animate the bar chart heights after the cards are in the DOM
  requestAnimationFrame(() => {
    wrap.querySelectorAll('.ana-bar-line').forEach(el => {
      const h = el.getAttribute('data-h');
      if (h) el.style.height = h + '%';
    });
  });
}

// Expose so home.js can call it after rendering keys
window.renderApiUsageAnalysis = renderApiUsageAnalysis;

let _anaRelayoutRAF = 0;
function _scheduleApiUsageRelayout() {
  cancelAnimationFrame(_anaRelayoutRAF);
  _anaRelayoutRAF = requestAnimationFrame(() => {
    const apiPage = document.getElementById('page-apikeys');
    if (apiPage && apiPage.classList.contains('active')) renderApiUsageAnalysis();
  });
}
window.addEventListener('resize', _scheduleApiUsageRelayout, { passive: true });

/* ─── Missing project window functions ───────────────────── */

window.deleteProjAction = function () {
  if (!currentProjId) return;
  const p = projects.find(x => x.id === currentProjId);
  const nameEl = document.getElementById('delProjName');
  if (nameEl && p) nameEl.textContent = `"${_escape(p.name || '')}"`;
  document.getElementById('delProjModal')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  Projects.toggleMenu?.();
};

window.closeDelProjModal = function () {
  document.getElementById('delProjModal')?.classList.remove('open');
  document.body.style.overflow = '';
};

window.copyProjApi = function () {
  const p = projects.find(x => x.id === currentProjId);
  const key = p?.apiKey?.key;
  if (!key) { showToast('Sin API Key asignada', 'warn'); return; }
  navigator.clipboard?.writeText(key).then(() => showToast('API Key copiada')).catch(() => showToast('No se pudo copiar', 'warn'));
  Projects.toggleMenu?.();
};

window.copyApiKeyFromDetail = function () {
  const keyEl = document.getElementById('detailApiKey');
  const val   = keyEl?.dataset?.val;
  if (!val) { showToast('Sin API Key asignada', 'warn'); return; }
  navigator.clipboard?.writeText(val).then(() => showToast('API Key copiada')).catch(() => showToast('No se pudo copiar', 'warn'));
};

window.maskKey = function (full) {
  const prefix = 'cvlt_sk_live_';
  return prefix + full.slice(prefix.length, prefix.length + 4) + '••••••••••••••••••••••••••••';
};

window.renderApiKeys  = () => ApiKeys.render();
window.renderTrash    = () => Trash.render();
window.renderProjects = renderProjects;
window.addEventListener('orientationchange', _scheduleApiUsageRelayout, { passive: true });
window.addEventListener('pageshow', _scheduleApiUsageRelayout);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', _scheduleApiUsageRelayout, { passive: true });
}

/* ─── Logout ────────────────────────────────────────────── */

window.logoutUser = function () {
  NubiflyAPI.logoutUser();
};
