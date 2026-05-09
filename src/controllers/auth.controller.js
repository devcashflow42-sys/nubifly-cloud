const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/firebase');
const auth   = require('../config/firebase').auth;

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de validación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza el email: minúsculas + trim.
 * Para usarlo como clave en Firebase reemplaza "." por "," ya que
 * Firebase no permite puntos en las claves de nodo.
 */
const toEmailKey    = (email)    => email.trim().toLowerCase().replace(/\./g, ',');
const toEmailNormal = (email)    => email.trim().toLowerCase();
const toUsernameKey = (username) => username.trim().toLowerCase();

const isValidEmail    = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isValidUsername = (v) => /^[a-zA-Z0-9_]{3,20}$/.test(v);
const isValidName     = (v) => v.trim().length >= 2 && v.trim().length <= 50;
const isValidPassword = (v) => v.length >= 6;

const firebaseAuthMessage = (err) => {
  const code = err && err.code;
  if (code === 'auth/email-already-exists') return { status: 409, message: 'Este email ya está registrado.' };
  if (code === 'auth/invalid-email') return { status: 400, message: 'El email no es válido para Firebase Auth.' };
  if (code === 'auth/invalid-password') return { status: 400, message: 'La contraseña no cumple los requisitos de Firebase Auth.' };
  if (code === 'app/invalid-credential' || code === 'auth/invalid-credential') return { status: 503, message: 'Firebase no está configurado correctamente: revisa FIREBASE_SERVICE_ACCOUNT.' };
  if (String(err && err.message || '').includes('Credential')) return { status: 503, message: 'Firebase no está configurado correctamente: revisa las credenciales del service account.' };
  return null;
};


// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/register
// ─────────────────────────────────────────────────────────────────────────────

