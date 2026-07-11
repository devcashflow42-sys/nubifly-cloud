/* ═══════════════════════════════════════════════
   NUBIFLY — Main JavaScript
   main.js
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // ─── NAV SCROLL ───
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('solid', scrollY > 40);
  });

  // ─── HERO TYPEWRITER ───
  const heroPhrases = [
    'Impulsando experiencias conectadas para el futuro digital',
    'Publica imágenes y videos sin límites',
    'Sube archivos desde cualquier dispositivo',
    'Crea proyectos y organiza tu contenido',
    'Comparte con quien quieras, cuando quieras',
    'Controla quién accede a tus archivos',
    'Tu biblioteca digital, siempre disponible'
  ];

  const lineEl   = document.getElementById('hero-type-line');
  const cursorEl = document.querySelector('.hero-type-cursor');

  if (lineEl) {
    let pIdx   = 0;
    let cIdx   = 0;
    let phase  = 'typing';  // 'typing' | 'hold' | 'deleting' | 'gap'
    const SPEED_TYPE   = 38;
    const SPEED_DELETE = 18;
    const HOLD_MS      = 2200;
    const GAP_MS       = 260;

    function tick() {
      const phrase = heroPhrases[pIdx];

      if (phase === 'typing') {
        cIdx++;
        lineEl.textContent = phrase.slice(0, cIdx);
        if (cIdx >= phrase.length) {
          phase = 'hold';
          setTimeout(tick, HOLD_MS);
        } else {
          // Slight variation in speed for natural feel
          setTimeout(tick, SPEED_TYPE + Math.random() * 22);
        }

      } else if (phase === 'hold') {
        phase = 'deleting';
        setTimeout(tick, 80);

      } else if (phase === 'deleting') {
        cIdx--;
        lineEl.textContent = phrase.slice(0, cIdx);
        if (cIdx <= 0) {
          phase = 'gap';
          pIdx  = (pIdx + 1) % heroPhrases.length;
          setTimeout(tick, GAP_MS);
        } else {
          setTimeout(tick, SPEED_DELETE + Math.random() * 8);
        }

      } else if (phase === 'gap') {
        cIdx  = 0;
        phase = 'typing';
        setTimeout(tick, 60);
      }
    }

    // Start after hero entrance animation completes
    setTimeout(tick, 900);
  }

  // ─── ENHANCED SCROLL ANIMATIONS ───

  // Grid containers whose CHILDREN should stagger in individually
  const GRID_SELECTORS = [
    '.features-grid', '.steps-row', '.who-grid',
    '.tl-grid', '.comp-grid', '.nf-plans', '.pricing-grid',
    '.faq-list', '.proj-grid'
  ].join(', ');

  // Cards to stagger within grids
  const CARD_SELECTORS = [
    '.feat-card', '.step-card', '.who-card', '.tl-card',
    '.comp-col', '.nf-card', '.price-card', '.faq-item', '.proj-card'
  ].join(', ');

  // Determine animation type for a .reveal element
  function classifyReveal(el) {
    if (el.querySelector('.sec-h'))          return 'header';
    if (el.matches(GRID_SELECTORS))          return 'grid';
    return 'base';
  }

  // Stagger-animate the card children of a grid
  function staggerGrid(gridEl) {
    const cards = gridEl.querySelectorAll(CARD_SELECTORS);
    if (!cards.length) return;

    // Override the grid container's own reveal so only cards animate
    gridEl.style.opacity  = '1';
    gridEl.style.transform = 'none';
    gridEl.style.transition = 'none';

    cards.forEach((card, i) => {
      const delay = (i * 0.07).toFixed(2);
      card.style.animation = `nf-card-in 0.82s cubic-bezier(0.16,1,0.3,1) ${delay}s both`;
      // Remove inline anim after it ends so hover effects restore normally
      const cleanAt = (0.82 + parseFloat(delay)) * 1000 + 120;
      setTimeout(() => { card.style.animation = ''; }, cleanAt);
    });
  }

  // Blur-entrance for section headers
  function headerEntrance(el) {
    el.classList.add('nf-rv-blur');
    el.classList.remove('reveal');
    // Double rAF so browser sees initial filter before transitioning
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  }

  const revObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const type = classifyReveal(el);

      if (type === 'header') {
        headerEntrance(el);
      } else if (type === 'grid') {
        el.classList.add('in');
        staggerGrid(el);
      } else {
        el.classList.add('in');
      }

      revObs.unobserve(el);
    });
  }, { threshold: 0.07, rootMargin: '0px 0px -55px 0px' });

  document.querySelectorAll('.reveal').forEach(el => revObs.observe(el));

  // Fallback: force-show reveals already in viewport on load
  setTimeout(() => {
    document.querySelectorAll('.reveal').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight + 80) {
        const type = classifyReveal(el);
        if (type === 'header')     headerEntrance(el);
        else if (type === 'grid')  { el.classList.add('in'); staggerGrid(el); }
        else                       el.classList.add('in');
      }
    });
  }, 350);

  // ─── FAQ ACCORDION ───
  document.querySelectorAll('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const open = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!open) item.classList.add('open');
    });
  });

  // ─── ANIMATED COUNTERS ───
  function counter(el, target, suffix, dur = 1400) {
    let start = null;
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const v = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(v * target) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const cObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      counter(document.getElementById('c1'), 48, 'K');
      counter(document.getElementById('c2'), 80, 'ms');
      counter(document.getElementById('c3'), 120, '');
      cObs.disconnect();
    });
  }, { threshold: 0.5 });

  const cTarget = document.querySelector('.proj-stats');
  if (cTarget) cObs.observe(cTarget);

  // ─── PARTICLES CANVAS ───
  (function () {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, pts = [];

    function resize() {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    }

    function rand(a, b) {
      return Math.random() * (b - a) + a;
    }

    function init() {
      resize();
      pts = [];
      const n = Math.floor((W * H) / 14000);
      for (let i = 0; i < n; i++) {
        pts.push({
          x: rand(0, W), y: rand(0, H),
          vx: rand(-0.18, 0.18), vy: rand(-0.18, 0.18),
          r: rand(0.6, 1.6), a: rand(0.1, 0.35)
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,100,95,${p.a})`;
        ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(120,120,115,${0.07 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', init);
    init();
    draw();
  })();

  // ─── PARALLAX SYSTEM — unified lerp-based engine ───
  (function () {
    const LERP_S = 0.10;   // scroll smoothing
    const LERP_M = 0.055;  // mouse smoothing

    let rawY    = window.scrollY;
    let smoothY = rawY;
    let tmx = 0, tmy = 0;
    let mx  = 0, my  = 0;

    function lerp(a, b, t) { return a + (b - a) * t; }

    /* ── Layer 1: hero decoration circles (scroll + mouse + sinusoidal float) ── */
    const heroBubbles = [
      { el: document.querySelector('.hero-deco-circle.deco-1'), spd: 0.18, mStr: 0.40, fAmp: 20, fFreq: 0.00088 },
      { el: document.querySelector('.hero-deco-circle.deco-2'), spd: 0.11, mStr: 0.26, fAmp: 15, fFreq: 0.00063 },
      { el: document.querySelector('.hero-deco-circle.deco-3'), spd: 0.07, mStr: 0.16, fAmp:  9, fFreq: 0.00112 },
    ].filter(d => d.el);

    /* ── Layer 2: hero SVG floats (scroll + sinusoidal bob) ── */
    // Delayed so the CSS rise (opacity entrance) finishes first
    let svgReady = false;
    setTimeout(() => { svgReady = true; }, 2450);

    const svgFloats = [
      { el: document.querySelector('.svg-right'), spd:  0.13, bAmp: 11, bFreq: 0.00062 },
      { el: document.querySelector('.svg-left'),  spd: -0.09, bAmp:  9, bFreq: 0.00046 },
    ].filter(d => d.el);

    /* ── Layer 3: data-parallax section decorations (scroll only) ── */
    const dpLayers = [];
    document.querySelectorAll('[data-parallax]').forEach(el => {
      dpLayers.push({ el, speed: parseFloat(el.dataset.parallax) || 0.1 });
    });

    /* ── Input capture ── */
    document.addEventListener('mousemove', e => {
      tmx = e.clientX / innerWidth  - 0.5;
      tmy = e.clientY / innerHeight - 0.5;
    }, { passive: true });

    window.addEventListener('scroll', () => { rawY = window.scrollY; }, { passive: true });

    /* ── Main animation loop ── */
    function tick(ts) {
      smoothY = lerp(smoothY, rawY, LERP_S);
      mx = lerp(mx, tmx, LERP_M);
      my = lerp(my, tmy, LERP_M);

      // Hero bubbles: scroll depth + reactive mouse + organic float
      heroBubbles.forEach(({ el, spd, mStr, fAmp, fFreq }) => {
        const fx = Math.cos(ts * fFreq * 0.72) * (fAmp * 0.42);
        const fy = Math.sin(ts * fFreq) * fAmp;
        const dx = (mx * mStr * 40 + fx).toFixed(1);
        const dy = (my * mStr * 40 + fy - smoothY * spd).toFixed(1);
        el.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      });

      // SVG floats: organic bob + scroll offset (preserves vertical centering)
      if (svgReady) {
        svgFloats.forEach(({ el, spd, bAmp, bFreq }) => {
          const offset = (Math.sin(ts * bFreq) * bAmp - smoothY * spd).toFixed(1);
          el.style.transform = `translateY(calc(-50% + ${offset}px))`;
        });
      }

      // Section decorative orbs & rings: scroll parallax at their own speed
      dpLayers.forEach(({ el, speed }) => {
        el.style.transform = `translate3d(0,${(smoothY * speed).toFixed(1)}px,0)`;
      });

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  })();

  // Contador regresivo de la oferta de lanzamiento
  initLaunchCountdown();

}); // end DOMContentLoaded

