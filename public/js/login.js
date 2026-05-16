/* ═══════════════════════════════════════
   login.js — Lógica Auth Nubifly
   ═══════════════════════════════════════ */

/* ─── Estado ────────────────────────── */
let mode = 'login';

const COPY = {
  login: {
    title: 'Iniciar sesión',
    sub:   'Bienvenido de vuelta. Accede a tu cuenta.',
    btn:   'Iniciar sesión',
    pre:   '¿No tienes una cuenta?',
    link:  'Crear cuenta',
    forgot: true,
    heroTitle: 'Bienvenido de vuelta',
    heroDesc: 'Accede a tu cuenta y continúa gestionando tus proyectos cloud con herramientas profesionales diseñadas para crecer contigo.'
  },
  register: {
    title: 'Crear cuenta',
    sub:   'Únete a Nubifly y empieza tu experiencia.',
    btn:   'Crear cuenta',
    pre:   '¿Ya tienes una cuenta?',
    link:  'Iniciar sesión',
    forgot: false,
    heroTitle: 'Únete a Nubifly',
    heroDesc: 'Crea tu cuenta en segundos y accede a una plataforma cloud completa con APIs seguras, almacenamiento ilimitado y herramientas listas para escalar tus proyectos.'
  }
};

/* ─── Helpers de DOM ────────────────── */

/** Obtiene un elemento por ID de forma segura */
function el(id) { return document.getElementById(id); }

/* ─── Modo login / registro ─────────── */

function toggleMode() {
  mode = mode === 'login' ? 'register' : 'login';
  history.pushState({ mode }, '', mode === 'register' ? '/register' : '/login');
  applyMode();
  resetForm();
}

function applyMode() {
  const c = COPY[mode];
  const isReg = mode === 'register';

  el('authTitle').textContent = c.title;
  el('authSub').textContent   = c.sub;
  el('btnTxt').textContent    = c.btn;
  el('switchPre').textContent = c.pre;
  el('switchLink').textContent = c.link;
  
  // Actualizar panel hero (solo desktop)
  const heroTitle = el('heroTitle');
  const heroDesc = el('heroDesc');
  if (heroTitle) heroTitle.textContent = c.heroTitle;
  if (heroDesc) heroDesc.textContent = c.heroDesc;

  el('wrapUser').classList.toggle('hidden',   !isReg);
  el('wrapPw2').classList.toggle('hidden',    !isReg);
  el('wrapRegion').classList.toggle('hidden', !isReg);
  el('wrapTerms').classList.toggle('hidden',  !isReg);
  el('wrapPw').classList.toggle('show-forgot', !isReg);
  el('fPw').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
  el('pwStrength').classList.remove('visible');

  checkReady();
}

/* ─── Toggle visibilidad contraseña ─── */

function togglePw(id, btn) {
  const input = el(id);
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  btn.querySelector('.eye-open').style.display = isText ? ''     : 'none';
  btn.querySelector('.eye-off').style.display  = isText ? 'none' : '';
}

/* ─── Estado visual de campo ─────────── */

function setState(inp, state, hintId, msg) {
  inp.classList.remove('valid', 'error');
  const iconOk  = inp.parentElement.querySelector('.icon-ok');
  const iconErr = inp.parentElement.querySelector('.icon-err');
  if (iconOk)  iconOk.style.display  = 'none';
  if (iconErr) iconErr.style.display = 'none';

  if (state === 'valid') {
    inp.classList.add('valid');
    if (iconOk) iconOk.style.display = '';
  } else if (state === 'error') {
    inp.classList.add('error');
    if (iconErr) iconErr.style.display = '';
  }

  if (hintId) {
    const h = el(hintId);
    h.textContent = msg || '';
    h.className = 'field-hint' + (state === 'error' ? ' err' : state === 'valid' ? ' ok' : '');
  }
}

/* ─── Progreso del email ─────────────── */

function emailProg(v) {
  const prog = el('emailProg');
  const bar  = el('emailBar');

  if (!v) {
    prog.classList.remove('visible');
    bar.style.width = '0';
    return;
  }

  prog.classList.add('visible');

  let pct = 10;
  if (v.includes('@'))             pct = 40;
  if (v.split('@')[1]?.length > 0) pct = 65;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) pct = 100;

  bar.style.width      = pct + '%';
  bar.style.background = pct < 40  ? '#9198a1'
                       : pct < 100 ? '#57606a'
                       : '#1a7f37';
}

/* ─── Fortaleza de contraseña ────────── */

function pwScore(pw) {
  let s = 0;
  if (pw.length >= 8)           s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw))  s++;
  return s;
}

