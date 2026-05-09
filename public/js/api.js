/* ════════════════════════════════════════════════════════════════
   api.js — Nubifly Frontend API Client
   Sistema completo para conectar el frontend con el backend Nubifly.

   Compatible con:
   - Authorization: Bearer
   - Registro / Login / Logout
   - Perfil de usuario
   - Dashboard
   - Proyectos
   - Archivos por proyecto
   - Publicaciones recientes
   - Claves API
   - Notificaciones
   - Manejo seguro de JSON
   - Timeouts
   - Respuestas flexibles del backend
   ════════════════════════════════════════════════════════════════ */

const NUBIFLY_CONFIG = {
  API_BASE: '/api',
  DEFAULT_TIMEOUT_MS: 12000,
  UPLOAD_TIMEOUT_MS: 60000,
  TOKEN_KEY: 'nf_token',
  USER_KEY: 'nf_user',
  UID_KEY: 'nf_uid'
};

/* ────────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────── */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeParseJSON(value, fallback = null) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeErrorMessage(data, status) {
  return (
    data?.message ||
    data?.error ||
    data?.data?.message ||
    data?.data?.error ||
    `Error ${status}. Inténtalo de nuevo.`
  );
}

function extractData(res) {
  return res?.data ?? res ?? null;
}

function extractUser(res) {
  return (
    res?.data?.user ||
    res?.user ||
    res?.data?.profile ||
    res?.profile ||
    null
  );
}

function extractToken(res) {
  return (
    res?.token ||
    res?.accessToken ||
    res?.idToken ||
    res?.data?.token ||
    res?.data?.accessToken ||
    res?.data?.idToken ||
    null
  );
}

function extractUid(res, user = null) {
  return (
    res?.uid ||
    res?.id ||
    res?.userId ||
    res?.data?.uid ||
    res?.data?.id ||
    res?.data?.userId ||
    user?.uid ||
    user?.id ||
    user?.userId ||
    null
  );
}

/* ────────────────────────────────────────────────────────────────
   SESSION
──────────────────────────────────────────────────────────────── */

function getToken() {
  return localStorage.getItem(NUBIFLY_CONFIG.TOKEN_KEY);
}

function getUid() {
  return localStorage.getItem(NUBIFLY_CONFIG.UID_KEY);
}

function getUser() {
  const user = safeParseJSON(localStorage.getItem(NUBIFLY_CONFIG.USER_KEY), null);

  if (!user) return null;

  if (!isObject(user)) {
    clearSession();
    return null;
  }

  return user;
}

function setSession(token, user, uid) {
  if (token) {
    localStorage.setItem(NUBIFLY_CONFIG.TOKEN_KEY, token);
  }

  if (user && isObject(user)) {
    localStorage.setItem(NUBIFLY_CONFIG.USER_KEY, JSON.stringify(user));
  }

  const finalUid = uid || extractUid({}, user);

  if (finalUid) {
    localStorage.setItem(NUBIFLY_CONFIG.UID_KEY, finalUid);
  }
}

function updateStoredUser(user) {
  if (!user || !isObject(user)) return null;

  localStorage.setItem(NUBIFLY_CONFIG.USER_KEY, JSON.stringify(user));

  const uid = extractUid({}, user);
  if (uid) localStorage.setItem(NUBIFLY_CONFIG.UID_KEY, uid);

  return user;
}

function clearSession() {
  localStorage.removeItem(NUBIFLY_CONFIG.TOKEN_KEY);
  localStorage.removeItem(NUBIFLY_CONFIG.USER_KEY);
  localStorage.removeItem(NUBIFLY_CONFIG.UID_KEY);
}

function isLoggedIn() {
  return Boolean(getToken());
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.replace('/login');
    return false;
  }

  return true;
}

/* ────────────────────────────────────────────────────────────────
   SAFE JSON
──────────────────────────────────────────────────────────────── */

async function safeJson(res) {
  try {
    const text = await res.text();

    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        message: 'El servidor no devolvió JSON válido.',
        raw: text
      };
    }
  } catch {
    return {};
  }
}

/* ────────────────────────────────────────────────────────────────
   FETCH CORE
──────────────────────────────────────────────────────────────── */

function createTimeoutSignal(timeout, externalSignal) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort('timeout');
  }, timeout);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener(
        'abort',
        () => controller.abort(externalSignal.reason),
        { once: true }
      );
    }
  }

  return { controller, timer };
}

