'use strict';
const { ok, fail }    = require('../utils/response');
const projectService  = require('../services/project.service');

// ── POST /api/projects ────────────────────────────────────────────────────
exports.createProject = async (req, res) => {
  try {
    const { name, description } = req.body;
    const { uid } = req.user;

    if (!name || !name.trim()) {
      return res.status(400).json(fail('El nombre del proyecto es requerido.', 'NAME_REQUIRED'));
    }
    if (name.trim().length > 60) {
      return res.status(400).json(fail('El nombre no puede superar 60 caracteres.', 'NAME_TOO_LONG'));
    }

    const project = await projectService.createProject({ ownerId: uid, name, description });
    return res.status(201).json(ok({ project }, 'Proyecto creado correctamente.'));
  } catch (err) {
    console.error('[createProject]', err);
    return res.status(500).json(fail('Error creando el proyecto.', 'SERVER_ERROR'));
  }
};

// ── GET /api/projects ─────────────────────────────────────────────────────
exports.listProjects = async (req, res) => {
  try {
    const projects = await projectService.listProjects(req.user.uid);
    return res.json(ok({ projects }));
  } catch (err) {
    console.error('[listProjects]', err);
    return res.status(500).json(fail('Error obteniendo proyectos.', 'SERVER_ERROR'));
  }
};

// ── GET /api/projects/:projectId ──────────────────────────────────────────
exports.getProject = async (req, res) => {
  try {
    const project = await projectService.getProject(req.params.projectId);
    if (!project) return res.status(404).json(fail('Proyecto no encontrado.', 'NOT_FOUND'));
    if (project.ownerId !== req.user.uid) {
      return res.status(403).json(fail('No tienes acceso a este proyecto.', 'FORBIDDEN'));
    }
    return res.json(ok({ project }));
  } catch (err) {
    console.error('[getProject]', err);
    return res.status(500).json(fail('Error obteniendo el proyecto.', 'SERVER_ERROR'));
  }
};

// ── DELETE /api/projects/:projectId ──────────────────────────────────────
exports.deleteProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectService.getProject(projectId);
    if (!project) return res.status(404).json(fail('Proyecto no encontrado.', 'NOT_FOUND'));
    if (project.ownerId !== req.user.uid) {
      return res.status(403).json(fail('No tienes acceso a este proyecto.', 'FORBIDDEN'));
    }
    await projectService.deleteProject(projectId, req.user.uid);
    return res.json(ok({}, 'Proyecto eliminado correctamente.'));
  } catch (err) {
    console.error('[deleteProject]', err);
    return res.status(500).json(fail('Error eliminando el proyecto.', 'SERVER_ERROR'));
  }
};
