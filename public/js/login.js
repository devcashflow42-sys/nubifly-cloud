/* ═══════════════════════════════════════════════════════════════
   login.js — Nubifly Auth
   Nuevo diseño UI  +  API real conectada
   ═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   TOAST
────────────────────────────────────────────── */
var toastEl    = document.getElementById('toast');
var toastIcon  = document.getElementById('toastIcon');
var toastText  = document.getElementById('toastText');
var toastTimer;

var TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8h.01M11 12h1v4h1"/></svg>'
};

function showToast(message, type) {
  type = type || 'info';
  toastIcon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
  toastText.textContent = message;
  toastEl.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.className = 'toast ' + type;
  }, 3600);
}

/* ──────────────────────────────────────────────
   ESTADO
────────────────────────────────────────────── */
var isSignUp = false;

// Datos del checkout pagado (llega desde /pago-completado con ?email=&plan=&session_id=)
var _paidCheckout = { sessionId: '', plan: '', email: '' };

/* ──────────────────────────────────────────────
   REFERENCIAS A ELEMENTOS
────────────────────────────────────────────── */
var form           = document.getElementById('form');
var title          = document.getElementById('title');
var subtitle       = document.getElementById('subtitle');
var btnText        = document.getElementById('btnText');
var switchLink     = document.getElementById('switchLink');
var switchPrefix   = document.getElementById('switchPrefix');
var panelTitle     = document.getElementById('panelTitle');
var panelSubtitle  = document.getElementById('panelSubtitle');

var userField      = document.getElementById('userField');
var confirmField   = document.getElementById('confirmField');
var countryField   = document.getElementById('countryField');
var termsField     = document.getElementById('termsField');

var usernameInput  = document.getElementById('username');
var emailInput     = document.getElementById('email');
var password       = document.getElementById('password');
var confirm        = document.getElementById('confirm');
var country        = document.getElementById('country');
var countryTrigger = document.getElementById('countryTrigger');
var countryValue   = document.getElementById('countryValue');
var termsCheck     = document.getElementById('termsCheck');
var reqs           = document.getElementById('reqs');
var reqsConfirm    = document.getElementById('reqsConfirm');
var matchMsg       = document.getElementById('matchMsg');

var creationBlocks = document.querySelectorAll('.creation-block');

/* ──────────────────────────────────────────────
   TOGGLE OJO — MOSTRAR / OCULTAR CONTRASEÑA
────────────────────────────────────────────── */
document.querySelectorAll('.toggle-eye').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var input  = document.getElementById(btn.dataset.target);
    var hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    btn.classList.toggle('show', hidden);
    btn.setAttribute('aria-label', hidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
});

/* ──────────────────────────────────────────────
   ALTERNAR MODO LOGIN / REGISTRO
────────────────────────────────────────────── */
function toggleMode() {
  isSignUp = !isSignUp;
  history.pushState(
    { mode: isSignUp ? 'register' : 'login' },
    '',
    isSignUp ? '/register' : '/login'
  );
  applyMode();
  resetFields();
}

