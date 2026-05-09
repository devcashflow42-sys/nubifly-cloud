'use strict';
const db   = require('../config/firebase');
const { fail } = require('../utils/response');

/**
 * Validates the x-api-key header against Firebase.
 * Attaches req.apiKeyData = { projectId, ownerId, project, owner }
 *
 * Usage:
 *   router.post('/request', verifyApiKey, controller);
 */
const verifyApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json(fail('API Key requerida.', 'API_KEY_MISSING'));
  }

  try {
    // Lookup by key in apiKeyIndex
    const indexSnap = await db.ref(`apiKeyIndex/${encodeApiKey(apiKey)}`).once('value');
    if (!indexSnap.exists()) {
      return res.status(401).json(fail('API Key inválida.', 'API_KEY_INVALID'));
    }

    const { projectId, ownerId } = indexSnap.val();

    // Load project and owner in parallel
    const [projSnap, ownerSnap, ctrlSnap] = await Promise.all([
      db.ref(`projects/${projectId}`).once('value'),
      db.ref(`users/${ownerId}`).once('value'),
      db.ref(`controlUsers/${ownerId}`).once('value')
    ]);

    if (!projSnap.exists()) {
      return res.status(401).json(fail('Proyecto no encontrado.', 'PROJECT_NOT_FOUND'));
    }

    const project = projSnap.val();
    const owner   = ownerSnap.val();
    const control = ctrlSnap.val();

    // Check owner suspension / ban
    if (control?.ban?.isBanned) {
      return res.status(403).json(fail('La cuenta del propietario ha sido baneada.', 'OWNER_BANNED'));
    }
    if (control?.suspension?.isSuspended) {
      const now = Date.now();
      const still = control.suspension.until === 0 || control.suspension.until > now;
      if (still) {
        return res.status(403).json(fail('La cuenta del propietario está suspendida.', 'OWNER_SUSPENDED'));
      }
    }
    if (control?.accountStatus !== 'active') {
      return res.status(403).json(fail('La cuenta del propietario no está activa.', 'OWNER_INACTIVE'));
    }

    req.apiKeyData = { projectId, ownerId, project, owner, control };
    next();
  } catch (err) {
    console.error('[apiKeyMiddleware]', err);
    return res.status(500).json(fail('Error validando la API Key.', 'SERVER_ERROR'));
  }
};

/**
 * Safe key encoding for Firebase path (replaces chars that Firebase disallows).
 * Firebase keys cannot contain . / [ ] # $
 */
function encodeApiKey(key) {
  return key.replace(/\./g, '__DOT__').replace(/\//g, '__SL__');
}

module.exports = { verifyApiKey, encodeApiKey };
