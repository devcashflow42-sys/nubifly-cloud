/* ═══════════════════════════════════════════════════════════════
   update.js — Nubifly: control de versión / mantenimiento / suspensión
   Se ejecuta al abrir cualquier página web. Consulta
   GET /api/app/Update/app y, si la app está en mantenimiento o
   suspendida, muestra una capa a pantalla completa con el aviso.
   La configuración vive en PostgreSQL (tabla app_config, una sola fila)
   y solo el administrador puede cambiarla.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Versión del cliente web. Súbela cuando publiques cambios para que el
  // backend pueda avisar "hay una nueva versión disponible".
  var CLIENT_VERSION = '1.0';

  function overlay(icon, titulo, mensaje) {
    // Evita duplicados
    if (document.getElementById('nf-app-state')) return;

    var wrap = document.createElement('div');
    wrap.id = 'nf-app-state';
    wrap.setAttribute('role', 'alertdialog');
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'background:#0d0d0c', 'color:#f5f5f2',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      'text-align:center'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = 'max-width:440px';

    var h = document.createElement('div');
    h.style.cssText = 'font-size:52px;line-height:1;margin-bottom:20px';
    h.textContent = icon;

    var t = document.createElement('h1');
    t.style.cssText = 'font-size:24px;font-weight:700;margin:0 0 12px';
    t.textContent = titulo;

    var p = document.createElement('p');
    p.style.cssText = 'font-size:15px;line-height:1.6;opacity:.75;margin:0';
    p.textContent = mensaje;

    card.appendChild(h);
    card.appendChild(t);
    card.appendChild(p);
    wrap.appendChild(card);

    (document.body || document.documentElement).appendChild(wrap);
    // Bloquea el scroll del fondo
    try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}
  }

  function check() {
    var url = '/api/app/Update/app?version=' + encodeURIComponent(CLIENT_VERSION);
    fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        return res.json().catch(function () { return {}; })
          .then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (r) {
        var d = r.data || {};

        // Suspensión / mantenimiento → 503 con code
        if (d.code === 'APP_SUSPENDED') {
          overlay('🚫', 'Servicio suspendido',
            d.message || 'Nubifly está suspendido temporalmente. Vuelve más tarde.');
          return;
        }
        if (d.code === 'APP_MAINTENANCE') {
          overlay('🛠️', 'En mantenimiento',
            d.message || 'Estamos realizando mejoras. Volvemos en unos minutos.');
          return;
        }

        // Todo OK → dejamos la versión disponible por si otro script la usa
        if (d.success && d.data) {
          window.__NF_APP__ = {
            version:        d.data.version,
            updateRequired: !!d.updateRequired,
            appUrl:         d.data.appUrl
          };
        }
      })
      .catch(function () {
        // Sin conexión o error de red → no bloqueamos la web (fail-open).
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
