/* ═══════════════════════════════════════════════════
   api.js — Nubifly Frontend API Client
   All communication with the backend goes through here.
   ═══════════════════════════════════════════════════ */

const API_BASE = '/api';

/* ─── Auth helpers ──────────────────────────────── */

function getToken()         { return localStorage.getItem('nf_token'); }
function getUser()          { const u = localStorage.getItem('nf_user'); return u ? JSON.parse(u) : null; }
function setSession(token, user) {
  localStorage.setItem('nf_token', token);
  localStorage.setItem('nf_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('nf_token');
  localStorage.removeItem('nf_user');
  localStorage.removeItem('nf_uid');
}

/* ─── Safe JSON parser ──────────────────────────── */
// Reads the response body as text first to avoid
// "Unexpected end of JSON input" on empty or HTML bodies.

async function safeJson(res) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/* ─── Core fetch wrapper ────────────────────────── */
// Default request timeout — beyond this we abort and surface a friendly error
// so a slow Firebase / Cloudflare Pages function never freezes the UI.
const DEFAULT_TIMEOUT_MS = 12000;

async function apiFetch(endpoint, {
  method = 'GET', body, auth = true, isFormData = false,
  timeout = DEFAULT_TIMEOUT_MS, signal: externalSignal
} = {}) {
  const headers = {};

  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  // Combine an internal timeout with any caller-provided AbortSignal
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), timeout);
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => ac.abort(externalSignal.reason), { once: true });
  }

  const opts = { method, headers, signal: ac.signal };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, opts);
  } catch (e) {
    const isTimeout = ac.signal.aborted && String(ac.signal.reason || '') === 'timeout';
    const err = new Error(isTimeout
      ? 'La solicitud tardó demasiado. Inténtalo de nuevo.'
      : 'Sin conexión. Verifica tu internet e inténtalo de nuevo.');
    err.code   = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await safeJson(res);

  if (!res.ok) {
    const err = new Error(
      data.message || `Error ${res.status}. Inténtalo de nuevo.`
    );
    err.code   = data.error;
    err.status = res.status;
    err.data   = data;
    throw err;
  }

  return data;
}

/* ══════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════ */

async function registerUser({ name, username, email, password }) {
  const data = await apiFetch('/register', {
    method: 'POST',
    body: { name, username, email, password },
    auth: false
  });
  setSession(data.token, data.user);
  localStorage.setItem('nf_uid', data.uid);
  return data;
}

async function loginUser({ email, password }) {
  const data = await apiFetch('/login', {
    method: 'POST',
    body: { email, password },
    auth: false
  });
  setSession(data.token, data.user);
  localStorage.setItem('nf_uid', data.uid);
  return data;
}

function logoutUser() {
  clearSession();
  window.location.replace('/login');
}

