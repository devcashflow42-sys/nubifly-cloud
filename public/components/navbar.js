/* ═══════════════════════════════════════
   components/navbar.js — Navbar Nubifly
   ═══════════════════════════════════════ */

function renderNavbar() {
  const nav = document.getElementById('navbar-root');
  if (!nav) return;

  nav.innerHTML = `
    <nav class="navbar">
      <div class="nav-inner">
        <div class="logo">
          <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;display:block">
            <path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5c0-2.64-2.05-4.78-4.65-4.96z"/>
          </svg>
          Nubifly
        </div>
        <div class="nav-links">
          <a href="#features">Servicios</a>
          <a href="#pricing">Planes</a>
          <a href="#faq">FAQ</a>
          <a href="#contact">Contacto</a>
          <button
            class="btn-nav btn-nav--primary"
            onclick="document.getElementById('pricing').scrollIntoView({behavior:'smooth'})">
            Comenzar Ahora
          </button>
        </div>
      </div>
    </nav>
  `;
}

// Auto-render on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  renderNavbar();

  // Transparent → frosted glass on scroll (estilo Telegram)
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
});
