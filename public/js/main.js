/* ═══════════════════════════════════════
   js/main.js — Lógica Nubifly
   ═══════════════════════════════════════ */

/* ─────────────────────────────────────
   1. SCROLL REVEAL
───────────────────────────────────── */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  // Fallback: fuerza visibilidad después de 1.2s en caso de que el observer falle (móvil)
  const fallbackTimer = setTimeout(() => {
    els.forEach(el => el.classList.add('visible'));
  }, 1200);

  // Si el navegador no soporta IntersectionObserver, muestra todo inmediatamente
  if (!('IntersectionObserver' in window)) {
    clearTimeout(fallbackTimer);
    els.forEach(el => el.classList.add('visible'));
    return;
  }

  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        obs.unobserve(e.target);
      }
    });
  }, {
    threshold: 0,              // Dispara en cuanto cualquier pixel es visible
    rootMargin: '0px 0px 60px 0px' // Activa 60px antes de entrar al viewport
  });

  els.forEach(el => obs.observe(el));

  // Cancela el fallback si el observer funcionó para todos los elementos
  const visibilityCheck = setInterval(() => {
    const remaining = document.querySelectorAll('.reveal:not(.visible)').length;
    if (remaining === 0) {
      clearTimeout(fallbackTimer);
      clearInterval(visibilityCheck);
    }
  }, 300);
}

/* ─────────────────────────────────────
   2. ROTATING HERO TEXT
───────────────────────────────────── */
function initRotatingText() {
  const words = document.querySelectorAll('#rotator span');
  if (!words.length) return;

  let current = 0;
  setInterval(() => {
    const prev = current;
    current = (current + 1) % words.length;
    words[prev].classList.add('exit');
    words[prev].classList.remove('active');
    words[current].classList.add('active');
    setTimeout(() => words[prev].classList.remove('exit'), 600);
  }, 2000);
}

/* ─────────────────────────────────────
   3. STATS COUNTER ANIMATION
───────────────────────────────────── */
function initCounters() {
  const counters = document.querySelectorAll('.stat-num[data-target]');
  if (!counters.length) return;

  const statsObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseFloat(el.dataset.target);
      const isDecimal = target % 1 !== 0;
      const duration = 2000;
      const start = performance.now();

      const animate = now => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const val = eased * target;
        el.textContent = isDecimal
          ? val.toFixed(1)
          : Math.floor(val).toLocaleString();
        if (progress < 1) requestAnimationFrame(animate);
        else el.textContent = isDecimal
          ? target.toFixed(1)
          : target.toLocaleString();
      };

      requestAnimationFrame(animate);
      statsObs.unobserve(el);
    });
  }, { threshold: .5 });

  counters.forEach(c => statsObs.observe(c));
}

/* ─────────────────────────────────────
   4. FAQ ACCORDION
───────────────────────────────────── */
function initFaq() {
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      btn.nextElementSibling.classList.toggle('open');
    });
  });
}

/* ─────────────────────────────────────
   5. PLAN SELECTION
───────────────────────────────────── */
function selectPlan(card) {
  const isAlreadySelected = card.classList.contains('selected');
  document.querySelectorAll('.price-card').forEach(c => c.classList.remove('selected'));
  if (!isAlreadySelected) card.classList.add('selected');
}

// Deselect when clicking outside cards
function initPlanSelection() {
  document.addEventListener('click', e => {
    if (!e.target.closest('.price-card')) {
      document.querySelectorAll('.price-card').forEach(c => c.classList.remove('selected'));
    }
  });
}

