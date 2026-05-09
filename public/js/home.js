/**
 * home.js — Nubifly Dashboard  ·  v2.0
 * JavaScript moderno: ES6+ classes, async/await, event delegation
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

/* ════════════════════════════════════════════
   GLOBALS — compatibilidad con home-api.js
   home-api.js muta estos arrays directamente:
     apiKeys.length = 0; apiKeys.push(...data);
     renderApiKeys();
   Por eso deben ser arrays globales (no solo Store).
════════════════════════════════════════════ */
const apiKeys    = [];
const trashItems = [];
let projects     = [];
const projColors = [
  '#4F6EF7','#0EA5E9','#10B981','#F59E0B',
  '#EF4444','#8B5CF6','#EC4899','#F97316',
];
let currentProjId  = null;
let pendingDelFile = null;   // fileId pendiente de borrar

/* ════════════════════════════════════════════
   ESTADO REACTIVO — Store central
════════════════════════════════════════════ */
const Store = (() => {
  const _state = {
    currentPage: 'panel',
    subOpen:     false,
    categories:  [],
    apiKeys:     apiKeys,       // ← misma referencia global
    trashItems:  trashItems,    // ← misma referencia global
    currentPerm: 'all',
    newKeyFull:  '',
    newKeyVisible: false,
    pendingDeleteId: null,
  };

  const _listeners = {};

  const emit = (event, data) => {
    (_listeners[event] || []).forEach(fn => fn(data));
  };

  return {
    get: key => _state[key],
    set(key, value) {
      _state[key] = value;
      emit(key, value);
      emit('change', { key, value });
    },
    on(event, fn) {
      _listeners[event] = _listeners[event] || [];
      _listeners[event].push(fn);
    },
    state: _state,
  };
})();

/* ════════════════════════════════════════════
   UTILIDADES
════════════════════════════════════════════ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const el = id => document.getElementById(id);

const raf = fn => requestAnimationFrame(fn);

/** Genera una clave API aleatoria */
const generateApiKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rand = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `cvlt_sk_live_${rand}`;
};

/** Enmascara una clave para mostrar sólo el prefijo + primeros 4 chars */
const maskKey = full => {
  const prefix = 'cvlt_sk_live_';
  return prefix + full.slice(prefix.length, prefix.length + 4) + '••••••••••••••••••••••••••••';
};

/** Formatea fecha actual en locale es-MX */
const dateNow = () =>
  new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** SVG de ojo abierto */
const eyeOpenSVG = () =>
  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';

/** SVG de ojo cerrado */
const eyeClosedSVG = () =>
  '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>' +
  '<path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>' +
  '<line x1="1" y1="1" x2="23" y2="23"/>';

/* ════════════════════════════════════════════
   MÓDULO: DRAWER / SIDEBAR
════════════════════════════════════════════ */
const Drawer = {
  open() {
    el('drawer')?.classList.add('open');
    el('overlay')?.classList.add('on');
    el('menuBtn')?.classList.add('open');
    el('menuBtn')?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  },

  close() {
    el('drawer')?.classList.remove('open');
    el('overlay')?.classList.remove('on');
    el('menuBtn')?.classList.remove('open');
    el('menuBtn')?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  },

  toggle() {
    el('drawer')?.classList.contains('open') ? this.close() : this.open();
  },
};

/* ════════════════════════════════════════════
   MÓDULO: NAVEGACIÓN DE PÁGINAS
════════════════════════════════════════════ */
const PAGE_LABELS = {
  panel:            'Inicio',
  nueva:            'Nueva Publicación',
  todas:            'Publicaciones',
  categorias:       'Categorías',
  analytics:        'Analytics',
  apikeys:          'Claves API',
  papelera:         'Papelera',
  proyectos:        'Proyectos',
  'nuevo-proyecto': 'Nuevo Proyecto',
  'proj-detail':    'Proyecto',
  notificaciones:   'Notificaciones',
  log:              'Log',
};

/** IDs de nav-items que son "plain" (gris, sin fondo activo) */
const PLAIN_NAV_IDS = new Set([
  'nav-categorias', 'nav-analytics', 'nav-apikeys',
  'nav-papelera', 'nav-proyectos', 'nav-notificaciones', 'nav-log',
]);

/** Páginas que tienen toolbar propio (ocultan el topbar global) */
const PAGES_WITH_TOOLBAR = new Set([
  'nueva', 'nuevo-proyecto', 'todas', 'categorias', 'analytics',
  'apikeys', 'papelera', 'proyectos', 'proj-detail', 'notificaciones', 'log',
]);