function applyMode() {
  // Campos visibles / ocultos
  userField.classList.toggle('hidden',    !isSignUp);
  countryField.classList.toggle('hidden', !isSignUp);
  confirmField.classList.toggle('hidden', !isSignUp);
  termsField.classList.toggle('show',      isSignUp);

  if (!isSignUp) {
    // Al volver a login: limpiar campos de registro
    confirm.value = '';
    reqsConfirm.classList.remove('show');
    matchMsg.className = 'match-msg';
    matchMsg.innerHTML = '';
    confirm.classList.remove('error');
    termsCheck.checked = false;
    termsCheck.classList.remove('error');
    setCountry('');
    countryTrigger.classList.remove('error');
  } else {
    checkMatch();
  }

  // Textos
  if (isSignUp) {
    if (title)         title.textContent         = 'Crear cuenta';
    if (subtitle)      subtitle.textContent      = 'Regístrate para comenzar a disfrutar la experiencia.';
    if (btnText)       btnText.textContent        = 'Inscribirse';
    if (switchPrefix)  switchPrefix.textContent   = '¿Ya tienes una cuenta? ';
    if (switchLink)    switchLink.textContent      = 'Inicia sesión';
    if (panelTitle)    panelTitle.textContent      = 'Crea tu cuenta';
    if (panelSubtitle) panelSubtitle.textContent   = 'Regístrate para comenzar a disfrutar la experiencia.';
  } else {
    if (title)         title.textContent          = 'Iniciar sesión';
    if (subtitle)      subtitle.textContent       = 'Accede a tu cuenta y continúa donde lo dejaste.';
    if (btnText)       btnText.textContent         = 'Iniciar sesión';
    if (switchPrefix)  switchPrefix.textContent    = '¿No tienes una cuenta? ';
    if (switchLink)    switchLink.textContent       = 'Regístrate aquí';
    if (panelTitle)    panelTitle.textContent       = 'Bienvenido de nuevo';
    if (panelSubtitle) panelSubtitle.textContent    = 'Accede a tu cuenta y continúa donde lo dejaste.';
  }

  // autocomplete en contraseña
  password.setAttribute('autocomplete', isSignUp ? 'new-password' : 'current-password');

  // Ocultar reqs si el campo queda vacío
  reqs.classList.toggle('show', password.value.length > 0);
}

if (switchLink) switchLink.addEventListener('click', toggleMode);

/* ──────────────────────────────────────────────
   VALIDACIÓN DE CONTRASEÑA EN VIVO
────────────────────────────────────────────── */
var checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
var xSvg     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function rules(v) {
  return {
    len:     v.length >= 8,
    upper:   /[A-Z]/.test(v),
    number:  /[0-9]/.test(v),
    special: /[^A-Za-z0-9]/.test(v)
  };
}

function checkPassword() {
  var v = password.value;
  var r = rules(v);
  reqs.classList.toggle('show', v.length > 0);
  reqs.querySelectorAll('li').forEach(function (li) {
    li.classList.toggle('ok', r[li.dataset.rule]);
  });
  checkMatch();
}

function checkMatch() {
  var rc = rules(confirm.value);
  reqsConfirm.classList.toggle('show', confirm.value.length > 0);
  reqsConfirm.querySelectorAll('li').forEach(function (li) {
    li.classList.toggle('ok', rc[li.dataset.rule]);
  });

  if (confirm.value.length === 0) {
    matchMsg.className = 'match-msg';
    matchMsg.innerHTML = '';
    confirm.classList.remove('error');
    return;
  }
  if (confirm.value === password.value) {
    matchMsg.className = 'match-msg show ok';
    matchMsg.innerHTML = checkSvg + 'Las contraseñas coinciden';
    confirm.classList.remove('error');
  } else {
    matchMsg.className = 'match-msg show bad';
    matchMsg.innerHTML = xSvg + 'Las contraseñas no coinciden';
    confirm.classList.add('error');
  }
}

password.addEventListener('input', checkPassword);
confirm.addEventListener('input',  checkMatch);