/* ─────────────────────────────────────
   6. API DASHBOARD — DATA
───────────────────────────────────── */
const apiData = [
  {
    title: 'POST /v1/storage/upload',
    latency: '48ms', uptime: '99.9%', rate: '10K/s',
    req: `<span class="code-line"><span class="c-method">POST</span> <span class="c-url">https://api.nubifly.io/v1/storage/upload</span></span>
<span class="code-line"><span class="c-key">Authorization:</span> <span class="c-str">Bearer nf_live_xxxx</span></span>
<span class="code-line"> </span>
<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"bucket"</span>: <span class="c-str">"my-project"</span>,</span>
<span class="code-line">  <span class="c-key">"file"</span>: <span class="c-str">"logo.png"</span>,</span>
<span class="code-line">  <span class="c-key">"public"</span>: <span class="c-bool">true</span>,</span>
<span class="code-line">  <span class="c-key">"ttl"</span>: <span class="c-num">86400</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    res: `<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"id"</span>: <span class="c-str">"file_9xKz3"</span>,</span>
<span class="code-line">  <span class="c-key">"url"</span>: <span class="c-str">"cdn.nubifly.io/..."</span>,</span>
<span class="code-line">  <span class="c-key">"size"</span>: <span class="c-num">24830</span>,</span>
<span class="code-line">  <span class="c-key">"status"</span>: <span class="c-str">"uploaded"</span>,</span>
<span class="code-line">  <span class="c-key">"public"</span>: <span class="c-bool">true</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    curl: `<span class="code-line"><span class="c-method">curl</span> <span class="c-key">-X</span> POST <span class="c-url">https://api.nubifly.io/v1/storage/upload</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Authorization: Bearer nf_live_xxxx"</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Content-Type: application/json"</span> \\</span>
<span class="code-line">  <span class="c-key">-d</span> <span class="c-bracket">'{"bucket":"my-project","file":"logo.png","public":true,"ttl":86400}'</span></span>`
  },
  {
    title: 'POST /v1/access/token',
    latency: '32ms', uptime: '99.9%', rate: '5K/s',
    req: `<span class="code-line"><span class="c-method">POST</span> <span class="c-url">https://api.nubifly.io/v1/access/token</span></span>
<span class="code-line"><span class="c-key">Authorization:</span> <span class="c-str">Bearer nf_live_xxxx</span></span>
<span class="code-line"> </span>
<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"user_id"</span>: <span class="c-str">"usr_abc123"</span>,</span>
<span class="code-line">  <span class="c-key">"scope"</span>: <span class="c-bracket">[</span><span class="c-str">"read"</span>, <span class="c-str">"write"</span><span class="c-bracket">]</span>,</span>
<span class="code-line">  <span class="c-key">"expires_in"</span>: <span class="c-num">3600</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    res: `<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"token"</span>: <span class="c-str">"tk_xP9mQr..."</span>,</span>
<span class="code-line">  <span class="c-key">"type"</span>: <span class="c-str">"Bearer"</span>,</span>
<span class="code-line">  <span class="c-key">"expires_at"</span>: <span class="c-num">1746000000</span>,</span>
<span class="code-line">  <span class="c-key">"scope"</span>: <span class="c-bracket">[</span><span class="c-str">"read"</span>, <span class="c-str">"write"</span><span class="c-bracket">]</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    curl: `<span class="code-line"><span class="c-method">curl</span> <span class="c-key">-X</span> POST <span class="c-url">https://api.nubifly.io/v1/access/token</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Authorization: Bearer nf_live_xxxx"</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Content-Type: application/json"</span> \\</span>
<span class="code-line">  <span class="c-key">-d</span> <span class="c-bracket">'{"user_id":"usr_abc123","scope":["read","write"],"expires_in":3600}'</span></span>`
  },
  {
    title: 'POST /v1/sites/deploy',
    latency: '120ms', uptime: '99.9%', rate: '500/min',
    req: `<span class="code-line"><span class="c-method">POST</span> <span class="c-url">https://api.nubifly.io/v1/sites/deploy</span></span>
<span class="code-line"><span class="c-key">Authorization:</span> <span class="c-str">Bearer nf_live_xxxx</span></span>
<span class="code-line"> </span>
<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"site_id"</span>: <span class="c-str">"site_7zBx"</span>,</span>
<span class="code-line">  <span class="c-key">"branch"</span>: <span class="c-str">"main"</span>,</span>
<span class="code-line">  <span class="c-key">"env"</span>: <span class="c-str">"production"</span>,</span>
<span class="code-line">  <span class="c-key">"clear_cache"</span>: <span class="c-bool">true</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    res: `<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"deploy_id"</span>: <span class="c-str">"dpl_mN8pQ"</span>,</span>
<span class="code-line">  <span class="c-key">"status"</span>: <span class="c-str">"building"</span>,</span>
<span class="code-line">  <span class="c-key">"url"</span>: <span class="c-str">"mysite.nubifly.io"</span>,</span>
<span class="code-line">  <span class="c-key">"eta_seconds"</span>: <span class="c-num">18</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    curl: `<span class="code-line"><span class="c-method">curl</span> <span class="c-key">-X</span> POST <span class="c-url">https://api.nubifly.io/v1/sites/deploy</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Authorization: Bearer nf_live_xxxx"</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Content-Type: application/json"</span> \\</span>
<span class="code-line">  <span class="c-key">-d</span> <span class="c-bracket">'{"site_id":"site_7zBx","branch":"main","env":"production","clear_cache":true}'</span></span>`
  },
  {
    title: 'GET /v1/analytics/summary',
    latency: '22ms', uptime: '99.9%', rate: '20K/s',
    req: `<span class="code-line"><span class="c-method">GET</span> <span class="c-url">https://api.nubifly.io/v1/analytics/summary</span></span>
<span class="code-line"><span class="c-key">Authorization:</span> <span class="c-str">Bearer nf_live_xxxx</span></span>
<span class="code-line"> </span>
<span class="code-line"><span class="c-comment">// Query params</span></span>
<span class="code-line"><span class="c-key">?site_id</span>=<span class="c-str">site_7zBx</span></span>
<span class="code-line"><span class="c-key">&period</span>=<span class="c-str">last_30d</span></span>
<span class="code-line"><span class="c-key">&metrics</span>=<span class="c-str">visits,bandwidth</span></span>`,
    res: `<span class="code-line"><span class="c-bracket">{</span></span>
<span class="code-line">  <span class="c-key">"visits"</span>: <span class="c-num">48320</span>,</span>
<span class="code-line">  <span class="c-key">"bandwidth_gb"</span>: <span class="c-num">12.4</span>,</span>
<span class="code-line">  <span class="c-key">"uptime_pct"</span>: <span class="c-num">99.97</span>,</span>
<span class="code-line">  <span class="c-key">"top_country"</span>: <span class="c-str">"MX"</span></span>
<span class="code-line"><span class="c-bracket">}</span></span>`,
    curl: `<span class="code-line"><span class="c-method">curl</span> <span class="c-key">-X</span> GET \\</span>
<span class="code-line">  <span class="c-url">"https://api.nubifly.io/v1/analytics/summary?site_id=site_7zBx&period=last_30d&metrics=visits,bandwidth"</span> \\</span>
<span class="code-line">  <span class="c-key">-H</span> <span class="c-str">"Authorization: Bearer nf_live_xxxx"</span></span>`
  }
];