// Revierte los precios al valor normal (sin descuento) cuando la oferta termina
function revertLaunchPrices() {
  document.querySelectorAll('.nf-card').forEach(function (card) {
    const oldEl = card.querySelector('.nf-price-old');
    const numEl = card.querySelector('.nf-price-num');
    if (oldEl && numEl) {
      numEl.dataset.usd = oldEl.dataset.usd;   // el número principal pasa a ser el original
      numEl.dataset.mxn = oldEl.dataset.mxn;
      oldEl.style.display = 'none';
    }
  });
  document.querySelectorAll('.nf-off-tag').forEach(function (t) { t.style.display = 'none'; });
  setCurrency(_currency);   // re-render con la moneda actual
}

// ─── CONTADOR DE LANZAMIENTO ───
function initLaunchCountdown() {
  const sec = document.getElementById('promoBar');
  if (!sec) return;
  const end = new Date(sec.getAttribute('data-end') || '').getTime();
  if (isNaN(end)) { return; }

  const elD = document.getElementById('lc-d');
  const elH = document.getElementById('lc-h');
  const elM = document.getElementById('lc-m');
  const elS = document.getElementById('lc-s');
  const box = document.getElementById('launchCount');
  const ended = document.getElementById('launchEnded');
  if (!elD || !elH || !elM || !elS) return;

  const pad = (n) => String(n).padStart(2, '0');
  let timer = null;

  function set(el, val) {
    const v = pad(val);
    if (el.textContent === v) return;
    el.textContent = v;
    el.classList.remove('tick');
    void el.offsetWidth;      // reinicia la animación
    el.classList.add('tick');
  }

  function tick() {
    let diff = Math.floor((end - Date.now()) / 1000);
    if (diff <= 0) {
      if (box) box.style.display = 'none';
      if (ended) ended.hidden = false;
      if (timer) clearInterval(timer);
      revertLaunchPrices();   // oferta terminada → precios normales
      return;
    }
    const d = Math.floor(diff / 86400); diff -= d * 86400;
    const h = Math.floor(diff / 3600);  diff -= h * 3600;
    const m = Math.floor(diff / 60);
    const s = diff - m * 60;
    set(elD, d); set(elH, h); set(elM, m); set(elS, s);
  }

  tick();
  timer = setInterval(tick, 1000);
}