exports.register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      avatar = '',
      bio    = ''
    } = req.body;

    // name es opcional — si no llega se usa el username como nombre por defecto
    const name = (req.body.name || username || '').trim();

    // ── 1. Campos requeridos ──────────────────────────────────────────────────
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Campos requeridos: username, email, password.'
      });
    }

    // ── 2. Validaciones de formato ────────────────────────────────────────────
    if (!isValidName(name)) {
      return res.status(400).json({
        success: false,
        message: 'El nombre debe tener entre 2 y 50 caracteres.'
      });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({
        success: false,
        message: 'El username solo puede contener letras, números y guion bajo (3–20 caracteres).'
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'El formato del email no es válido.'
      });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres.'
      });
    }

    const emailKey      = toEmailKey(email);
    const emailNormal   = toEmailNormal(email);
    const usernameKey   = toUsernameKey(username);

    // ── 3. Verificar email duplicado ──────────────────────────────────────────
    const emailSnap = await db.ref(`emails/${emailKey}`).once('value');
    if (emailSnap.exists()) {
      return res.status(409).json({
        success: false,
        message: 'Este email ya está registrado.'
      });
    }

    // ── 4. Verificar username duplicado ───────────────────────────────────────
    const usernameSnap = await db.ref(`usernames/${usernameKey}`).once('value');
    if (usernameSnap.exists()) {
      return res.status(409).json({
        success: false,
        message: 'Este username ya está en uso.'
      });
    }

    // ── 5. Hashear contraseña con bcrypt (salt=12) ────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    // ── 6. Crear usuario en Firebase Authentication ───────────────────────────
    let firebaseAuthUser;
    try {
      firebaseAuthUser = await auth.createUser({
        email:       emailNormal,
        password,
        displayName: name.trim()
      });
    } catch (authErr) {
      const mappedAuthError = firebaseAuthMessage(authErr);
      if (mappedAuthError) {
        return res.status(mappedAuthError.status).json({
          success: false,
          message: mappedAuthError.message,
          error: authErr.code || authErr.message
        });
      }
      throw authErr;
    }

    const uid = firebaseAuthUser.uid;
    const now = Date.now();

    // ── 7. Construir objeto users/{uid} ───────────────────────────────────────
    const userData = {
      name:      name.trim(),
      username:  usernameKey,
      email:     emailNormal,
      avatar,
      bio,
      isOnline:  true,
      lastSeen:  now,
      createdAt: now,
      updatedAt: now
    };

    // ── 8. Construir objeto controlUsers/{uid} ────────────────────────────────
    const controlUserData = {
      uid,

      // Estado general de la cuenta
      accountStatus: 'active', // active | suspended | banned

      // Sistema de suspensión temporal
      suspension: {
        isSuspended: false,
        reason:      '',
        until:       0,       // timestamp ms — 0 = indefinido
        createdAt:   0
      },

      // Sistema de ban permanente
      ban: {
        isBanned:  false,
        reason:    '',
        createdAt: 0
      },

      // Plan de suscripción
      plan: {
        type:         'normal', // normal | premium | vip
        isPremium:    false,
        premiumUntil: 0,        // timestamp ms
        startedAt:    now
      },

      // Permisos granulares
      permissions: {
        canLogin:           true,
        canChat:            true,
        canUploadAvatar:    true,
        canChangeUsername:  true,
        canCreateGroups:    false, // solo premium
        canSendMedia:       true,
        canSendVoice:       true,
        canSendStickers:    true,
        canSendLinks:       true
      },

      // Límites según plan
      limits: {
        maxGroups:        5,
        maxContacts:      200,
        maxMediaSizeMB:   10,
        maxMessageLength: 500,
        dailyMessages:    500
      },

      // Seguridad: contraseña y sesiones
      security: {
        passwordHash,         // bcrypt hash — NUNCA se expone al cliente
        loginAttempts:        0,
        lastFailedAttempt:    0,
        lastLogin:            0,
        lastIp:               '',
        deviceCount:          0,
        twoFactorEnabled:     false,
        twoFactorSecret:      ''
      },

      // Verificación de identidad
      verification: {
        emailVerified:        false,
        emailVerifiedAt:      0,
        phoneVerified:        false,
        phoneVerifiedAt:      0,
        identityVerified:     false,
        identityVerifiedAt:   0
      },

      // Moderación y reportes
      moderation: {
        warnings:       0,
        reports:        0,
        lastWarningAt:  0,
        lastReportAt:   0,
        notes:          ''
      },

      createdAt: now,
      updatedAt: now
    };

    // ── 9. Escritura atómica en Firebase Realtime Database ───────────────────
    try {
      await db.ref().update({
        [`users/${uid}`]:             userData,
        [`controlUsers/${uid}`]:      controlUserData,
        [`usernames/${usernameKey}`]: uid,
        [`emails/${emailKey}`]:       uid
      });
    } catch (dbErr) {
      // Si el DB falla, eliminar el usuario de Auth para no dejar estado inconsistente
      await auth.deleteUser(uid).catch(() => {});
      throw dbErr;
    }

    // ── 10. Generar JWT ───────────────────────────────────────────────────────
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'El servidor no está configurado correctamente (JWT_SECRET ausente).'
      });
    }

    const token = jwt.sign(
      { uid, username: usernameKey, email: emailNormal },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({
      success: true,
      message: '✅ Usuario registrado correctamente.',
      token,
      uid,
      user: userData
    });

  } catch (error) {
    console.error('[register] Error:', error);
    const mapped = firebaseAuthMessage(error);
    const status = mapped?.status || error.statusCode || error.status || 500;
    return res.status(status).json({
      success: false,
      message: mapped?.message || (status === 500 ? 'Error interno del servidor. Revisa los logs de Render/Fly para ver el detalle real.' : error.message),
      error: error.code || error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/login
// ─────────────────────────────────────────────────────────────────────────────

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ── 1. Validar campos requeridos ──────────────────────────────────────────
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos.'
      });
    }

    const emailKey    = toEmailKey(email);
    const emailNormal = toEmailNormal(email);

    // ── 2. Verificar que el email existe ──────────────────────────────────────
    const emailSnap = await db.ref(`emails/${emailKey}`).once('value');
    if (!emailSnap.exists()) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas.'  // mensaje genérico por seguridad
      });
    }

    const uid = emailSnap.val();

    // ── 3. Obtener datos del usuario y control en paralelo ────────────────────
    const [userSnap, controlSnap] = await Promise.all([
      db.ref(`users/${uid}`).once('value'),
      db.ref(`controlUsers/${uid}`).once('value')
    ]);

    if (!userSnap.exists() || !controlSnap.exists()) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas.'
      });
    }

    const user    = userSnap.val();
    const control = controlSnap.val();

    // ── 4. Verificar contraseña ───────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, control.security.passwordHash);
    if (!passwordMatch) {
      // Registrar intento fallido
      await db.ref(`controlUsers/${uid}/security`).update({
        loginAttempts:     (control.security.loginAttempts || 0) + 1,
        lastFailedAttempt: Date.now()
      });
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas.'
      });
    }

    // ── 5. Verificar estado de la cuenta ─────────────────────────────────────

    // 5a. ¿Baneado?
    if (control.ban?.isBanned) {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta ha sido baneada permanentemente.',
        reason:  control.ban.reason  || 'Violación de los términos de servicio.',
        bannedAt: control.ban.createdAt
      });
    }

    // 5b. ¿Suspendido?
    if (control.suspension?.isSuspended) {
      const now = Date.now();
      const suspensionActive =
        control.suspension.until === 0 ||      // indefinida
        control.suspension.until > now;        // aún no expiró

      if (suspensionActive) {
        return res.status(403).json({
          success: false,
          message: 'Tu cuenta está suspendida temporalmente.',
          reason:  control.suspension.reason || 'Suspensión temporal.',
          until:   control.suspension.until === 0
            ? 'indefinido'
            : new Date(control.suspension.until).toISOString()
        });
      }

      // La suspensión ya expiró → reactivar automáticamente
      await db.ref(`controlUsers/${uid}`).update({
        accountStatus:           'active',
        'suspension/isSuspended': false,
        updatedAt:               Date.now()
      });
    }

    // 5c. accountStatus final
    if (control.accountStatus !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta no está activa. Contacta al soporte.'
      });
    }

    // ── 6. Verificar permiso de login ─────────────────────────────────────────
    if (control.permissions?.canLogin === false) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para iniciar sesión.'
      });
    }

    // ── 7. Actualizar datos de sesión ─────────────────────────────────────────
    const now = Date.now();

    await Promise.all([
      db.ref(`controlUsers/${uid}/security`).update({
        loginAttempts: 0,
        lastLogin:     now,
        lastIp:        req.ip || ''
      }),
      db.ref(`users/${uid}`).update({
        isOnline:  true,
        lastSeen:  now,
        updatedAt: now
      })
    ]);

    // ── 8. Generar JWT ────────────────────────────────────────────────────────
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'El servidor no está configurado correctamente (JWT_SECRET ausente).'
      });
    }

    const token = jwt.sign(
      { uid, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // ── 9. Respuesta (sin passwordHash) ───────────────────────────────────────
    const safeUser = {
      name:      user.name,
      username:  user.username,
      email:     user.email,
      avatar:    user.avatar,
      bio:       user.bio,
      isOnline:  true,
      lastSeen:  now,
      createdAt: user.createdAt,
      updatedAt: now
    };

    return res.status(200).json({
      success: true,
      message: '✅ Inicio de sesión exitoso.',
      token,
      uid,
      user: safeUser
    });

  } catch (error) {
    console.error('[login] Error:', error);
    const mapped = firebaseAuthMessage(error);
    const status = mapped?.status || error.statusCode || error.status || 500;
    return res.status(status).json({
      success: false,
      message: mapped?.message || (status === 500 ? 'Error interno del servidor. Revisa los logs de Render/Fly para ver el detalle real.' : error.message),
      error: error.code || error.message
    });
  }
};