async function apiFetch(endpoint, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    auth = true,
    isFormData = false,
    timeout = NUBIFLY_CONFIG.DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    headers: customHeaders = {}
  } = options;

  const headers = { ...customHeaders };

  if (!isFormData && body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const { controller, timer } = createTimeoutSignal(timeout, externalSignal);

  const fetchOptions = {
    method,
    headers,
    signal: controller.signal
  };

  if (body !== undefined && body !== null) {
    fetchOptions.body = isFormData ? body : JSON.stringify(body);
  }

  let res;

  try {
    res = await fetch(`${NUBIFLY_CONFIG.API_BASE}${endpoint}`, fetchOptions);
  } catch (error) {
    const isTimeout =
      controller.signal.aborted &&
      String(controller.signal.reason || '') === 'timeout';

    const err = new Error(
      isTimeout
        ? 'La solicitud tardó demasiado. Inténtalo de nuevo.'
        : 'Sin conexión. Verifica tu internet e inténtalo de nuevo.'
    );

    err.code = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
    err.status = 0;
    err.originalError = error;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await safeJson(res);

  if (!res.ok) {
    const err = new Error(normalizeErrorMessage(data, res.status));
    err.code = data?.code || data?.error || `HTTP_${res.status}`;
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* ────────────────────────────────────────────────────────────────
   AUTH
──────────────────────────────────────────────────────────────── */

async function registerUser({ name, username, email, password }) {
  const res = await apiFetch('/register', {
    method: 'POST',
    auth: false,
    body: { name, username, email, password }
  });

  const user = extractUser(res);
  const token = extractToken(res);
  const uid = extractUid(res, user);

  if (!token) throw new Error('El servidor no devolvió token de sesión.');
  if (!user) throw new Error('El servidor no devolvió los datos del usuario.');

  setSession(token, user, uid);

  return { ...res, token, user, uid };
}

async function loginUser({ email, password }) {
  const res = await apiFetch('/login', {
    method: 'POST',
    auth: false,
    body: { email, password }
  });

  const user = extractUser(res);
  const token = extractToken(res);
  const uid = extractUid(res, user);

  if (!token) throw new Error('El servidor no devolvió token de sesión.');
  if (!user) throw new Error('El servidor no devolvió los datos del usuario.');

  setSession(token, user, uid);

  return { ...res, token, user, uid };
}

function logoutUser({ redirect = true } = {}) {
  clearSession();
  if (redirect) window.location.replace('/login');
}

async function refreshSessionUser() {
  const user = await loadUserData();
  if (user) updateStoredUser(user);
  return user;
}

/* ────────────────────────────────────────────────────────────────
   USER
──────────────────────────────────────────────────────────────── */

async function loadUserData() {
  const res = await apiFetch('/user/profile');

  const user =
    extractUser(res) ||
    res?.data ||
    res?.user ||
    null;

  if (!user || !isObject(user)) {
    throw new Error('No se pudo cargar la información del usuario.');
  }

  updateStoredUser(user);

  return user;
}

async function updateUserProfile({ name, username, bio, avatar } = {}) {
  const body = {};

  if (name !== undefined) body.name = name;
  if (username !== undefined) body.username = username;
  if (bio !== undefined) body.bio = bio;
  if (avatar !== undefined) body.avatar = avatar;

  const res = await apiFetch('/user/profile', {
    method: 'PATCH',
    body
  });

  const user = extractUser(res) || res?.data || res?.user;

  if (user && isObject(user)) {
    updateStoredUser(user);
    return user;
  }

  return extractData(res);
}

async function loadDashboard() {
  const res = await apiFetch('/user/dashboard');
  return res?.data || res;
}

async function loadUserFiles() {
  const res = await apiFetch('/user/files');
  return res?.data?.files || res?.files || [];
}

async function loadUserPublications() {
  const res = await apiFetch('/user/publications');
  return res?.data?.publications || res?.publications || [];
}

async function loadApiActivity() {
  const res = await apiFetch('/user/activity');
  return res?.data?.activity || res?.activity || [];
}

/* ────────────────────────────────────────────────────────────────
   NOTIFICATIONS
──────────────────────────────────────────────────────────────── */

async function loadNotifications() {
  const res = await apiFetch('/user/notifications');

  return {
    notifications: res?.data?.notifications || res?.notifications || [],
    unread: res?.data?.unread || res?.unread || 0
  };
}

async function markNotificationRead(id) {
  return apiFetch(`/user/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST'
  });
}

async function markAllNotificationsRead() {
  return apiFetch('/user/notifications/read-all', {
    method: 'POST'
  });
}

/* ────────────────────────────────────────────────────────────────
   PROJECTS
──────────────────────────────────────────────────────────────── */

async function loadProjects() {
  const res = await apiFetch('/projects');
  return res?.data?.projects || res?.projects || [];
}

async function createProject({ name, description = '' }) {
  const res = await apiFetch('/projects', {
    method: 'POST',
    body: { name, description }
  });

  return res?.data?.project || res?.project || res?.data || res;
}

async function getProject(projectId) {
  const res = await apiFetch(`/projects/${encodeURIComponent(projectId)}`);
  return res?.data?.project || res?.project || res?.data || res;
}

async function updateProject(projectId, { name, description } = {}) {
  const body = {};

  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;

  const res = await apiFetch(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body
  });

  return res?.data?.project || res?.project || res?.data || res;
}

async function deleteProject(projectId) {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });
}

/* ────────────────────────────────────────────────────────────────
   PROJECT API KEYS
──────────────────────────────────────────────────────────────── */

async function generateApiKey(projectId) {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(projectId)}/api-key/generate`,
    { method: 'POST' }
  );

  return res?.data || res;
}

async function regenerateApiKey(projectId) {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(projectId)}/api-key/regenerate`,
    { method: 'POST' }
  );

  return res?.data || res;
}

async function getProjectApiKey(projectId) {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(projectId)}/api-key`
  );

  return res?.data?.apiKey || res?.apiKey || res?.data || res;
}

const getApiKey = getProjectApiKey;

/* ────────────────────────────────────────────────────────────────
   USER API KEYS
──────────────────────────────────────────────────────────────── */

async function listUserApiKeys() {
  const res = await apiFetch('/user/apikeys');
  return res?.data?.keys || res?.keys || [];
}

async function createUserApiKey(keyData = {}) {
  const res = await apiFetch('/user/apikeys', {
    method: 'POST',
    body: keyData
  });

  return res?.data?.key || res?.key || res?.data || res;
}

async function updateUserApiKey(keyId, keyData = {}) {
  const res = await apiFetch(`/user/apikeys/${encodeURIComponent(keyId)}`, {
    method: 'PATCH',
    body: keyData
  });

  return res?.data?.key || res?.key || res?.data || res;
}

async function deleteUserApiKey(keyId) {
  return apiFetch(`/user/apikeys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE'
  });
}

async function listUserApiKeyTrash() {
  const res = await apiFetch('/user/apikeys/trash');
  return res?.data?.items || res?.items || [];
}

async function restoreUserApiKey(keyId) {
  const res = await apiFetch(
    `/user/apikeys/trash/${encodeURIComponent(keyId)}/restore`,
    { method: 'POST' }
  );

  return res?.data?.key || res?.key || res?.data || res;
}

async function permanentDeleteUserApiKey(keyId) {
  return apiFetch(`/user/apikeys/trash/${encodeURIComponent(keyId)}`, {
    method: 'DELETE'
  });
}

async function emptyUserApiKeyTrash() {
  return apiFetch('/user/apikeys/trash', {
    method: 'DELETE'
  });
}

/* ────────────────────────────────────────────────────────────────
   FILES
──────────────────────────────────────────────────────────────── */

async function uploadProjectFile(projectId, file, extraFields = {}) {
  if (!projectId) throw new Error('projectId requerido.');
  if (!file) throw new Error('Archivo requerido.');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('projectId', projectId);

  Object.entries(extraFields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });

  const res = await apiFetch('/files/upload', {
    method: 'POST',
    body: formData,
    isFormData: true,
    timeout: NUBIFLY_CONFIG.UPLOAD_TIMEOUT_MS
  });

  return res?.data?.file || res?.file || res?.data || res;
}

const uploadFile = uploadProjectFile;

async function loadProjectFiles(projectId) {
  const res = await apiFetch(`/files/${encodeURIComponent(projectId)}`);
  return res?.data?.files || res?.files || [];
}

const loadFiles = loadProjectFiles;

async function deleteFile(fileId) {
  return apiFetch(`/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  });
}