function requireAuth() {
  if (!getToken()) {
    window.location.replace('/login');
    return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════
   USER
══════════════════════════════════════════════════ */

async function loadUserData() {
  return (await apiFetch('/user/profile')).data.user;
}

async function updateUserProfile({ name, bio, avatar }) {
  return (await apiFetch('/user/profile', { method: 'PATCH', body: { name, bio, avatar } })).data;
}

async function loadDashboard() {
  return (await apiFetch('/user/dashboard')).data;
}

async function loadUserFiles() {
  return (await apiFetch('/user/files')).data.files;
}

async function loadUserPublications() {
  const data = (await apiFetch('/user/publications')).data;
  return data.publications || [];
}

async function loadNotifications() {
  const data = (await apiFetch('/user/notifications')).data;
  return {
    notifications: data.notifications || [],
    unread: data.unread || 0
  };
}

async function markNotificationRead(id) {
  return apiFetch(`/user/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

async function loadApiActivity() {
  const data = (await apiFetch('/user/activity')).data;
  return data.activity || [];
}

/* ══════════════════════════════════════════════════
   PROJECTS
══════════════════════════════════════════════════ */

async function loadProjects() {
  return (await apiFetch('/projects')).data.projects;
}

async function createProject({ name, description = '' }) {
  return (await apiFetch('/projects', { method: 'POST', body: { name, description } })).data.project;
}

async function getProject(projectId) {
  return (await apiFetch(`/projects/${projectId}`)).data.project;
}

async function deleteProject(projectId) {
  return apiFetch(`/projects/${projectId}`, { method: 'DELETE' });
}

/* ══════════════════════════════════════════════════
   PROJECT API KEYS (one key per project)
══════════════════════════════════════════════════ */

async function generateApiKey(projectId) {
  return (await apiFetch(`/projects/${projectId}/api-key/generate`, { method: 'POST' })).data;
}

async function regenerateApiKey(projectId) {
  return (await apiFetch(`/projects/${projectId}/api-key/regenerate`, { method: 'POST' })).data;
}

async function getApiKey(projectId) {
  return (await apiFetch(`/projects/${projectId}/api-key`)).data.apiKey;
}

/* ══════════════════════════════════════════════════
   USER API KEYS (Claves API section)
══════════════════════════════════════════════════ */

async function listUserApiKeys() {
  return (await apiFetch('/user/apikeys')).data.keys;
}

async function createUserApiKey(keyData) {
  return (await apiFetch('/user/apikeys', { method: 'POST', body: keyData })).data.key;
}

async function deleteUserApiKey(keyId) {
  return apiFetch(`/user/apikeys/${keyId}`, { method: 'DELETE' });
}

async function listUserApiKeyTrash() {
  return (await apiFetch('/user/apikeys/trash')).data.items;
}

async function restoreUserApiKey(keyId) {
  return (await apiFetch(`/user/apikeys/trash/${keyId}/restore`, { method: 'POST' })).data.key;
}

async function permanentDeleteUserApiKey(keyId) {
  return apiFetch(`/user/apikeys/trash/${keyId}`, { method: 'DELETE' });
}

async function emptyUserApiKeyTrash() {
  return apiFetch('/user/apikeys/trash', { method: 'DELETE' });
}

/* ══════════════════════════════════════════════════
   FILES
══════════════════════════════════════════════════ */

async function uploadFile(projectId, fileInput) {
  const formData = new FormData();
  formData.append('file', fileInput);
  formData.append('projectId', projectId);

  const token = getToken();
  // Uploads use a longer timeout (60s) to accommodate big files / slow networks
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), 60000);

  let res;
  try {
    res = await fetch(`${API_BASE}/files/upload`, {
      method:  'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body:    formData,
      signal:  ac.signal
    });
  } catch {
    const isTimeout = ac.signal.aborted && String(ac.signal.reason || '') === 'timeout';
    throw new Error(isTimeout
      ? 'La subida tardó demasiado. Verifica tu conexión e inténtalo de nuevo.'
      : 'Sin conexión. Verifica tu internet e inténtalo de nuevo.');
  } finally {
    clearTimeout(timer);
  }

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || 'Error subiendo archivo');
  return data.data.file;
}

async function loadFiles(projectId) {
  return (await apiFetch(`/files/${projectId}`)).data.files;
}

async function deleteFile(fileId) {
  return apiFetch(`/files/${fileId}`, { method: 'DELETE' });
}

/* ══════════════════════════════════════════════════
   PUBLIC API (uses x-api-key, not JWT)
══════════════════════════════════════════════════ */

async function sendApiRequest(apiKey, { action = 'ping', payload = {} } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/v1/request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body:    JSON.stringify({ action, payload })
    });
  } catch {
    throw new Error('Sin conexión. Verifica tu internet e inténtalo de nuevo.');
  }
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || 'Error en solicitud API');
  return data;
}

async function getApiStatus(apiKey) {
  let res;
  try {
    res = await fetch(`${API_BASE}/v1/status`, {
      headers: { 'x-api-key': apiKey }
    });
  } catch {
    throw new Error('Sin conexión. Verifica tu internet e inténtalo de nuevo.');
  }
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || 'Error obteniendo estado');
  return data.data;
}

/* ─── Expose globally ───────────────────────────── */
window.NubiflyAPI = {
  // Auth
  getToken, getUser, setSession, clearSession,
  registerUser, loginUser, logoutUser, requireAuth,
  // User
  loadUserData, updateUserProfile, loadDashboard, loadUserFiles, loadUserPublications,
  loadNotifications, markNotificationRead, loadApiActivity,
  // Projects
  loadProjects, createProject, getProject, deleteProject,
  // Project API Keys
  generateApiKey, regenerateApiKey, getApiKey,
  // User API Keys (Claves API section)
  listUserApiKeys, createUserApiKey, deleteUserApiKey,
  listUserApiKeyTrash, restoreUserApiKey, permanentDeleteUserApiKey, emptyUserApiKeyTrash,
  // Files
  uploadFile, loadFiles, deleteFile,
  // Public API
  sendApiRequest, getApiStatus
};