// ─── PLAN SELECTION ───

function _deselectAll() {
  document.querySelectorAll('.nf-card').forEach(c => c.classList.remove('nf-selected'));
}

// Tap on the CARD BODY — only selects (color applied via CSS), never deselects
function selectPlan(card) {
  if (card.classList.contains('nf-selected')) return;
  document.querySelectorAll('.nf-card').forEach(c => c.classList.remove('nf-selected'));
  card.classList.add('nf-selected');
}

// ── Moneda seleccionada (USD / MXN) ──────────────────────────────────────
let _currency = 'usd';

function setCurrency(cur) {
  _currency = (cur === 'mxn') ? 'mxn' : 'usd';
  // Botones activos
  document.querySelectorAll('.nf-cur-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.cur === _currency);
  });
  // Precio principal (con descuento durante el lanzamiento)
  document.querySelectorAll('.nf-price-num').forEach(function (el) {
    const v = el.dataset[_currency];
    if (v != null) el.textContent = v;
  });
  // Precio original tachado
  document.querySelectorAll('.nf-price-old').forEach(function (el) {
    const v = el.dataset[_currency];
    if (v != null) el.textContent = '$' + v;
  });
  // Etiqueta de moneda (USD / MXN)
  document.querySelectorAll('.nf-cur-label').forEach(function (el) {
    el.textContent = _currency.toUpperCase();
  });
}