function updateStrength(pw) {
  const colors = ['#d1242f', '#9a6700', '#57606a', '#1a7f37'];
  const labels = ['Muy débil', 'Débil', 'Buena', 'Fuerte'];
  const score  = pwScore(pw);

  ['pb1','pb2','pb3','pb4'].forEach((id, i) => {
    el(id).style.background = i < score ? colors[score - 1] : '#e8eaed';
  });

  const lbl = el('pwLbl');
  lbl.textContent = (pw && score) ? labels[score - 1] : '';
  if (pw && score) lbl.style.color = colors[score - 1];

  el('pwStrength').classList.toggle('visible', mode === 'register' && pw.length > 0);
}

/* ─── Validación y habilitación ──────── */

function checkReady() {
  const email = el('fEmail').value;
  const pw    = el('fPw').value;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

  let ok = validEmail && pw.length >= 6;

  if (mode === 'register') {
    const user   = el('fUser').value.trim();
    const pw2    = el('fPw2').value;
    const region = el('fRegion').value;
    const terms  = el('fTerms').checked;
    ok = ok && user.length >= 3 && pw.length >= 8 && pwScore(pw) >= 2 && pw2 === pw && region !== '' && terms;
  }

  el('btnSubmit').disabled = !ok;
}

/* ─── Reset del formulario ───────────── */

function resetForm() {
  ['fUser', 'fEmail', 'fPw', 'fPw2'].forEach(id => {
    const input = el(id);
    input.value = '';
    input.classList.remove('valid', 'error');

    const iconOk  = input.parentElement.querySelector('.icon-ok');
    const iconErr = input.parentElement.querySelector('.icon-err');
    if (iconOk)  iconOk.style.display  = 'none';
    if (iconErr) iconErr.style.display = 'none';

    if (id.startsWith('fPw')) {
      input.type = 'password';
      const toggleBtn = input.parentElement.querySelector('.pw-toggle');
      if (toggleBtn) {
        toggleBtn.querySelector('.eye-open').style.display = '';
        toggleBtn.querySelector('.eye-off').style.display  = 'none';
      }
    }
  });

  ['hintUser','hintEmail','hintPw','hintPw2'].forEach(id => {
    const h = el(id);
    h.textContent = '';
    h.className   = 'field-hint';
  });

  el('emailProg').classList.remove('visible');
  el('emailBar').style.width = '0';
  el('pwStrength').classList.remove('visible');

  // Reset región y términos
  el('fRegion').value = '';
  el('fTerms').checked = false;
  el('hintRegion').textContent = '';
  el('hintTerms').textContent  = '';

  checkReady();
}

/* ─── Listeners de validación ────────── */

el('fUser').addEventListener('input', function () {
  const v = this.value.trim();
  if (!v)               setState(this, '',       'hintUser', '');
  else if (v.length < 3) setState(this, 'error', 'hintUser', 'Mínimo 3 caracteres');
  else if (/\s/.test(this.value)) setState(this, 'error', 'hintUser', 'Sin espacios permitidos');
  else                  setState(this, 'valid',  'hintUser', '');
  checkReady();
});

el('fEmail').addEventListener('input', function () {
  const v = this.value;
  emailProg(v);
  if (!v)                                          setState(this, '',       'hintEmail', '');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) setState(this, 'error', 'hintEmail', 'Introduce un correo válido');
  else                                             setState(this, 'valid',  'hintEmail', '');
  checkReady();
});

el('fPw').addEventListener('input', function () {
  const v = this.value;
  updateStrength(v);

  if (mode === 'login') {
    if (!v)           setState(this, '',       'hintPw', '');
    else if (v.length < 6) setState(this, 'error', 'hintPw', 'Mínimo 6 caracteres');
    else              setState(this, 'valid',  'hintPw', '');
  } else {
    if (!v)           setState(this, '',       'hintPw', '');
    else if (v.length < 8)   setState(this, 'error', 'hintPw', 'Mínimo 8 caracteres');
    else if (pwScore(v) < 2) setState(this, 'error', 'hintPw', 'Añade mayúsculas o números');
    else              setState(this, 'valid',  'hintPw', '');

    // Re-validar confirmación si ya tiene valor
    const pw2 = el('fPw2');
    if (pw2.value) pw2.dispatchEvent(new Event('input'));
  }

  checkReady();
});

el('fPw2').addEventListener('input', function () {
  const v  = this.value;
  const pw = el('fPw').value;
  if (!v)       setState(this, '',       'hintPw2', '');
  else if (v !== pw) setState(this, 'error', 'hintPw2', 'Las contraseñas no coinciden');
  else          setState(this, 'valid',  'hintPw2', '✓ Coinciden');
  checkReady();
});

el('fRegion').addEventListener('change', function () {
  checkReady();
});

el('fTerms').addEventListener('change', function () {
  el('hintTerms').textContent = this.checked ? '' : 'Debes aceptar los términos para continuar';
  checkReady();
});