/* ──────────────────────────────────────────────
   SELECCIÓN DE PAÍS — BOTTOMSHEET
────────────────────────────────────────────── */
var countries = [
  'Afganistán','Albania','Alemania','Andorra','Angola','Antigua y Barbuda',
  'Arabia Saudita','Argelia','Argentina','Armenia','Australia','Austria',
  'Azerbaiyán','Bahamas','Bangladés','Barbados','Baréin','Belice','Benín',
  'Bielorrusia','Birmania (Myanmar)','Bolivia','Bosnia y Herzegovina',
  'Botsuana','Brasil','Brunéi','Bulgaria','Burkina Faso','Burundi','Bután',
  'Bélgica','Cabo Verde','Camboya','Camerún','Canadá','Catar','Chad','Chile',
  'China','Chipre','Colombia','Comoras','Corea del Norte','Corea del Sur',
  'Costa de Marfil','Costa Rica','Croacia','Cuba','Dinamarca','Dominica',
  'Ecuador','Egipto','El Salvador','Emiratos Árabes Unidos','Eritrea',
  'Eslovaquia','Eslovenia','España','Estados Unidos','Estonia','Esuatini',
  'Etiopía','Filipinas','Finlandia','Fiyi','Francia','Gabón','Gambia',
  'Georgia','Ghana','Granada','Grecia','Guatemala','Guinea',
  'Guinea Ecuatorial','Guinea-Bisáu','Guyana','Haití','Honduras','Hungría',
  'India','Indonesia','Irak','Irlanda','Irán','Islandia','Islas Marshall',
  'Islas Salomón','Israel','Italia','Jamaica','Japón','Jordania',
  'Kazajistán','Kenia','Kirguistán','Kiribati','Kuwait','Laos','Lesoto',
  'Letonia','Liberia','Libia','Liechtenstein','Lituania','Luxemburgo',
  'Líbano','Macedonia del Norte','Madagascar','Malasia','Malaui','Maldivas',
  'Malta','Malí','Marruecos','Mauricio','Mauritania','Micronesia','Moldavia',
  'Mongolia','Montenegro','Mozambique','México','Mónaco','Namibia','Nauru',
  'Nepal','Nicaragua','Nigeria','Noruega','Nueva Zelanda','Níger','Omán',
  'Pakistán','Palaos','Palestina','Panamá','Papúa Nueva Guinea','Paraguay',
  'Países Bajos','Perú','Polonia','Portugal','Puerto Rico','Reino Unido',
  'República Centroafricana','República Checa','República del Congo',
  'República Democrática del Congo','República Dominicana','Ruanda',
  'Rumanía','Rusia','Samoa','San Cristóbal y Nieves','San Marino',
  'San Vicente y las Granadinas','Santa Lucía','Santo Tomé y Príncipe',
  'Senegal','Serbia','Seychelles','Sierra Leona','Singapur','Siria',
  'Somalia','Sri Lanka','Sudáfrica','Sudán','Sudán del Sur','Suecia',
  'Suiza','Surinam','Tailandia','Tanzania','Tayikistán','Timor Oriental',
  'Togo','Tonga','Trinidad y Tobago','Turkmenistán','Turquía','Tuvalu',
  'Túnez','Ucrania','Uganda','Uruguay','Uzbekistán','Vanuatu','Vaticano',
  'Venezuela','Vietnam','Yemen','Yibuti','Zambia','Zimbabue','Otro'
];

var countrySheet  = document.getElementById('countrySheet');
var sheetClose    = document.getElementById('sheetClose');
var countryList   = document.getElementById('countryList');
var countrySearch = document.getElementById('countrySearch');
var countryEmpty  = document.getElementById('countryEmpty');

var CHECK_MARK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function setCountry(value) {
  country.value = value || '';
  if (value) {
    countryValue.textContent = value;
    countryValue.classList.remove('placeholder');
    countryTrigger.classList.remove('error');
  } else {
    countryValue.textContent = 'Selecciona tu país';
    countryValue.classList.add('placeholder');
  }
}

function buildCountryList(filter) {
  filter = (filter || '').toLowerCase().trim();
  countryList.innerHTML = '';
  var shown = 0;
  countries.forEach(function (name) {
    if (filter && name.toLowerCase().indexOf(filter) === -1) return;
    shown++;
    var li = document.createElement('li');
    if (country.value === name) li.className = 'selected';
    li.innerHTML = '<span>' + name + '</span>' + CHECK_MARK;
    li.addEventListener('click', function () {
      setCountry(name);
      closeCountrySheet();
    });
    countryList.appendChild(li);
  });
  countryEmpty.hidden = shown !== 0;
}

function openCountrySheet() {
  buildCountryList('');
  countrySearch.value = '';
  countrySheet.classList.add('show');
  countrySheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
  setTimeout(function () { countrySearch.focus(); }, 350);
}

function closeCountrySheet() {
  countrySheet.classList.remove('show');
  countrySheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
}

countryTrigger.addEventListener('click', openCountrySheet);
sheetClose.addEventListener('click', closeCountrySheet);
countrySheet.addEventListener('click', function (e) {
  if (e.target === countrySheet) closeCountrySheet();
});
countrySearch.addEventListener('input', function () {
  buildCountryList(countrySearch.value);
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && countrySheet.classList.contains('show')) closeCountrySheet();
});

