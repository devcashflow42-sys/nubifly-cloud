'use strict';
const db       = require('../config/firebase');
const { ok, fail } = require('../utils/response');

// ── GET /api/user/profile ─────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const { uid } = req.user;

    const [userSnap, ctrlSnap] = await Promise.all([
      db.ref(`users/${uid}`).once('value'),
      db.ref(`controlUsers/${uid}`).once('value')
    ]);

    if (!userSnap.exists()) {
      return res.status(404).json(fail('Usuario no encontrado.', 'USER_NOT_FOUND'));
    }

    const user    = userSnap.val();
    const control = ctrlSnap.val() || {};

    const profile = {
      uid,
      name:          user.name,
      username:      user.username,
      email:         user.email,
      avatar:        user.avatar || '',
      bio:           user.bio || '',
      isOnline:      user.isOnline,
      lastSeen:      user.lastSeen,
      createdAt:     user.createdAt,
      plan:          control.plan?.type || 'normal',
      isPremium:     control.plan?.isPremium || false,
      accountStatus: control.accountStatus || 'active',
      permissions:   control.permissions || {},
      limits:        control.limits || {}
    };

    return res.json(ok({ user: profile }));
  } catch (err) {
    console.error('[getProfile]', err);
    return res.status(500).json(fail('Error obteniendo el perfil.', 'SERVER_ERROR'));
  }
};

// ── PATCH /api/user/profile ────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const { name, bio, avatar } = req.body;

    const updates = { updatedAt: Date.now() };
    if (name  !== undefined) updates.name  = name.trim().slice(0, 50);
    if (bio   !== undefined) updates.bio   = bio.trim().slice(0, 300);
    if (avatar !== undefined) updates.avatar = avatar.trim();

    await db.ref(`users/${uid}`).update(updates);
    return res.json(ok({ updates }, 'Perfil actualizado correctamente.'));
  } catch (err) {
    console.error('[updateProfile]', err);
    return res.status(500).json(fail('Error actualizando el perfil.', 'SERVER_ERROR'));
  }
};

// ── GET /api/user/dashboard ────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const { uid } = req.user;

    // Load projects count, files count, api keys count
    const [projSnap, filesSnap] = await Promise.all([
      db.ref('projects').orderByChild('ownerId').equalTo(uid).once('value'),
      db.ref('files').orderByChild('ownerId').equalTo(uid).once('value')
    ]);

    const projectCount = projSnap.numChildren();
    const fileCount    = filesSnap.numChildren();

    let storageUsed = 0;
    filesSnap.forEach(f => { storageUsed += (f.val().fileSize || 0); });

    return res.json(ok({ projectCount, fileCount, storageUsed }));
  } catch (err) {
    console.error('[getDashboard]', err);
    return res.status(500).json(fail('Error cargando el dashboard.', 'SERVER_ERROR'));
  }
};