/* ─── Continuar como invitado ─────────── */

async function handleGuestLogin() {
  const btn = el('btnGuest');
  if (!btn || btn.classList.contains('loading')) return;

  btn.classList.add('loading');
  btn.textContent = 'Creando sesión…';

  try {
    const res = await fetch('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success || !data.token) {
      throw new Error(data.message || 'No se pudo crear la sesión de invitado.');
    }

    // Guardar sesión de invitado usando el mismo sistema de sesión
    NubiflyAPI.setSession(data.token, data.user, data.guestId, null);

    sessionStorage.removeItem('_nf_home_redir');
    window.location.replace('/home');
  } catch (err) {
    btn.classList.remove('loading');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> Continuar como invitado`;

    const hint = el('hintEmail');
    if (hint) {
      hint.textContent = err.message || 'Error de conexión. Inténtalo de nuevo.';
      hint.className   = 'field-hint err';
    }
  }
}

/* ─── Submit ─────────────────────────── */

/* ─── Submit — conectado al backend ─────────────────────────────────────── */

el('authForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const btn = el('btnSubmit');
  if (btn.disabled) return;

  el('btnTxt').style.opacity     = '0';
  el('btnSpinner').style.display = 'block';
  btn.disabled = true;

  const email    = el('fEmail').value.trim();
  const password = el('fPw').value;

  try {
    if (mode === 'login') {
      await NubiflyAPI.loginUser({ email, password });
    } else {
      const name     = el('fUser').value.trim();
      const username = el('fUser').value.trim(); // same field in this UI
      await NubiflyAPI.registerUser({ name, username, email, password });
    }
    // Redirect to home on success — clear loop guard so /home auth check works normally
    sessionStorage.removeItem('_nf_home_redir');
    window.location.replace('/home');
  } catch (err) {
    el('btnTxt').style.opacity     = '1';
    el('btnSpinner').style.display = 'none';
    btn.disabled = false;

    // Show error in a visible hint
    const errMsg = err.message || 'Error de conexión. Inténtalo de nuevo.';
    const hint   = el('hintEmail');
    hint.textContent = errMsg;
    hint.className   = 'field-hint err';
    el('fEmail').classList.add('error');
  }
});

/* ─── Init ───────────────────────────────────────────────────────────────── */

// If already logged in, go straight to home.
// Break any redirect loop: if we've bounced here from /home more than twice,
// something is wrong with the stored token — force a clean re-login instead.
if (NubiflyAPI.getToken()) {
  sessionStorage.removeItem('_nf_home_redir');
  window.location.replace('/home');
}

// Show Google OAuth errors returned as ?error= in URL
(function () {
  const p = new URLSearchParams(window.location.search);
  const err = p.get('error');
  if (err) {
    history.replaceState({}, '', window.location.pathname);
    const msgs = {
      google_cancelled:       'Inicio con Google cancelado.',
      google_not_configured:  'Google Login no está configurado aún.',
      google_no_email:        'No se pudo obtener el correo de Google.',
      github_cancelled:       'Inicio con GitHub cancelado.',
      github_not_configured:  'GitHub Login no está configurado aún.',
      github_no_email:        'No se pudo obtener el correo de GitHub. Asegúrate de tener un email público en tu cuenta.',
      github_token_exchange:  'Error al conectar con GitHub. Inténtalo de nuevo.',
      github_no_token:        'GitHub no devolvió un token válido.',
      github_userinfo:        'No se pudo obtener tu perfil de GitHub. Inténtalo de nuevo.',
      account_banned:         'Tu cuenta ha sido suspendida permanentemente.',
      account_suspended:      'Tu cuenta está suspendida temporalmente.',
      account_inactive:       'Tu cuenta no está activa. Contacta a soporte.',
      token_error:            'Error al generar la sesión. Inténtalo de nuevo.',
      db_error:               'Error de base de datos. Inténtalo de nuevo.',
      db_write_error:         'Error al registrar tu cuenta. Inténtalo de nuevo.'
    };
    const hint = el('hintEmail');
    if (hint) {
      hint.textContent = msgs[err] || 'Error al iniciar sesión con Google.';
      hint.className = 'field-hint err';
    }
  }
})();

// Browser back/forward button — sync form mode with URL
window.addEventListener('popstate', (e) => {
  mode = (e.state?.mode === 'register' || window.location.pathname.startsWith('/register'))
    ? 'register'
    : 'login';
  applyMode();
  resetForm();
});

if (window.location.pathname.startsWith('/register')) {
  mode = 'register';
}
// Seed the initial history entry so popstate fires correctly on first back
history.replaceState({ mode }, '', window.location.pathname);
applyMode();
