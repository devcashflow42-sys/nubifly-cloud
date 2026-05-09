/* ═══════════════════════════════════════════════════════
   theme-color.js — Dynamic StatusBar & NavigationBar color
   Actualiza el color nativo de Android/iOS al hacer scroll
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── 1. Mapa sección → color ───────────────────────── */
  const SECTION_COLORS = [
    { selector: '.hero',         color: '#f5f5f5' },
    { selector: '.logos',        color: '#f5f5f5' },
    { selector: '.stats',        color: '#f5f5f5' },
    { selector: '.steps',        color: '#f5f5f5' },
    { selector: '.features',     color: '#f5f5f5' },
    { selector: '.api-section',  color: '#f5f5f5' },
    { selector: '.pricing',      color: '#f5f5f5' },
    { selector: '.testimonials', color: '#f5f5f5' },
    { selector: '.faq',          color: '#f5f5f5' },
    { selector: '.cta-section',  color: '#f5f5f5' },
    { selector: '.site-footer',  color: '#f5f5f5' }, // footer oscuro
  ];

  /* ── 2. Obtener el meta tag theme-color ────────────── */
  function getMetaTag() {
    // Buscar el meta sin media query (el principal)
    return document.querySelector('meta[name="theme-color"]:not([media])');
  }

  /* ── 3. Animación suave de color (hex interpolation) ─ */
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v =>
      Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
    ).join('');
  }

  let currentColor = '#f5f5f5';
  let targetColor  = '#f5f5f5';
  let animFrame    = null;
  const SPEED      = 0.12; // 0–1, qué tan rápido interpola

  function animateColor() {
    if (currentColor === targetColor) { animFrame = null; return; }

    const [cr, cg, cb] = hexToRgb(currentColor);
    const [tr, tg, tb] = hexToRgb(targetColor);

    const nr = cr + (tr - cr) * SPEED;
    const ng = cg + (tg - cg) * SPEED;
    const nb = cb + (tb - cb) * SPEED;

    currentColor = rgbToHex(nr, ng, nb);

    const meta = getMetaTag();
    if (meta) meta.setAttribute('content', currentColor);

    // Detener cuando estamos muy cerca
    if (Math.abs(tr - nr) < 1 && Math.abs(tg - ng) < 1 && Math.abs(tb - nb) < 1) {
      currentColor = targetColor;
      if (meta) meta.setAttribute('content', targetColor);
      animFrame = null;
      return;
    }

    animFrame = requestAnimationFrame(animateColor);
  }

  function setThemeColor(color) {
    if (color === targetColor) return;
    targetColor = color;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(animateColor);
  }

  /* ── 4. IntersectionObserver — detectar sección visible ── */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        // Buscar qué color corresponde a este elemento
        const match = SECTION_COLORS.find(sc =>
          entry.target.matches(sc.selector)
        );
        if (match) setThemeColor(match.color);
      });
    },
    {
      threshold: 0.15, // 15% del elemento visible → cambiar color
      rootMargin: '-40px 0px 0px 0px' // compensar navbar
    }
  );

  /* ── 5. Registrar secciones cuando el DOM esté listo ─── */
  function init() {
    SECTION_COLORS.forEach(sc => {
      const el = document.querySelector(sc.selector);
      if (el) observer.observe(el);
    });

    // Color inicial según posición actual
    const initial = SECTION_COLORS.find(sc =>
      document.querySelector(sc.selector)
    );
    if (initial) {
      currentColor = initial.color;
      const meta = getMetaTag();
      if (meta) meta.setAttribute('content', currentColor);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
