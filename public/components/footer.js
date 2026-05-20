/* ═══════════════════════════════════════
   components/footer.js — Footer Nubifly
   ═══════════════════════════════════════ */

function renderFooter() {
  const root = document.getElementById('footer-root');
  if (!root) return;

  root.innerHTML = `
    <footer class="site-footer">
      <div class="footer-shell">

        <!-- Top: logo + tagline -->
        <div class="footer-top">
          <a class="footer-logo" href="#">
            <span class="footer-logo-mark" style="background:#1e1e2a;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:8px">
              <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path fill="#ffffff" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5c0-2.64-2.05-4.78-4.65-4.96z"/>
              </svg>
            </span>
            <span class="footer-logo-text" style="color:#fff">Nubifly</span>
          </a>
          <p class="footer-tagline">La plataforma cloud más rápida<br>para creadores y empresas.</p>
        </div>

        <!-- Main: 3 columns -->
        <div class="footer-main">

          <!-- Col 1: Plataforma -->
          <div class="footer-col">
            <h4>Plataforma</h4>
            <a href="#features">Sitios Web</a>
            <a href="#features">Almacenamiento Cloud</a>
            <a href="#features">API de Acceso</a>
            <a href="#pricing">Planes y Precios</a>
            <a href="#steps">Cómo Funciona</a>
          </div>

          <!-- Col 2: Empresa -->
          <div class="footer-col">
            <h4>Empresa</h4>
            <a href="#">Sobre Nosotros</a>
            <a href="#">Blog</a>
            <a href="#">Carreras</a>
            <a href="#">Prensa</a>
            <a href="#faq">Preguntas Frecuentes</a>
          </div>

          <!-- Col 3: Redes + Badge -->
          <div class="footer-col footer-col-social">
            <h4>Síguenos</h4>
            <div class="footer-social">
              <a href="#" aria-label="YouTube">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5V8.5l6.25 3.5-6.25 3.5z"/>
                </svg>
              </a>
              <a href="#" aria-label="GitHub">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              </a>
              <a href="#" aria-label="LinkedIn">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
              <a href="#" aria-label="Instagram">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                </svg>
              </a>
            </div>
            <div class="footer-partner">
              <div class="partner-icon">
                <svg fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>
                  <path d="M8 11l3 3 5-5"/>
                </svg>
              </div>
              <div class="partner-text">
                <strong>Cloud Verified</strong>
                <span>Partner Certificado 2026</span>
              </div>
            </div>
          </div>

        </div><!-- /footer-main -->

        <!-- Bottom bar -->
        <div class="footer-bottom">
          <p class="footer-copy">&copy; 2026 Nubifly. Todos los derechos reservados.</p>
          <div class="footer-legal">
            <a href="#">Privacidad</a>
            <a href="#">Términos de Uso</a>
            <a href="#">Cookies</a>
          </div>
        </div>

      </div><!-- /footer-shell -->
    </footer>
  `;
}

document.addEventListener('DOMContentLoaded', renderFooter);