const Nav = {
  goPage(id) {
    // 1. Ocultar todas las páginas
    $$('.page').forEach(p => p.classList.remove('active'));

    // 2. Mostrar la página destino con animación
    const pg = el(`page-${id}`);
    if (pg) {
      pg.classList.add('active');
      // Re-trigger animación (mobile-safe: animationName + offsetWidth)
      pg.style.animationName = 'none';
      void pg.offsetWidth;
      pg.style.animationName = '';
    }

    // 3. Reset nav items al estado base
    $$('.nav-item').forEach(n => {
      n.classList.remove('active');
      n.style.cssText = '';
      n.classList.toggle('plain', PLAIN_NAV_IDS.has(n.id));
    });
    $$('.nav-sub-item').forEach(n => n.classList.remove('active-sub'));

    // 4. Marcar item activo
    el(`nav-${id}`)?.classList.add('active');
    el(`nav-${id}`)?.setAttribute('aria-current', 'page');

    // 5. Gestionar sub-menú de publicaciones
    const pubEl = el('nav-pubs');
    if (id === 'nueva' || id === 'todas') {
      if (pubEl) {
        pubEl.style.background = '#F4F4F5';
        pubEl.style.color = 'var(--ink)';
      }
      if (!Store.get('subOpen')) this.toggleSub();
    } else if (pubEl) {
      pubEl.style.cssText = '';
    }

    // 6. Topbar — ocultar en páginas con toolbar propio
    const topbar = $('.topbar');
    const pageWrap = $('.page-wrap');
    if (PAGES_WITH_TOOLBAR.has(id)) {
      if (topbar) topbar.style.display = 'none';
      if (pageWrap) pageWrap.style.paddingTop = '0';
    } else {
      if (topbar) topbar.style.display = '';
      if (pageWrap) pageWrap.style.paddingTop = '';
      const topbarTitle = el('topbarTitle');
      if (topbarTitle) topbarTitle.textContent = PAGE_LABELS[id] ?? 'Nubifly';
    }

    // 7. Reset toolbar frosted en navegación
    const prevTb = $('.nueva-toolbar');
    if (prevTb) prevTb.style.cssText = '';

    Store.set('currentPage', id);

    // 8. Scroll arriba + cerrar drawer
    pageWrap?.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => Drawer.close(), 180);

    // 9. Re-render la sección destino — garantiza que el diseño/empty-state
    //    aparezca aunque el boot() async todavía no haya terminado.
    const _renders = {
      proyectos:      () => renderProjects(),
      categorias:     () => Categories.render(),
      apikeys:        () => { ApiKeys.render(); if (typeof renderApiUsageAnalysis === 'function') renderApiUsageAnalysis(); },
      papelera:       () => Trash.render(),
      panel:          () => {
        if (typeof renderRecentPubs  === 'function') renderRecentPubs();
      },
      todas:          () => {
        if (typeof renderTodasPubs   === 'function') renderTodasPubs();
      },
      notificaciones: () => {
        if (typeof renderNotifications === 'function') renderNotifications();
      },
      log:            () => {
        if (typeof renderActivity === 'function') renderActivity();
      },
    };
    _renders[id]?.();
  },

  toggleSub() {
    const isOpen = !Store.get('subOpen');
    Store.set('subOpen', isOpen);
    el('pubSub')?.classList.toggle('open', isOpen);
    el('pubChev')?.classList.toggle('open', isOpen);
    el('nav-pubs')?.setAttribute('aria-expanded', String(isOpen));
  },
};

/* ════════════════════════════════════════════
   MÓDULO: TOAST NOTIFICATIONS
════════════════════════════════════════════ */
const Toast = (() => {
  let _timer = null;

  const ICONS = {
    ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    err:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };

  return {
    show(msg, type = 'ok') {
      const t = el('toast');
      if (!t) return;
      t.innerHTML = (ICONS[type] ?? ICONS.ok) + `<span>${msg}</span>`;
      t.className = `toast show toast--${type}`;
      clearTimeout(_timer);
      _timer = setTimeout(() => t.classList.remove('show'), 2800);
    },
  };
})();

/* ════════════════════════════════════════════
   MÓDULO: FORMULARIO DE PUBLICACIÓN
════════════════════════════════════════════ */
const PublishForm = {
  addTag(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const inp = el('tagInput');
    const val = inp?.value.trim().replace(',', '');
    if (!val || !inp) return;

    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `${val} <button type="button" aria-label="Eliminar etiqueta ${val}">×</button>`;
    chip.querySelector('button').addEventListener('click', e => {
      e.stopPropagation();
      chip.remove();
    });

    el('tagsWrap')?.insertBefore(chip, inp);
    inp.value = '';
  },

  handleDrop(e) {
    e.preventDefault();
    el('uploadZone')?.classList.remove('drag');
    const count = e.dataTransfer?.files?.length ?? 0;
    if (count) Toast.show(`${count} archivo${count > 1 ? 's' : ''} cargado${count > 1 ? 's' : ''}`);
  },

  async publish() {
    const title = el('pubTitle')?.value?.trim();
    if (!title) {
      Toast.show('Escribe un título primero', 'warn');
      el('pubTitle')?.focus();
      return;
    }
    Toast.show('Publicado correctamente');
    await new Promise(r => setTimeout(r, 700));
    Nav.goPage('todas');
  },
};

/* ════════════════════════════════════════════
   MÓDULO: CATEGORÍAS
   — usa modal profesional en lugar de prompt()
   — muestra categorías auto-detectadas de publicaciones
════════════════════════════════════════════ */