// Tap on the BUTTON — va directo a Stripe Checkout (sin exigir login)
async function togglePlan(card) {
  const planId = (card.dataset.plan || '').trim().toLowerCase();
  if (!planId) return;

  // Plan gratis → registro normal, no cobrar
  if (planId === 'gratis') {
    window.location.href = '/register';
    return;
  }

  const btn = card.querySelector('.nf-btn');
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Redirigiendo…';
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    // Auth opcional: si hay sesión y NO está expirada, la mandamos para
    // que Stripe cargue el email del usuario y el plan se active al pagar.
    const token = localStorage.getItem('nf_token');
    if (token) {
      try {
        const parts   = token.split('.');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload.exp || payload.exp >= Math.floor(Date.now() / 1000)) {
          headers['Authorization'] = 'Bearer ' + token;
        }
      } catch { /* token inválido → ignorar y seguir como invitado */ }
    }

    const res = await fetch('/api/payment/checkout', {
      method: 'POST',
      headers,
      body: JSON.stringify({ plan: planId, currency: _currency })
    });

    // Leer como texto primero para poder diagnosticar respuestas no-JSON
    // (p. ej. si la ruta cae al fallback SPA y devuelve el index.html).
    var rawText = '';
    var data = null;
    try { rawText = await res.text(); data = JSON.parse(rawText); } catch (_) { /* no era JSON */ }

    if (!res.ok || !data || !data.data || !data.data.url) {
      var looksHtml = /^\s*<(?:!doctype|html)/i.test(rawText);
      var detail;
      if (data && data.message) {
        detail = data.message;                                   // error real del backend
      } else if (looksHtml) {
        detail = 'El endpoint de pago no está desplegado (HTTP ' + res.status
               + '). Vuelve a desplegar el sitio en Cloudflare Pages.';
      } else {
        detail = 'El servidor respondió HTTP ' + res.status
               + (rawText ? (': ' + rawText.slice(0, 140)) : ' (respuesta vacía).');
      }
      console.warn('[togglePlan] checkout error', res.status, rawText.slice(0, 300));
      alert('No se pudo iniciar el pago.\n\n' + detail);
      return;
    }

    // Redirigir a Stripe Checkout
    window.location.href = data.data.url;

  } catch (e) {
    console.warn('[togglePlan]', e.message);
    alert('Error de conexión: ' + (e.message || 'sin detalle') + '. Inténtalo de nuevo.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }
}

// Click anywhere OUTSIDE the cards → deselect
document.addEventListener('click', function (e) {
  if (!e.target.closest('.nf-card')) {
    if (document.querySelector('.nf-card.nf-selected')) _deselectAll();
  }
});

// ─── API TERMINAL TABS ───
// Exposed globally so onclick attributes in HTML can call it
function showTab(name, el) {
  document.getElementById('tab-nokey').style.display = 'none';
  document.getElementById('tab-withkey').style.display = 'none';
  document.getElementById('tab-' + name).style.display = 'block';
  document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}




// ─── TESTIMONIOS / COMENTARIOS ───
// Renderiza una lista de comentarios de usuarios en dos filas que se
// desplazan automáticamente (carrusel infinito). Para añadir, editar o
// quitar comentarios, solo modifica el arreglo TESTIMONIOS de abajo.
(function () {
  const TESTIMONIOS = [
    { name: 'Carlos Méndez',     handle: '@carlosmz',      msg: 'La página funciona muy bien para publicar mis archivos, todo queda subido en segundos.' },
    { name: 'Valentina Ríos',    handle: '@valen.rios',    msg: 'Puedo crear proyectos para publicar mis imágenes y videos fácilmente, sin complicarme.' },
    { name: 'Andrés Gómez',      handle: '@andresg',       msg: 'Cuando salió esta página web me sorprendió demasiado, no esperaba que fuera tan rápida.' },
    { name: 'Lucía Fernández',   handle: '@luciafdz',      msg: 'Organizo todos mis proyectos en un solo lugar y comparto el enlace en un clic.' },
    { name: 'Mateo Torres',      handle: '@mateo.dev',     msg: 'Subí más de cien imágenes y no se trabó ni una vez. La velocidad es brutal.' },
    { name: 'Camila Herrera',    handle: '@camih',         msg: 'Por fin una plataforma donde publicar mis videos es realmente sencillo.' },
    { name: 'Diego Ramírez',     handle: '@diegoramz',     msg: 'La interfaz es limpia y moderna, se nota que está pensada para creadores.' },
    { name: 'Sofía Castro',      handle: '@sofiacastro',   msg: 'Llevo mis archivos a la nube y los abro desde cualquier dispositivo sin problema.' },
    { name: 'Javier Morales',    handle: '@javim',         msg: 'Creé mi primer proyecto en menos de cinco minutos, increíble lo intuitivo que es.' },
    { name: 'Daniela Vargas',    handle: '@danivargas',    msg: 'Publicar mis fotos y compartirlas con mi equipo nunca había sido tan rápido.' },
    { name: 'Sebastián Ruiz',    handle: '@sebasruiz',     msg: 'Lo recomendé a todos mis compañeros, la experiencia es de otro nivel.' },
    { name: 'Mariana López',     handle: '@marianalp',     msg: 'Me encanta poder subir videos pesados sin perder calidad ni esperar horas.' },
    { name: 'Tomás Aguilar',     handle: '@tomasag',       msg: 'La primera vez que la usé quedé sorprendido por lo bien que está hecha.' },
    { name: 'Paula Navarro',     handle: '@paulanav',      msg: 'Tengo todos mis proyectos ordenados y se ven profesionales al compartirlos.' },
    { name: 'Emilio Castro',     handle: '@emiliocs',      msg: 'Funciona perfecto desde el celular, subo archivos donde sea que esté.' },
    { name: 'Fernanda Díaz',     handle: '@ferdiaz',       msg: 'Es justo lo que necesitaba para publicar mi contenido sin depender de nadie.' },
    { name: 'Ricardo Peña',      handle: '@ricardop',      msg: 'La estabilidad es total, jamás se me ha caído al subir mis videos.' },
    { name: 'Gabriela Soto',     handle: '@gabysoto',      msg: 'Creo proyectos para cada cliente y comparto todo de forma muy ordenada.' },
    { name: 'Hugo Martínez',     handle: '@hugomtz',       msg: 'Pasé de varias herramientas a solo Nubifly, me ahorra muchísimo tiempo.' },
    { name: 'Antonia Reyes',     handle: '@antoreyes',     msg: 'Subir imágenes y verlas al instante hace que trabajar sea un placer.' },
    { name: 'Pablo Guerrero',    handle: '@pablogue',      msg: 'Quedé impactado con la rapidez al publicar, todo se siente inmediato.' },
    { name: 'Renata Flores',     handle: '@renataf',       msg: 'Mis videos quedan listos para compartir apenas termino de subirlos.' },
    { name: 'Iván Salazar',      handle: '@ivansalazar',   msg: 'La plataforma es moderna y muy fácil, la entendí sin tutoriales.' },
    { name: 'Carolina Vega',     handle: '@carovega',      msg: 'Publico mis proyectos y la presentación se ve hermosa, mis clientes lo notan.' },
    { name: 'Nicolás Bravo',     handle: '@nicobravo',     msg: 'Desde que la encontré gestiono todos mis archivos sin estrés. Totalmente recomendada.' }
  ];

  const trackA = document.getElementById('testiTrackA');
  const trackB = document.getElementById('testiTrackB');
  if (!trackA || !trackB) return;

  const AVATAR_TONES = ['#111110', '#2e2e2c', '#5e5e5b', '#1c1c1a'];

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function cardHTML(t, i) {
    const initial = t.name.trim().charAt(0).toUpperCase();
    const tone = AVATAR_TONES[i % AVATAR_TONES.length];
    return (
      '<div class="testi-card">' +
        '<div class="testi-top">' +
          '<div class="testi-avatar" style="background:' + tone + '">' + escapeHTML(initial) + '</div>' +
          '<div class="testi-id">' +
            '<div class="testi-name">' + escapeHTML(t.name) + '</div>' +
            '<div class="testi-handle">' + escapeHTML(t.handle) + '</div>' +
          '</div>' +
        '</div>' +
        '<p class="testi-msg">' + escapeHTML(t.msg) + '</p>' +
      '</div>'
    );
  }

  // Repartir los comentarios en dos filas
  const rowA = TESTIMONIOS.filter((_, i) => i % 2 === 0);
  const rowB = TESTIMONIOS.filter((_, i) => i % 2 === 1);

  // Duplicar el contenido para lograr el bucle infinito sin cortes
  const htmlA = rowA.map(cardHTML).join('');
  const htmlB = rowB.map(cardHTML).join('');
  trackA.innerHTML = htmlA + htmlA;
  trackB.innerHTML = htmlB + htmlB;
})();

// ─── FOOTER: año automático y suscripción ───
(function () {
  // Año actual en el copyright
  const yEl = document.getElementById('footYear');
  if (yEl) yEl.textContent = new Date().getFullYear();

  // Suscripción al boletín (front-end: valida y confirma)
  // NOTA: para guardar correos de verdad, conecta este formulario a un
  // servicio de email (Mailchimp, Brevo, Resend, etc.) en el evento submit.
  const input = document.getElementById('nlEmail');
  const btn = document.getElementById('nlBtn');
  const msg = document.getElementById('nlMsg');
  if (input && btn && msg) {
    const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
    const show = (text, ok) => {
      msg.textContent = text;
      msg.classList.remove('ok', 'err');
      msg.classList.add(ok ? 'ok' : 'err');
    };
    const submit = () => {
      const val = input.value.trim();
      if (!isEmail(val)) {
        show('Ingresa un correo válido para continuar.', false);
        input.focus();
        return;
      }
      // Aquí iría el envío real al servicio de email.
      show('¡Gracias! Te suscribiste correctamente. 🎉', true);
      input.value = '';
      input.blur();
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (msg.textContent) { msg.textContent = ''; msg.classList.remove('ok', 'err'); }
    });
  }
})();