/* ──────────────────────────────────────────────
   ANIMACIÓN DE CREACIÓN DE CUENTA
────────────────────────────────────────────── */
function setCreationStep(idx) {
  creationBlocks.forEach(function (block) {
    var steps = block.querySelectorAll('.creation-steps li');
    var fill  = block.querySelector('.creation-fill');
    var pctEl = block.querySelector('.creation-pct');
    steps.forEach(function (li, n) {
      li.classList.remove('active', 'done');
      if (n < idx)      li.classList.add('done');
      else if (n === idx) li.classList.add('active');
    });
    var pct = Math.round((idx / (steps.length - 1)) * 100);
    fill.style.width      = pct + '%';
    pctEl.textContent     = pct + '%';
  });
}

function finishCreation() {
  creationBlocks.forEach(function (block) {
    var steps = block.querySelectorAll('.creation-steps li');
    steps.forEach(function (li) { li.classList.remove('active'); li.classList.add('done'); });
    block.querySelector('.creation-fill').style.width = '100%';
    block.querySelector('.creation-pct').textContent  = '100%';
    block.classList.add('done');
  });
}

function showCreation() {
  creationBlocks.forEach(function (b) {
    b.classList.remove('done');
    b.classList.add('show');
    b.setAttribute('aria-hidden', 'false');
  });
}

function hideCreation() {
  creationBlocks.forEach(function (b) {
    b.classList.remove('show', 'done');
    b.setAttribute('aria-hidden', 'true');
  });
}