/** Definición de todas las categorías posibles */
const CAT_DEFS = [
  { key: 'image',        label: 'Imágenes',          color: '#2563EB',
    svgPath: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>' },
  { key: 'video',        label: 'Videos',             color: '#DC2626',
    svgPath: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>' },
  { key: 'audio',        label: 'Audios',             color: '#059669',
    svgPath: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  { key: 'pdf',          label: 'PDF',                color: '#EA580C',
    svgPath: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>' },
  { key: 'document',     label: 'Documentos',         color: '#7C3AED',
    svgPath: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
  { key: 'spreadsheet',  label: 'Hojas de cálculo',   color: '#16A34A',
    svgPath: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>' },
  { key: 'presentation', label: 'Presentaciones',     color: '#D97706',
    svgPath: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
  { key: 'compressed',   label: 'Comprimidos',        color: '#64748B',
    svgPath: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>' },
  { key: 'code',         label: 'Código',             color: '#0891B2',
    svgPath: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
  { key: 'apk',          label: 'Aplicaciones',       color: '#BE185D',
    svgPath: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>' },
  { key: 'other',        label: 'Otros',              color: '#6B7280',
    svgPath: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
];

/** Detecta la categoría de una publicación por su nombre/mimeType */
function detectPubCategory(pub) {
  const name = (pub.fileName || pub.name || pub.originalName || pub.title || '').toLowerCase();
  const mime = (pub.mimeType || pub.contentType || '').toLowerCase();
  const ext  = name.includes('.') ? name.split('.').pop() : '';

  const EXT_MAP = {
    image:        ['jpg','jpeg','png','gif','webp','avif','svg','bmp','ico','tiff','heic'],
    video:        ['mp4','mov','avi','mkv','webm','flv','wmv','m4v','3gp'],
    audio:        ['mp3','wav','ogg','flac','m4a','aac','wma','opus'],
    pdf:          ['pdf'],
    document:     ['doc','docx','odt','rtf','txt','pages'],
    spreadsheet:  ['xls','xlsx','ods','csv','numbers'],
    presentation: ['ppt','pptx','odp','key'],
    compressed:   ['zip','rar','7z','tar','gz','bz2','xz'],
    code:         ['js','ts','py','java','c','cpp','cs','php','rb','go','rs','html','css','json','xml','sh','yml','yaml','md'],
    apk:          ['apk','ipa','exe','dmg','deb','rpm'],
  };

  // Priority: use categoryKey from backend if present
  if (pub.categoryKey) return pub.categoryKey;

  // Check by mime prefix
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';

  // Check by extension
  for (const [cat, exts] of Object.entries(EXT_MAP)) {
    if (exts.includes(ext)) return cat;
  }

  return 'other';
}

const Categories = {
  _pubCategories: [],   // derived from publications, set by home-api.js

  /** Abre el modal profesional para crear categoría */
  openModal() {
    const inp = el('catNameInput');
    const err = el('catNameErr');
    if (inp) inp.value = '';
    if (err) err.style.display = 'none';
    el('catModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => inp?.focus(), 320);
  },

  /** Cierra el modal de categoría */
  closeModal() {
    el('catModal')?.classList.remove('open');
    document.body.style.overflow = '';
  },

  /** Confirma la creación desde el modal */
  confirm() {
    const inp  = el('catNameInput');
    const err  = el('catNameErr');
    const name = inp?.value?.trim();
    if (!name) {
      if (err) err.style.display = '';
      inp?.focus();
      inp && (inp.style.borderColor = 'var(--danger)');
      setTimeout(() => { if (inp) inp.style.borderColor = ''; }, 1400);
      return;
    }
    const cats = Store.get('categories');
    if (!cats.includes(name)) {
      cats.push(name);
      Store.set('categories', [...cats]);
    }
    this.closeModal();
    this.render();
    Toast.show('Categoría creada');
  },

  /** Elimina una categoría manual por índice */
  delete(i) {
    const cats = [...Store.get('categories')];
    cats.splice(i, 1);
    Store.set('categories', cats);
    this.render();
    Toast.show('Categoría eliminada');
  },

  /** Recibe publicaciones desde home-api.js y re-renderiza */
  refreshFromPublications(pubs) {
    // Agrupa por categoría detectada
    const map = {};
    for (const pub of (pubs || [])) {
      const key = detectPubCategory(pub);
      if (!map[key]) map[key] = { key, count: 0, pubs: [] };
      map[key].count++;
      map[key].pubs.push(pub);
    }
    this._pubCategories = Object.values(map).sort((a, b) => b.count - a.count);
    this.render();
  },

  render() {
    const list      = el('catList');
    const empty     = el('catEmpty');
    const count     = el('catCount');
    const manualCats = Store.get('categories');  // categorías manuales

    // Fusionar: categorías de publicaciones + manuales sin publicaciones
    const pubKeys = new Set(this._pubCategories.map(c => c.key));

    // Categorías con publicaciones
    const cards = [...this._pubCategories];

    // Categorías manuales que no coinciden con ninguna clave automática
    manualCats.forEach((name, i) => {
      const keyGuess = name.toLowerCase().replace(/\s+/g, '_');
      if (!pubKeys.has(keyGuess)) {
        cards.push({ key: keyGuess, label: name, count: 0, pubs: [], manualIdx: i });
      }
    });

    const total = cards.length;
    if (count) count.textContent = `${total} categoría${total !== 1 ? 's' : ''}`;

    if (!total) {
      if (empty) empty.style.display = 'flex';
      if (list)  list.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (!list)  return;

    list.innerHTML = cards.map((c, i) => {
      const def = CAT_DEFS.find(d => d.key === c.key) || CAT_DEFS[CAT_DEFS.length - 1];
      const color = def.color;
      const pubLabel = c.count === 1 ? '1 publicación' : `${c.count} publicación${c.count !== 1 ? 'es' : ''}`;
      const deleteBtn = c.manualIdx !== undefined
        ? `<button class="more-btn" data-delete-cat="${c.manualIdx}" aria-label="Eliminar ${def.label}" title="Eliminar categoría">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="3 6 5 6 21 6"/>
               <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
             </svg>
           </button>`
        : '';

      return `
        <article class="pub-card stagger" style="cursor:default">
          <div class="pub-card-thumb" style="background:${color}18">
            <svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              ${def.svgPath}
            </svg>
          </div>
          <div class="pub-card-info">
            <div class="pub-card-title">${def.label || c.label || c.key}</div>
            <div class="pub-card-row">
              <span style="color:${color};font-weight:600;font-size:13px">${pubLabel}</span>
            </div>
          </div>
          ${deleteBtn}
        </article>
      `;
    }).join('');
  },
};

/* ════════════════════════════════════════════
   MÓDULO: API KEYS
════════════════════════════════════════════ */
const PERM_LABELS = {
  none:   'Sin acceso',
  read:   'Solo lectura',
  all:    'Acceso total',
  custom: 'Personalizado',
};

const PERM_CLASS = {
  none:   '',
  read:   'perm-read',
  write:  'perm-write',
  all:    'perm-rw',
  custom: 'perm-rw',
};

const PERM_DESC = {
  none:   'Sin acceso a ningún recurso.',
  read:   'Solo puede consultar datos. No puede crear ni modificar.',
  all:    'Acceso completo a todos los recursos.',
  custom: 'Define permisos específicos por cada tipo de recurso.',
};

const ApiKeys = {
  openModal() {
    // Reset estado
    Store.set('currentPerm', 'all');
    Store.set('newKeyVisible', false);

    const modal = el('apiModal');
    el('apiStep1') && (el('apiStep1').style.display = '');
    el('apiStep2') && (el('apiStep2').style.display = 'none');
    el('apiKeyName') && (el('apiKeyName').value = '');

    // Reset permission tabs — select the 'all' tab robustly by data-perm or fallback to 3rd tab
    $$('.perm-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('.perm-tab[data-perm="all"]') ||
                   $$('.perm-tab')[2]; // 'Todo' is the 3rd tab (index 2)
    allTab?.classList.add('active');
    const desc = el('permLevelDesc');
    if (desc) desc.textContent = PERM_DESC.all;
    el('granularSection') && (el('granularSection').style.display = 'none');
    $$('.perm-row-select').forEach(s => (s.value = 'all'));

    modal?.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => el('apiKeyName')?.focus(), 380);
  },

  closeModal() {
    el('apiModal')?.classList.remove('open');
    document.body.style.overflow = '';
  },

  setPermLevel(level, btn) {
    $$('.perm-tab').forEach(t => t.classList.remove('active'));
    btn?.classList.add('active');
    Store.set('currentPerm', level);

    const granular = el('granularSection');
    const desc     = el('permLevelDesc');
    if (desc) desc.textContent = PERM_DESC[level] ?? '';

    if (level === 'custom') {
      if (granular) granular.style.display = '';
      this.updatePermCount();
      return;
    }
    if (granular) granular.style.display = 'none';
    const val = level === 'all' ? 'all' : (level === 'read' ? 'read' : 'none');
    $$('.perm-row-select').forEach(s => (s.value = val));
  },

  updatePermCount() {
    const selects = $$('.perm-row-select');
    const active  = selects.filter(s => s.value !== 'none').length;
    const lbl = el('permCountLabel');
    if (lbl) lbl.textContent = `${active} de ${selects.length} recursos con permisos`;
  },

  async create() {
    const nameEl = el('apiKeyName');
    const name = nameEl?.value.trim();
    if (!name) {
      nameEl?.focus();
      if (nameEl) nameEl.style.borderColor = 'var(--danger)';
      setTimeout(() => { if (nameEl) nameEl.style.borderColor = ''; }, 1400);
      Toast.show('Escribe un nombre para la clave', 'warn');
      return;
    }

    const full = generateApiKey();
    Store.set('newKeyFull', full);
    Store.set('newKeyVisible', false);

    el('apiStep1') && (el('apiStep1').style.display = 'none');
    el('apiStep2') && (el('apiStep2').style.display = '');

    const display = el('newKeyDisplay');
    if (display) display.textContent = maskKey(full);
    this._updateEye();

    const perm = Store.get('currentPerm');
    const keyObj = {
      id: Date.now(), name,
      perm, permLabel: PERM_LABELS[perm] ?? perm,
      key: full, created: dateNow(), calls: 0,
    };

    // Mutar el array global directamente (home-api.js también lo usa así)
    apiKeys.push(keyObj);
    this.render();

    try {
      await NubiflyAPI.createUserApiKey(keyObj);
    } catch (e) {
      console.error('[ApiKeys.create]', e);
    }
  },

  toggleNewVisibility() {
    const visible = !Store.get('newKeyVisible');
    Store.set('newKeyVisible', visible);
    const full = Store.get('newKeyFull');
    const display = el('newKeyDisplay');
    if (display) display.textContent = visible ? full : maskKey(full);
    this._updateEye();
  },

  _updateEye() {
    const icon = el('newKeyEyeIcon');
    if (icon) icon.innerHTML = Store.get('newKeyVisible') ? eyeClosedSVG() : eyeOpenSVG();
  },

  copyNew() {
    navigator.clipboard.writeText(Store.get('newKeyFull'))
      .then(() => Toast.show('Clave copiada al portapapeles'));
  },

  copyById(id) {
    const k = Store.get('apiKeys').find(k => k.id === id);
    if (!k) return;
    navigator.clipboard.writeText(k.key)
      .then(() => Toast.show('Clave copiada al portapapeles'));
  },

  toggleVisibility(id) {
    const valueEl = el(`keyval-${id}`);
    const k = Store.get('apiKeys').find(k => k.id === id);
    if (!valueEl || !k) return;

    const visible = valueEl.dataset.visible === '1';
    valueEl.textContent = visible ? maskKey(k.key) : k.key;
    valueEl.dataset.visible = visible ? '0' : '1';
    const eyeEl = el(`eyeicon-${id}`);
    if (eyeEl) eyeEl.innerHTML = visible ? eyeOpenSVG() : eyeClosedSVG();
  },

  promptDelete(id) {
    const k = Store.get('apiKeys').find(k => k.id === id);
    if (!k) return;
    Store.set('pendingDeleteId', id);
    const nameEl = el('delKeyName');
    if (nameEl) nameEl.textContent = k.name;
    el('delModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  closeDeleteModal() {
    el('delModal')?.classList.remove('open');
    document.body.style.overflow = '';
    Store.set('pendingDeleteId', null);
  },

  async confirmDelete() {
    const pendingId = Store.get('pendingDeleteId');
    if (pendingId === null) return;

    const idx  = apiKeys.findIndex(k => k.id === pendingId);
    let removed = null;
    if (idx !== -1) {
      [removed] = apiKeys.splice(idx, 1);
      trashItems.unshift({ ...removed, type: 'apikey', deletedAt: dateNow() });
      Trash.render();
    }

    this.closeDeleteModal();
    this.render();
    Toast.show('Clave movida a la Papelera');

    if (removed) {
      try { await NubiflyAPI.deleteUserApiKey(String(removed.id)); }
      catch (e) { console.error('[ApiKeys.confirmDelete]', e); }
    }
  },

  render() {
    const list  = el('apiKeyList');
    const empty = el('apiKeyEmpty');
    const usage = el('apiUsageSection');
    const count = el('apiKeysCount');
    const keys  = apiKeys;   // ← leer del global, home-api.js muta este array

    if (count) {
      count.textContent = keys.length === 1 ? '1 clave activa' : `${keys.length} claves activas`;
    }

    if (!keys.length) {
      if (empty) empty.style.display = '';
      if (usage) usage.style.display = 'none';
      if (list)  list.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (usage) usage.style.display = '';
    // Render usage analytics whenever the key list is shown
    setTimeout(() => { if (typeof renderApiUsageAnalysis === 'function') renderApiUsageAnalysis(); }, 0);
    if (!list) return;

    list.innerHTML = keys.map(k => `
      <article class="api-key-card stagger" aria-label="Clave API: ${k.name}">
        <div class="akc-header">
          <div class="akc-name">${k.name}</div>
          <span class="akc-badge ${PERM_CLASS[k.perm] ?? ''}">${k.permLabel}</span>
        </div>
        <div class="akc-key-row">
          <code class="akc-key-val" id="keyval-${k.id}" data-visible="0">${maskKey(k.key)}</code>
          <button class="akc-icon-btn" data-toggle-key="${k.id}" title="Mostrar/ocultar clave" aria-label="Mostrar clave ${k.name}">
            <svg viewBox="0 0 24 24" id="eyeicon-${k.id}" fill="none" stroke="currentColor" stroke-width="1.8">${eyeOpenSVG()}</svg>
          </button>
          <button class="akc-icon-btn" data-copy-key="${k.id}" title="Copiar clave" aria-label="Copiar clave ${k.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
        </div>
        <footer class="akc-footer">
          <span class="akc-meta">Creada el ${k.created}</span>
          <div class="akc-actions">
            <button class="akc-del-btn" data-delete-key="${k.id}" aria-label="Eliminar clave ${k.name}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
              Eliminar
            </button>
          </div>
        </footer>
      </article>
    `).join('');
  },
};

/* ════════════════════════════════════════════
   MÓDULO: PAPELERA
════════════════════════════════════════════ */
const TYPE_LABELS = { apikey: 'Clave API' };
const TYPE_ICONS  = {
  apikey: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
};

const Trash = {
  render() {
    const list     = el('trashList');
    const empty    = el('trashEmpty');
    const count    = el('trashCount');
    const badge    = el('trashBadge');
    const emptyBtn = el('trashEmptyBtn');
    const items    = trashItems;   // ← leer del global, home-api.js muta este array
    const n        = items.length;

    if (count) count.textContent = n === 1 ? '1 elemento eliminado' : `${n} elementos eliminados`;

    if (badge) {
      badge.textContent = n;
      badge.style.display = n ? '' : 'none';
    }

    if (!n) {
      if (empty)    empty.style.display = '';
      if (list)     list.innerHTML = '';
      if (emptyBtn) emptyBtn.style.display = 'none';
      return;
    }
    if (empty)    empty.style.display = 'none';
    if (emptyBtn) emptyBtn.style.display = '';
    if (!list) return;

    list.innerHTML = items.map(item => `
      <article class="trash-card stagger">
        <div class="trash-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            ${TYPE_ICONS[item.type] ?? ''}
          </svg>
        </div>
        <div class="trash-card-info">
          <div class="trash-card-name">${item.name}</div>
          <div class="trash-card-meta">
            <span class="trash-type-chip">${TYPE_LABELS[item.type] ?? item.type}</span>
            <span>Eliminado el ${item.deletedAt}</span>
          </div>
        </div>
        <div class="trash-card-actions">
          <button class="trash-restore-btn" data-restore="${item.id}" title="Restaurar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
            </svg>
            Restaurar
          </button>
          <button class="trash-del-btn" data-perm-delete="${item.id}" title="Eliminar definitivamente" aria-label="Eliminar definitivamente">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </article>
    `).join('');
  },

  async restore(id) {
    const idx = trashItems.findIndex(i => i.id === id);
    if (idx === -1) return;
    const [item] = trashItems.splice(idx, 1);

    if (item.type === 'apikey') {
      const { deletedAt, type, ...restored } = item;
      apiKeys.push(restored);
      ApiKeys.render();
    }
    this.render();
    Toast.show('Elemento restaurado');
    try { await NubiflyAPI.restoreUserApiKey(String(id)); }
    catch (e) { console.error('[Trash.restore]', e); }
  },

  async permanentDelete(id) {
    const idx = trashItems.findIndex(i => i.id === id);
    if (idx !== -1) trashItems.splice(idx, 1);
    this.render();
    Toast.show('Eliminado definitivamente');
    try { await NubiflyAPI.permanentDeleteUserApiKey(String(id)); }
    catch (e) { console.error('[Trash.permanentDelete]', e); }
  },

  async empty() {
    if (!trashItems.length) return;
    trashItems.length = 0;
    this.render();
    Toast.show('Papelera vaciada');
    try { await NubiflyAPI.emptyUserApiKeyTrash(); }
    catch (e) { console.error('[Trash.empty]', e); }
  },
};

/* ════════════════════════════════════════════
   MÓDULO: PROYECTOS
════════════════════════════════════════════ */
const Projects = {
  _menuOpen: false,

  openModal() {
    el('projModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => el('projName')?.focus(), 300);
  },

  closeModal() {
    el('projModal')?.classList.remove('open');
    document.body.style.overflow = '';
  },

  toggleMenu() {
    this._menuOpen = !this._menuOpen;
    el('projDropdown')?.classList.toggle('open', this._menuOpen);
    el('projMenuBtn')?.setAttribute('aria-expanded', String(this._menuOpen));
  },

  shareAction() {
    Toast.show('Enlace del proyecto copiado');
    this.toggleMenu();
  },
};

/* ════════════════════════════════════════════
   MÓDULO: TOOLBAR SCROLL-AWARE (frosted glass)
════════════════════════════════════════════ */
const ScrollToolbar = {
  _ticking: false,
  _lastY:   0,

  init() {
    const pageWrap = $('.page-wrap');
    if (!pageWrap) return;

    pageWrap.addEventListener('scroll', () => {
      if (this._ticking) return;
      this._ticking = true;
      raf(() => {
        this._update(pageWrap);
        this._ticking = false;
      });
    }, { passive: true });
  },

  _update(wrap) {
    const currentPage = Store.get('currentPage');
    const toolbar = $(`#page-${currentPage} .nueva-toolbar`);
    if (!toolbar) return;

    const sy = wrap.scrollTop;
    const p  = Math.min(sy / 60, 1);

    Object.assign(toolbar.style, {
      background:              `rgba(249,249,249,${0.72 + p * 0.25})`,
      backdropFilter:          `blur(${16 + p * 4}px) saturate(${180 + p * 20}%)`,
      WebkitBackdropFilter:    `blur(${16 + p * 4}px) saturate(${180 + p * 20}%)`,
      borderBottomColor:       `rgba(200,200,200,${0.2 + p * 0.4})`,
      boxShadow:               p > 0 ? `0 1px ${8 * p}px rgba(12,12,14,${0.04 * p})` : 'none',
    });
  },
};

/* ════════════════════════════════════════════
   PROYECTOS — render & detalle
   Usados por home-api.js y por window globals
════════════════════════════════════════════ */

function renderProjects() {
  const list  = el('projList');
  const empty = el('projEmpty');
  const n     = projects.length;

  if (empty) empty.style.display = n ? 'none' : '';
  if (!list) return;

  if (!n) { list.innerHTML = ''; return; }

  list.innerHTML = projects.map((p, i) => {
    const letter = (p.name || 'P')[0].toUpperCase();
    const color  = p.color || projColors[i % projColors.length];
    const date   = p.created
      ? new Date(p.created).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : p.date || '';
    const fileCount = (p.files || []).length;
    const id = p.id || p.projectId;
    return `
      <article class="proj-card stagger" onclick="openProjDetail('${id}')">
        <div class="proj-card-top">
          <div class="proj-card-avatar" style="background:${color}20;color:${color}">${letter}</div>
          <div class="proj-card-meta">
            <div class="proj-card-name">${p.name || 'Sin nombre'}</div>
            <div class="proj-card-date">${date}</div>
          </div>
        </div>
        ${p.desc ? `<div class="proj-card-desc">${p.desc}</div>` : ''}
        <div class="proj-card-footer">
          <div class="proj-card-tags">
            ${(p.tags || []).slice(0, 3).map(t =>
              `<span class="tag-chip" style="pointer-events:none">${t}</span>`
            ).join('')}
          </div>
          <span style="font-size:11px;color:var(--muted)">${fileCount} archivo${fileCount !== 1 ? 's' : ''}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderProjFiles(proj) {
  const list     = el('projFileList');
  const emptyEl  = el('projFilesEmpty');
  if (!list) return;

  const files = proj?.files || [];
  if (!files.length) {
    if (emptyEl) emptyEl.style.display = '';
    list.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const isImg = name => /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(name || '');

  list.innerHTML = files.map(f => {
    const name = f.name || f.fileName || 'Archivo';
    const size = f.size || '';
    const url  = f.url  || f.fileUrl || '';
    const fid  = f.fileId || f.id || '';
    const thumb = (isImg(name) && url)
      ? `<div class="proj-file-thumb"><img src="${url}" alt="" loading="lazy"></div>`
      : `<div class="proj-file-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`;
    return `
      <div class="proj-file-item">
        ${thumb}
        <div class="proj-file-info">
          <div class="proj-file-name">${name}</div>
          ${size ? `<div class="proj-file-size">${size}</div>` : ''}
        </div>
        <div class="proj-file-menu-wrap">
          ${url ? `<a class="proj-file-more" href="${url}" target="_blank" rel="noopener" title="Abrir" onclick="event.stopPropagation()">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>` : ''}
          ${fid ? `<button class="proj-file-more" onclick="event.stopPropagation();_promptDeleteFile('${fid}')" title="Eliminar">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function _promptDeleteFile(fileId) {
  pendingDelFile = fileId;
  el('delFileModal')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openProjDetail(id) {
  const proj = projects.find(p => p.id === String(id) || p.projectId === String(id));
  currentProjId = String(id);

  // Navegar a la página de detalle
  Nav.goPage('proj-detail');

  if (!proj) return;

  const letter = (proj.name || 'P')[0].toUpperCase();
  const color  = proj.color || '#4F6EF7';
  const date   = proj.created
    ? new Date(proj.created).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : proj.date || '—';
  const pidStr    = String(proj.projectId || proj.id || '');
  const apiKeyStr = proj.apiKey?.key || '';

  // Poblar campos del detalle
  const setEl = (id, val) => { const e = el(id); if (e) e.textContent = val; };
  setEl('detailTitle',   proj.name || 'Proyecto');
  setEl('detailName',    proj.name || '—');
  setEl('detailDate',    date);
  setEl('detailDesc',    proj.desc || proj.description || '');
  setEl('detailAccess',  proj.access === 'public' ? 'Público' : 'Privado');

  const avatarEl = el('detailAvatar');
  if (avatarEl) {
    avatarEl.textContent = letter;
    avatarEl.style.background = color + '20';
    avatarEl.style.color = color;
  }

  // Project ID
  const pidEl = el('detailProjectId');
  if (pidEl) { pidEl.textContent = pidStr || '—'; pidEl.dataset.val = pidStr; }

  // API Key (enmascarada)
  const keyEl  = el('detailApiKey');
  const copyBtn = el('btnCopyApiKey');
  if (keyEl) {
    keyEl.textContent = apiKeyStr ? maskKey(apiKeyStr) : 'Sin clave asignada';
    keyEl.dataset.val = apiKeyStr;
  }
  if (copyBtn) copyBtn.style.opacity = apiKeyStr ? '1' : '0.35';

  // Tags
  const tagsEl = el('detailTags');
  if (tagsEl) {
    tagsEl.innerHTML = (proj.tags || []).map(t =>
      `<span class="tag-chip" style="pointer-events:none">${t}</span>`
    ).join('');
  }

  // Archivos
  renderProjFiles(proj);
}

/* ════════════════════════════════════════════
   EVENT DELEGATION — delegación centralizada
════════════════════════════════════════════ */
function setupEventDelegation() {
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action],[data-delete-cat],[data-toggle-key],[data-copy-key],[data-delete-key],[data-restore],[data-perm-delete]');
    if (!target) return;

    // API keys: toggle visibility
    if (target.dataset.toggleKey) {
      ApiKeys.toggleVisibility(Number(target.dataset.toggleKey));
      return;
    }
    // API keys: copy
    if (target.dataset.copyKey) {
      ApiKeys.copyById(Number(target.dataset.copyKey));
      return;
    }
    // API keys: delete
    if (target.dataset.deleteKey) {
      ApiKeys.promptDelete(Number(target.dataset.deleteKey));
      return;
    }
    // Categories: delete
    if (target.dataset.deleteCat !== undefined) {
      Categories.delete(Number(target.dataset.deleteCat));
      return;
    }
    // Trash: restore
    if (target.dataset.restore) {
      Trash.restore(Number(target.dataset.restore));
      return;
    }
    // Trash: permanent delete
    if (target.dataset.permDelete) {
      Trash.permanentDelete(Number(target.dataset.permDelete));
      return;
    }
  });

  // Modal backdrop clicks
  document.addEventListener('click', e => {
    if (e.target === el('apiModal'))  ApiKeys.closeModal();
    if (e.target === el('delModal'))  ApiKeys.closeDeleteModal();
    if (e.target === el('projModal')) Projects.closeModal();
  });
}

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Drawer
  el('menuBtn')?.addEventListener('click', () => Drawer.toggle());
  el('drawerX')?.addEventListener('click', () => Drawer.close());
  el('overlay')?.addEventListener('click', () => Drawer.close());

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      Drawer.close();
      ApiKeys.closeModal();
      ApiKeys.closeDeleteModal();
      Projects.closeModal();
      Categories.closeModal();
    }
  });

  // Render inicial de módulos
  Categories.render();
  ApiKeys.render();
  Trash.render();

  // Scroll-aware toolbar
  ScrollToolbar.init();

  // Event delegation centralizada
  setupEventDelegation();

  // Accessibility: ARIA inicial en menuBtn
  el('menuBtn')?.setAttribute('aria-expanded', 'false');
  el('menuBtn')?.setAttribute('aria-controls', 'drawer');
  el('menuBtn')?.setAttribute('aria-label', 'Abrir menú');
});

/* ════════════════════════════════════════════
   LEGACY GLOBALS — compatibilidad con HTML inline
   (Los onclick="..." del HTML usan estas funciones)
════════════════════════════════════════════ */
Object.assign(window, {
  // Navegación
  goPage:         (...a) => Nav.goPage(...a),
  toggleSub:      ()    => Nav.toggleSub(),

  // Toast
  showToast:      (...a) => Toast.show(...a),

  // Formulario
  addTag:         (...a) => PublishForm.addTag(...a),
  handleDrop:     (...a) => PublishForm.handleDrop(...a),
  handlePublish:  ()    => PublishForm.publish(),

  // Categorías
  addCategory:    ()    => Categories.openModal(),
  deleteCategory: (...a) => Categories.delete(...a),
  openCatModal:   ()    => Categories.openModal(),
  closeCatModal:  ()    => Categories.closeModal(),
  confirmAddCategory: () => Categories.confirm(),

  // API Keys
  openApiModal:              () => ApiKeys.openModal(),
  closeApiModal:             () => ApiKeys.closeModal(),
  handleModalBackdropClick:  (e) => { if (e.target === el('apiModal')) ApiKeys.closeModal(); },
  setPermLevel:              (...a) => ApiKeys.setPermLevel(...a),
  updatePermCount:           () => ApiKeys.updatePermCount(),
  createApiKey:              () => ApiKeys.create(),
  toggleNewKeyVisibility:    () => ApiKeys.toggleNewVisibility(),
  copyNewKey:                () => ApiKeys.copyNew(),
  copyApiKey:                (...a) => ApiKeys.copyById(...a),
  toggleApiKeyVisibility:    (...a) => ApiKeys.toggleVisibility(...a),
  deleteApiKey:              (...a) => ApiKeys.promptDelete(...a),
  closeDelModal:             () => ApiKeys.closeDeleteModal(),
  handleDelBackdropClick:    (e) => { if (e.target === el('delModal')) ApiKeys.closeDeleteModal(); },
  confirmDeleteKey:          () => ApiKeys.confirmDelete(),

  // Render bridges para home-api.js (usa estos nombres directamente)
  renderApiKeys:    () => ApiKeys.render(),
  renderTrash:      () => Trash.render(),
  renderProjects:   () => renderProjects(),
  renderProjFiles:  (...a) => renderProjFiles(...a),
  openProjDetail:   (id) => openProjDetail(id),
  _promptDeleteFile:(id) => _promptDeleteFile(id),

  // Papelera
  restoreTrashItem:  (...a) => Trash.restore(...a),
  permanentDelete:   (...a) => Trash.permanentDelete(...a),
  emptyTrash:        () => Trash.empty(),

  // Proyectos — modal básico
  openProjModal:     () => Projects.openModal(),
  closeProjModal:    () => Projects.closeModal(),
  toggleProjMenu:    () => Projects.toggleMenu(),
  shareProjAction:   () => Projects.shareAction(),

  // saveProject es sobrescrito por home-api.js, aquí solo el fallback
  saveProject: () => {
    const name = el('projName')?.value?.trim();
    if (!name) { Toast.show('Escribe un nombre para el proyecto', 'warn'); return; }
    const color = projColors[projects.length % projColors.length];
    const proj  = {
      id: String(Date.now()), projectId: String(Date.now()),
      name, desc: el('projDesc')?.value?.trim() || '',
      color, files: [], date: null, created: Date.now(),
      access: document.querySelector('.access-btn.active')?.dataset?.access || 'private',
      tags:   [...document.querySelectorAll('#projTagsWrap .tag-chip')].map(c => c.textContent.replace('×','').trim()),
      apiKey: null,
    };
    projects.unshift(proj);
    renderProjects();
    Projects.closeModal();
    Toast.show('Proyecto creado');
  },

  // Proyecto — nuevo proyecto form helpers
  selectAccess: (btn, val) => {
    document.querySelectorAll('.access-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  },
  addProjTagBtn: () => {
    const inp = el('projTagInput');
    const val = inp?.value?.trim();
    if (!val || !inp) return;
    const wrap = el('projTagsWrap');
    if (!wrap) return;
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `${val} <button type="button" onclick="event.stopPropagation();this.parentElement.remove()">×</button>`;
    wrap.insertBefore(chip, inp);
    inp.value = '';
  },

  // Detalle de proyecto
  copyProjectId:  () => {
    const val = el('detailProjectId')?.dataset?.val || el('detailProjectId')?.textContent || '';
    if (val && val !== '—') navigator.clipboard.writeText(val).then(() => Toast.show('Project ID copiado'));
  },
  copyApiKeyFromDetail: () => {
    const val = el('detailApiKey')?.dataset?.val || '';
    if (val) navigator.clipboard.writeText(val).then(() => Toast.show('API Key copiada'));
    else Toast.show('Sin clave asignada aún', 'warn');
  },
  copyProjApi: () => {
    const val = el('detailApiKey')?.dataset?.val || '';
    if (val) navigator.clipboard.writeText(val).then(() => Toast.show('API Key copiada'));
    else Toast.show('Sin clave asignada aún', 'warn');
  },
  deleteProjAction: () => {
    const proj = projects.find(p => p.id === currentProjId || p.projectId === currentProjId);
    if (!proj) return;
    const nameEl = el('delProjName');
    if (nameEl) nameEl.textContent = proj.name;
    el('delProjModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    Projects.toggleMenu && Projects.toggleMenu(); // cerrar dropdown
  },
  closeDelProjModal: () => {
    el('delProjModal')?.classList.remove('open');
    document.body.style.overflow = '';
  },
  // confirmDeleteProj es sobrescrito por home-api.js
  confirmDeleteProj: () => {
    if (!currentProjId) return;
    const idx = projects.findIndex(p => p.id === currentProjId || p.projectId === currentProjId);
    if (idx !== -1) projects.splice(idx, 1);
    el('delProjModal')?.classList.remove('open');
    document.body.style.overflow = '';
    Nav.goPage('proyectos');
    renderProjects();
    Toast.show('Proyecto eliminado');
  },

  // Archivo — borrar en detalle de proyecto
  closeDelFileModal: () => {
    el('delFileModal')?.classList.remove('open');
    document.body.style.overflow = '';
    pendingDelFile = null;
  },
  confirmDeleteFile: async () => {
    if (!pendingDelFile || !currentProjId) return;
    const proj = projects.find(p => p.id === currentProjId || p.projectId === currentProjId);
    if (proj) {
      proj.files = proj.files.filter(f => (f.fileId || f.id) !== pendingDelFile);
      renderProjFiles(proj);
    }
    el('delFileModal')?.classList.remove('open');
    document.body.style.overflow = '';
    pendingDelFile = null;
    Toast.show('Archivo eliminado');
    try { if (typeof NubiflyAPI !== 'undefined') await NubiflyAPI.deleteFile(pendingDelFile); }
    catch (e) { console.warn('[confirmDeleteFile]', e); }
  },

  // Files — fallback until home-api.js overrides this
  handleProjFiles: (fileList) => {
    console.warn('[handleProjFiles] home-api.js aún no ha cargado.');
  },

  // Auth
  logoutUser: () => { if (typeof NubiflyAPI !== 'undefined') NubiflyAPI.logoutUser(); },

  // Legacy (no-op)
  selectPerm: () => {},
});