/* ─────────────────────────────────────
   7. API DASHBOARD — TABS
───────────────────────────────────── */
function switchTab(tabIndex, btn) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const panelReq  = document.getElementById('dash-panel-req');
  const panelRes  = document.getElementById('dash-panel-res');
  const panelCurl = document.getElementById('dash-panel-curl');

  if (tabIndex === 0) {
    panelReq.style.display  = '';
    panelRes.style.display  = '';
    panelCurl.style.display = 'none';
  } else if (tabIndex === 1) {
    panelReq.style.display  = 'none';
    panelRes.style.display  = '';
    panelCurl.style.display = 'none';
  } else {
    panelReq.style.display  = 'none';
    panelRes.style.display  = 'none';
    panelCurl.style.display = '';
  }
}

/* ─────────────────────────────────────
   8. API DASHBOARD — ENDPOINT SWITCHER
───────────────────────────────────── */
function switchApi(index, btn) {
  document.querySelectorAll('.api-sys-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const d = apiData[index];
  document.getElementById('dash-title').textContent    = d.title;
  document.getElementById('dash-code').innerHTML       = d.req;
  document.getElementById('dash-response').innerHTML   = d.res;
  document.getElementById('dash-curl').innerHTML       = d.curl;
  document.getElementById('m-latency').textContent     = d.latency;
  document.getElementById('m-rate').textContent        = d.rate;

  // Reset tabs to Request view
  const tabs = document.querySelectorAll('.dash-tab');
  tabs.forEach(t => t.classList.remove('active'));
  tabs[0].classList.add('active');
  switchTab(0, tabs[0]);
}

function initDashboard() {
  // Load first endpoint data immediately
  const d = apiData[0];
  const dashTitle = document.getElementById('dash-title');
  const dashCode = document.getElementById('dash-code');
  const dashResponse = document.getElementById('dash-response');
  const dashCurl = document.getElementById('dash-curl');
  const mLatency = document.getElementById('m-latency');
  const mRate = document.getElementById('m-rate');
  
  if (dashTitle) dashTitle.textContent = d.title;
  if (dashCode) dashCode.innerHTML = d.req;
  if (dashResponse) dashResponse.innerHTML = d.res;
  if (dashCurl) dashCurl.innerHTML = d.curl;
  if (mLatency) mLatency.textContent = d.latency;
  if (mRate) mRate.textContent = d.rate;
}

/* ─────────────────────────────────────
   INIT ALL
───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initReveal();
  initRotatingText();
  initCounters();
  initFaq();
  initPlanSelection();
  initDashboard();
});


/* ─────────────────────────────────────
   TESTIMONIALS CAROUSEL
───────────────────────────────────── */
function initCarousel() {
  const track  = document.getElementById('carouselTrack');
  const dotsWrap = document.getElementById('carouselDots');
  if (!track || !dotsWrap) return;

  const cards  = track.querySelectorAll('.rev-card');
  const total  = cards.length;
  let current  = 0;
  let autoTimer;

  /* Build dots */
  cards.forEach((_, i) => {
    const d = document.createElement('button');
    d.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    d.setAttribute('aria-label', 'Ir al testimonio ' + (i + 1));
    d.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(d);
  });

  function getOffset(index) {
    /* Center the active card on screen */
    const card    = cards[index];
    const wrap    = track.parentElement;
    const wrapW   = wrap.offsetWidth;
    const cardW   = card.offsetWidth;
    const cardLeft = card.offsetLeft;
    return cardLeft - (wrapW / 2 - cardW / 2);
  }

  function goTo(index) {
    current = (index + total) % total;
    track.style.transform = `translateX(-${getOffset(current)}px)`;
    dotsWrap.querySelectorAll('.carousel-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
  }

  function next() { goTo(current + 1); }

  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(next, 4000);
  }

  /* Pause on hover */
  track.parentElement.addEventListener('mouseenter', () => clearInterval(autoTimer));
  track.parentElement.addEventListener('mouseleave', startAuto);

  /* Touch swipe support */
  let touchStartX = 0;
  track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const dx = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) dx > 0 ? goTo(current + 1) : goTo(current - 1);
    startAuto();
  }, { passive: true });

  /* Init */
  goTo(0);
  startAuto();
}

document.addEventListener('DOMContentLoaded', initCarousel);

// Expose globals needed by inline HTML onclick attributes
window.selectPlan  = selectPlan;
window.switchTab   = switchTab;
window.switchApi   = switchApi;

