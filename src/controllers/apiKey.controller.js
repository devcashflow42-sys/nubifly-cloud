'use strict';
const { ok, fail }   = require('../utils/response');
const projectService = require('../services/project.service');
const apiKeyService  = require('../services/apiKey.service');

// ── Guard: project belongs to authenticated user ───────────────────────────
const assertOwner = async (projectId, uid, res) => {
  const project = await projectService.getProject(projectId);
  if (!project) { res.status(404).json(fail('Proyecto no encontrado.', 'NOT_FOUND')); return null; }
  if (project.ownerId !== uid) { res.status(403).json(fail('Acceso denegado.', 'FORBIDDEN')); return null; }
  return project;
};

// ── POST /api/projects/:projectId/api-key/generate ──────────────────────
exports.generateApiKey = async (req, res) => {
  try {
    const project = await assertOwner(req.params.projectId, req.user.uid, res);
    if (!project) return;
    const result = await apiKeyService.rotateApiKey(req.params.projectId, req.user.uid);
    return res.status(201).json(ok(result, 'API Key generada correctamente.'));
  } catch (err) {
    console.error('[generateApiKey]', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, err.code || 'SERVER_ERROR'));
  }
};

// ── POST /api/projects/:projectId/api-key/regenerate ────────────────────
exports.regenerateApiKey = async (req, res) => {
  try {
    const project = await assertOwner(req.params.projectId, req.user.uid, res);
    if (!project) return;
    const result = await apiKeyService.rotateApiKey(req.params.projectId, req.user.uid);
    return res.json(ok(result, 'API Key regenerada correctamente.'));
  } catch (err) {
    console.error('[regenerateApiKey]', err);
    return res.status(500).json(fail('Error regenerando la API Key.', 'SERVER_ERROR'));
  }
};

// ── GET /api/projects/:projectId/api-key ────────────────────────────────
exports.getApiKey = async (req, res) => {
  try {
    const project = await assertOwner(req.params.projectId, req.user.uid, res);
    if (!project) return;
    const apiKey = await apiKeyService.getApiKey(req.params.projectId);
    if (!apiKey) return res.status(404).json(fail('No se ha generado una API Key para este proyecto.', 'NO_API_KEY'));
    return res.json(ok({ apiKey }));
  } catch (err) {
    console.error('[getApiKey]', err);
    return res.status(500).json(fail('Error obteniendo la API Key.', 'SERVER_ERROR'));
  }
};
