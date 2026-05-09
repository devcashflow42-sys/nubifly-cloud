'use strict';
const db = require('../config/firebase');
const { ok, fail } = require('../utils/response');

// GET /api/user/apikeys
exports.list = async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.ref(`userApiKeys/${uid}`).once('value');
    const keys = [];
    snap.forEach(c => keys.push(c.val()));
    return res.json(ok({ keys: keys.reverse() }));
  } catch (err) {
    console.error('[userApiKey.list]', err);
    return res.status(500).json(fail('Error listando claves.'));
  }
};

// POST /api/user/apikeys
exports.create = async (req, res) => {
  try {
    const { uid } = req.user;
    const { id, name, perm, permLabel, key, created } = req.body;
    if (!id || !name || !key) return res.status(400).json(fail('Faltan campos requeridos.'));
    const keyData = { id, name, perm: perm || 'all', permLabel: permLabel || 'Acceso total', key, created: created || '', calls: 0 };
    await db.ref(`userApiKeys/${uid}/${id}`).set(keyData);
    return res.status(201).json(ok({ key: keyData }, 'Clave creada correctamente.'));
  } catch (err) {
    console.error('[userApiKey.create]', err);
    return res.status(500).json(fail('Error creando clave.'));
  }
};

// DELETE /api/user/apikeys/trash  →  empty trash (must be before /:keyId)
exports.emptyTrash = async (req, res) => {
  try {
    const { uid } = req.user;
    await db.ref(`userApiKeyTrash/${uid}`).remove();
    return res.json(ok({}, 'Papelera vaciada.'));
  } catch (err) {
    console.error('[userApiKey.emptyTrash]', err);
    return res.status(500).json(fail('Error vaciando papelera.'));
  }
};

// GET /api/user/apikeys/trash
exports.listTrash = async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.ref(`userApiKeyTrash/${uid}`).once('value');
    const items = [];
    snap.forEach(c => items.push(c.val()));
    return res.json(ok({ items: items.reverse() }));
  } catch (err) {
    console.error('[userApiKey.listTrash]', err);
    return res.status(500).json(fail('Error listando papelera.'));
  }
};

// POST /api/user/apikeys/trash/:keyId/restore
exports.restore = async (req, res) => {
  try {
    const { uid } = req.user;
    const { keyId } = req.params;
    const snap = await db.ref(`userApiKeyTrash/${uid}/${keyId}`).once('value');
    if (!snap.exists()) return res.status(404).json(fail('Elemento no encontrado.'));
    const { deletedAt, type, ...restored } = snap.val();
    await Promise.all([
      db.ref(`userApiKeyTrash/${uid}/${keyId}`).remove(),
      db.ref(`userApiKeys/${uid}/${keyId}`).set(restored)
    ]);
    return res.json(ok({ key: restored }, 'Elemento restaurado.'));
  } catch (err) {
    console.error('[userApiKey.restore]', err);
    return res.status(500).json(fail('Error restaurando elemento.'));
  }
};

// DELETE /api/user/apikeys/trash/:keyId  →  permanent delete
exports.permanentDelete = async (req, res) => {
  try {
    const { uid } = req.user;
    const { keyId } = req.params;
    await db.ref(`userApiKeyTrash/${uid}/${keyId}`).remove();
    return res.json(ok({}, 'Eliminado definitivamente.'));
  } catch (err) {
    console.error('[userApiKey.permanentDelete]', err);
    return res.status(500).json(fail('Error eliminando.'));
  }
};

// DELETE /api/user/apikeys/:keyId  →  move to trash
exports.moveToTrash = async (req, res) => {
  try {
    const { uid } = req.user;
    const { keyId } = req.params;
    const snap = await db.ref(`userApiKeys/${uid}/${keyId}`).once('value');
    if (!snap.exists()) return res.status(404).json(fail('Clave no encontrada.'));
    const item = {
      ...snap.val(),
      type:      'apikey',
      deletedAt: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    };
    await Promise.all([
      db.ref(`userApiKeys/${uid}/${keyId}`).remove(),
      db.ref(`userApiKeyTrash/${uid}/${keyId}`).set(item)
    ]);
    return res.json(ok({}, 'Clave movida a la papelera.'));
  } catch (err) {
    console.error('[userApiKey.moveToTrash]', err);
    return res.status(500).json(fail('Error eliminando clave.'));
  }
};
