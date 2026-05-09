/* ═══════════════════════════════════════
   components/navbar.js — Navbar Nubifly
   ═══════════════════════════════════════ */

function renderNavbar() {
  const nav = document.getElementById('navbar-root');
  if (!nav) return;

  nav.innerHTML = `
    <nav class="navbar">
      <div class="nav-inner">
        <div class="logo">Nubi<span>fly</span></div>
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