function lockForm(locked) {
  form.querySelectorAll('input, select, button').forEach(function (el) {
    el.disabled = locked;
  });
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* ──────────────────────────────────────────────
   RESET DE CAMPOS
────────────────────────────────────────────── */
function resetFields() {
  usernameInput.value = '';
  emailInput.value    = '';
  password.value      = '';
  confirm.value       = '';

  usernameInput.classList.remove('error');
  emailInput.classList.remove('error');
  password.classList.remove('error');
  confirm.classList.remove('error');

  reqs.classList.remove('show');
  reqsConfirm.classList.remove('show');
  matchMsg.className = 'match-msg';
  matchMsg.innerHTML = '';

  setCountry('');
  termsCheck.checked = false;
  termsCheck.classList.remove('error');

  // Restaurar ojos
  document.querySelectorAll('.toggle-eye').forEach(function (btn) {
    var inp = document.getElementById(btn.dataset.target);
    if (inp) inp.type = 'password';
    btn.classList.remove('show');
  });
}

/* ──────────────────────────────────────────────
   SUBMIT PRINCIPAL
────────────────────────────────────────────── */
form.addEventListener('submit', async function (e) {
  e.preventDefault();

  var submitBtn = form.querySelector('.btn[type="submit"]');
  if (submitBtn.disabled) return;

  /* ── REGISTRO ── */
  if (isSignUp) {
    var r = rules(password.value);
    if (!r.len || !r.upper || !r.number || !r.special) {
      checkPassword();
      showToast('La contraseña no cumple los requisitos.', 'error');
      return;
    }
    if (password.value !== confirm.value) {
      checkMatch();
      showToast('Las contraseñas no coinciden.', 'error');
      return;
    }
    if (!country.value) {
      countryTrigger.classList.add('error');
      showToast('Selecciona tu país para continuar.', 'error');
      return;
    }
    if (!termsCheck.checked) {
      termsCheck.classList.add('error');
      showToast('Debes aceptar los términos para continuar.', 'error');
      return;
    }

    var name       = usernameInput.value.trim();
    var emailVal   = emailInput.value.trim();
    var pwVal      = password.value;
    var countryVal = country.value;

    // Bloquear formulario + mostrar progreso
    lockForm(true);
    showCreation();
    setCreationStep(0); // Procesando

    try {
      await delay(600);
      setCreationStep(1); // Creando tu cuenta — aquí llama a la API

      await NubiflyAPI.registerUser({
        name:     name,
        username: name,
        email:    emailVal,
        password: pwVal,
        checkoutSessionId: _paidCheckout.sessionId || ''
      });

      // Animación de éxito
      setCreationStep(2); await delay(450); // Analizando
      setCreationStep(3); await delay(450); // Finalizando
      finishCreation();                     // Éxito ✓

      showToast('¡Cuenta creada con éxito!', 'success');
      await delay(1100);

      sessionStorage.removeItem('_nf_home_redir');
      window.location.replace(resolvePostLoginTarget());

    } catch (err) {
      hideCreation();
      lockForm(false);
      showToast(err.message || 'Error al crear la cuenta. Inténtalo de nuevo.', 'error');
    }

  /* ── LOGIN ── */
  } else {
    var origText = btnText.textContent;
    btnText.textContent = 'Iniciando…';
    submitBtn.disabled  = true;

    try {
      await NubiflyAPI.loginUser({
        email:    emailInput.value.trim(),
        password: password.value
      });

      sessionStorage.removeItem('_nf_home_redir');
      window.location.replace(resolvePostLoginTarget());

    } catch (err) {
      btnText.textContent = origText;
      submitBtn.disabled  = false;
      showToast(err.message || 'Error al iniciar sesión. Inténtalo de nuevo.', 'error');
    }
  }
});

/* ──────────────────────────────────────────────
   POST-LOGIN REDIRECT
   Si vino con ?next=/#precios (checkout pendiente) → volver ahí.
   Si no → /home
────────────────────────────────────────────── */
function resolvePostLoginTarget() {
  try {
    var q = new URLSearchParams(window.location.search);
    var next = q.get('next');
    if (next && next.startsWith('/')) return next;
  } catch { /* ignore */ }
  return '/home';
}

/* ──────────────────────────────────────────────
   GOOGLE OAUTH
────────────────────────────────────────────── */
document.getElementById('btnGoogle').addEventListener('click', function () {
  showToast('Conectando con Google…', 'info');
  window.location.href = '/api/auth/google';
});

/* ──────────────────────────────────────────────
   GITHUB OAUTH
────────────────────────────────────────────── */
document.getElementById('btnGitHub').addEventListener('click', function () {
  showToast('Conectando con GitHub…', 'info');
  window.location.href = '/api/auth/github';
});

/* ──────────────────────────────────────────────
   CONTINUAR COMO INVITADO
────────────────────────────────────────────── */
document.getElementById('guestBtn').addEventListener('click', async function () {
  var btn = this;
  if (btn.disabled) return;

  btn.disabled    = true;
  var origHTML    = btn.innerHTML;
  btn.innerHTML   =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;animation:spin .7s linear infinite" width="18" height="18"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
    'Creando sesión…';

  try {
    var res  = await fetch('/api/auth/guest', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    var data = {};
    try { data = await res.json(); } catch { /* ignore */ }

    if (!res.ok || !data.success || !data.token) {
      var msg = data?.message ||
        (res.status === 429 ? 'Demasiados intentos. Espera un momento.'
          : res.status === 503 ? 'Servicio no disponible. Inténtalo de nuevo.'
          : 'No se pudo crear la sesión de invitado.');
      throw new Error(msg);
    }

    // Guardar sesión
    try {
      localStorage.setItem('nf_token', data.token);
      localStorage.setItem('nf_uid',   data.guestId || '');
      localStorage.setItem('nf_user',  JSON.stringify(data.user || {}));
      localStorage.removeItem('nf_refresh_token');
    } catch { /* localStorage bloqueado en modo privado */ }

    sessionStorage.removeItem('_nf_home_redir');
    window.location.replace(resolvePostLoginTarget());

  } catch (err) {
    btn.disabled  = false;
    btn.innerHTML = origHTML;
    showToast(err.message, 'error');
  }
});

/* ──────────────────────────────────────────────
   BOTÓN ATRÁS
────────────────────────────────────────────── */
document.getElementById('backBtn').addEventListener('click', function () {
  window.location.href = '/';
});

/* ──────────────────────────────────────────────
   INICIALIZACIÓN
────────────────────────────────────────────── */

// Si ya hay sesión activa y el token NO está expirado → ir directo a /home
(function () {
  var tok = typeof NubiflyAPI !== 'undefined'
    ? NubiflyAPI.getToken()
    : localStorage.getItem('nf_token');
  if (!tok) return;
  try {
    var parts   = tok.split('.');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      // Token expirado — limpiar y dejar al usuario en login
      localStorage.removeItem('nf_token');
      localStorage.removeItem('nf_user');
      localStorage.removeItem('nf_uid');
      localStorage.removeItem('nf_refresh_token');
      return;
    }
  } catch { return; } // token malformado → no redirigir
  sessionStorage.removeItem('_nf_home_redir');
  window.location.replace('/home');
}());

// Errores de OAuth pasados como ?error= en la URL
(function () {
  var p = new URLSearchParams(window.location.search);
  var err = p.get('error');
  if (!err) return;

  history.replaceState({}, '', window.location.pathname);

  var msgs = {
    google_cancelled:      'Inicio con Google cancelado.',
    google_not_configured: 'Google Login no está configurado aún.',
    google_no_email:       'No se pudo obtener el correo de Google.',
    github_cancelled:      'Inicio con GitHub cancelado.',
    github_not_configured: 'GitHub Login no está configurado aún.',
    github_no_email:       'No se pudo obtener el correo de GitHub. Asegúrate de tener un email público.',
    github_token_exchange: 'Error al conectar con GitHub. Inténtalo de nuevo.',
    github_no_token:       'GitHub no devolvió un token válido.',
    github_userinfo:       'No se pudo obtener tu perfil de GitHub.',
    account_banned:        'Tu cuenta ha sido suspendida permanentemente.',
    account_suspended:     'Tu cuenta está suspendida temporalmente.',
    account_inactive:      'Tu cuenta no está activa. Contacta a soporte.',
    token_error:           'Error al generar la sesión. Inténtalo de nuevo.',
    db_error:              'Error de base de datos. Inténtalo de nuevo.',
    db_write_error:        'Error al registrar tu cuenta. Inténtalo de nuevo.'
  };

  setTimeout(function () {
    showToast(msgs[err] || 'Error al iniciar sesión.', 'error');
  }, 400);
})();

// ── Checkout pagado: pre-rellenar registro con el email del pago ──────────
// /pago-completado envía a /register?email=…&plan=…&session_id=…
(function () {
  var q = new URLSearchParams(window.location.search);
  var email  = (q.get('email') || '').trim();
  var plan   = (q.get('plan') || '').trim();
  var sess   = (q.get('session_id') || q.get('checkout_session') || '').trim();
  if (!email && !sess) return;

  _paidCheckout = { sessionId: sess, plan: plan, email: email };

  // Forzar modo registro solo si viene un pago nuevo (plan o session).
  // Si solo llega el email (cuenta ya existente) → dejar modo login.
  if (sess || plan) isSignUp = true;

  if (email && emailInput) {
    emailInput.value = email;
    emailInput.setAttribute('readonly', 'readonly');
    emailInput.classList.add('locked');
  }

  // Nota visible: este correo tiene un plan pagado
  var host = emailInput ? emailInput.closest('.field') || emailInput.parentElement : null;
  if (host && plan) {
    var pretty = { basico: 'Básico', pro: 'Pro', enterprise: 'Enterprise' };
    var note = document.createElement('div');
    note.className = 'paid-note';
    note.style.cssText = 'margin-top:8px;font-size:12.5px;color:#16A34A;font-weight:600;display:flex;align-items:center;gap:6px';
    note.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      + 'Plan ' + (pretty[plan] || plan) + ' pagado — se activará al crear tu cuenta con este correo.';
    host.appendChild(note);
  }
}());

// Detectar modo /register en la URL
if (window.location.pathname.startsWith('/register')) {
  isSignUp = true;
}

// Sincronizar historial del navegador con modo actual
history.replaceState(
  { mode: isSignUp ? 'register' : 'login' },
  '',
  window.location.pathname
);

// Botón atrás/adelante del navegador
window.addEventListener('popstate', function (e) {
  isSignUp = (
    e.state?.mode === 'register' ||
    window.location.pathname.startsWith('/register')
  );
  applyMode();
  resetFields();
});

// Aplicar modo inicial
applyMode();