/* ────────────────────────────────────────────────────────────────
   PUBLICATIONS
──────────────────────────────────────────────────────────────── */

async function uploadPublicationFile(file, extraFields = {}) {
  if (!file) throw new Error('Archivo requerido.');

  const formData = new FormData();
  formData.append('file', file);

  Object.entries(extraFields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });

  const res = await apiFetch('/v1/publications/upload', {
    method: 'POST',
    body: formData,
    isFormData: true,
    timeout: NUBIFLY_CONFIG.UPLOAD_TIMEOUT_MS
  });

  return res?.data?.publication || res?.publication || res?.data || res;
}

async function loadRecentPublications() {
  const res = await apiFetch('/publications/recent', {
    auth: false
  });

  return res?.data?.publications || res?.publications || [];
}

async function deletePublication(publicationId) {
  return apiFetch(`/user/publications/${encodeURIComponent(publicationId)}`, {
    method: 'DELETE'
  });
}

/* ────────────────────────────────────────────────────────────────
   PUBLIC API — BEARER API KEY
──────────────────────────────────────────────────────────────── */

async function apiKeyFetch(endpoint, apiKey, options = {}) {
  if (!apiKey) throw new Error('API Key requerida.');

  const {
    method = 'GET',
    body = undefined,
    isFormData = false,
    timeout = NUBIFLY_CONFIG.DEFAULT_TIMEOUT_MS
  } = options;

  const headers = {
    Authorization: `Bearer ${apiKey}`
  };

  if (!isFormData && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const { controller, timer } = createTimeoutSignal(timeout);

  const fetchOptions = {
    method,
    headers,
    signal: controller.signal
  };

  if (body !== undefined && body !== null) {
    fetchOptions.body = isFormData ? body : JSON.stringify(body);
  }

  let res;

  try {
    res = await fetch(`${NUBIFLY_CONFIG.API_BASE}${endpoint}`, fetchOptions);
  } catch (error) {
    const isTimeout =
      controller.signal.aborted &&
      String(controller.signal.reason || '') === 'timeout';

    const err = new Error(
      isTimeout
        ? 'La solicitud tardó demasiado. Inténtalo de nuevo.'
        : 'Sin conexión. Verifica tu internet e inténtalo de nuevo.'
    );

    err.code = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
    err.status = 0;
    err.originalError = error;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await safeJson(res);

  if (!res.ok) {
    const err = new Error(normalizeErrorMessage(data, res.status));
    err.code = data?.code || data?.error || `HTTP_${res.status}`;
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function sendApiRequest(apiKey, { action = 'ping', payload = {} } = {}) {
  return apiKeyFetch('/v1/request', apiKey, {
    method: 'POST',
    body: { action, payload }
  });
}

async function getApiStatus(apiKey) {
  const res = await apiKeyFetch('/v1/status', apiKey);
  return res?.data || res;
}

async function uploadProjectFileWithApiKey(apiKey, projectId, file, extraFields = {}) {
  if (!projectId) throw new Error('projectId requerido.');
  if (!file) throw new Error('Archivo requerido.');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('projectId', projectId);

  Object.entries(extraFields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });

  const res = await apiKeyFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/files/upload`,
    apiKey,
    {
      method: 'POST',
      body: formData,
      isFormData: true,
      timeout: NUBIFLY_CONFIG.UPLOAD_TIMEOUT_MS
    }
  );

  return res?.data?.file || res?.file || res?.data || res;
}

async function uploadPublicationWithApiKey(apiKey, file, extraFields = {}) {
  if (!file) throw new Error('Archivo requerido.');

  const formData = new FormData();
  formData.append('file', file);

  Object.entries(extraFields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });

  const res = await apiKeyFetch('/v1/publications/upload', apiKey, {
    method: 'POST',
    body: formData,
    isFormData: true,
    timeout: NUBIFLY_CONFIG.UPLOAD_TIMEOUT_MS
  });

  return res?.data?.publication || res?.publication || res?.data || res;
}

/* ────────────────────────────────────────────────────────────────
   DEBUG
──────────────────────────────────────────────────────────────── */

function debugSession() {
  return {
    token: getToken(),
    uid: getUid(),
    user: getUser(),
    isLoggedIn: isLoggedIn()
  };
}

async function testConnection() {
  try {
    const res = await apiFetch('/health', {
      auth: false,
      timeout: 5000
    });

    return { ok: true, data: res };
  } catch (error) {
    return {
      ok: false,
      message: error.message,
      status: error.status,
      code: error.code
    };
  }
}


window.NubiflyAPI = {
  config: NUBIFLY_CONFIG,

  apiFetch,
  apiKeyFetch,
  safeJson,

  getToken,
  getUid,
  getUser,
  setSession,
  updateStoredUser,
  clearSession,
  isLoggedIn,
  requireAuth,

  registerUser,
  loginUser,
  logoutUser,
  refreshSessionUser,

  loadUserData,
  updateUserProfile,
  loadDashboard,
  loadUserFiles,
  loadUserPublications,
  loadApiActivity,

  loadNotifications,
  markNotificationRead,
  markAllNotificationsRead,

  loadProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,

  generateApiKey,
  regenerateApiKey,
  getProjectApiKey,
  getApiKey,

  listUserApiKeys,
  createUserApiKey,
  updateUserApiKey,
  deleteUserApiKey,
  listUserApiKeyTrash,
  restoreUserApiKey,
  permanentDeleteUserApiKey,
  emptyUserApiKeyTrash,

  uploadProjectFile,
  uploadFile,
  loadProjectFiles,
  loadFiles,
  deleteFile,

  uploadPublicationFile,
  loadRecentPublications,
  deletePublication,

  sendApiRequest,
  getApiStatus,
  uploadProjectFileWithApiKey,
  uploadPublicationWithApiKey,

  debugSession,
  testConnection
};

console.log('NubiflyAPI listo:', window.NubiflyAPI);
