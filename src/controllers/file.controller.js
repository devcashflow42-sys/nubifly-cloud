'use strict';
const path        = require('path');
const multer      = require('multer');
const crypto      = require('crypto');
const { ok, fail }    = require('../utils/response');
const fileService     = require('../services/file.service');
const projectService  = require('../services/project.service');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// ── Multer disk storage ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext    = path.extname(file.originalname);
    const unique = crypto.randomBytes(12).toString('hex');
    cb(null, `${unique}${ext}`);
  }
});

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    // Block executables
    const blocked = ['.exe', '.bat', '.sh', '.php', '.py'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) {
      return cb(new Error('Tipo de archivo no permitido.'));
    }
    cb(null, true);
  }
});

// ── POST /api/files/upload ────────────────────────────────────────────────
// Expects multipart/form-data with: file (file), projectId (text)
exports.uploadMiddleware = upload.single('file');

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(fail('No se recibió ningún archivo.', 'NO_FILE'));
    }

    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json(fail('projectId es requerido.', 'PROJECT_ID_REQUIRED'));
    }

    // Verify ownership
    const project = await projectService.getProject(projectId);
    if (!project) return res.status(404).json(fail('Proyecto no encontrado.', 'NOT_FOUND'));
    if (project.ownerId !== req.user.uid) {
      return res.status(403).json(fail('Acceso denegado.', 'FORBIDDEN'));
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const file    = await fileService.saveFile({
      projectId,
      ownerId:      req.user.uid,
      originalName: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      filename:     req.file.filename,
      baseUrl
    });

    return res.status(201).json(ok({ file }, 'Archivo subido correctamente.'));
  } catch (err) {
    console.error('[uploadFile]', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json(fail(`El archivo supera el límite de ${process.env.MAX_FILE_SIZE_MB || 50}MB.`, 'FILE_TOO_LARGE'));
    }
    return res.status(500).json(fail('Error subiendo el archivo.', 'SERVER_ERROR'));
  }
};

// ── GET /api/files/:projectId ─────────────────────────────────────────────
exports.listFiles = async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await projectService.getProject(projectId);
    if (!project) return res.status(404).json(fail('Proyecto no encontrado.', 'NOT_FOUND'));
    if (project.ownerId !== req.user.uid) {
      return res.status(403).json(fail('Acceso denegado.', 'FORBIDDEN'));
    }

    const files = await fileService.listFiles(projectId);
    return res.json(ok({ files }));
  } catch (err) {
    console.error('[listFiles]', err);
    return res.status(500).json(fail('Error listando archivos.', 'SERVER_ERROR'));
  }
};

// ── DELETE /api/files/:fileId ─────────────────────────────────────────────
exports.deleteFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const db_mod = require('../config/firebase');
    const snap   = await db_mod.ref(`files/${fileId}`).once('value');

    if (!snap.exists()) return res.status(404).json(fail('Archivo no encontrado.', 'NOT_FOUND'));

    const file = snap.val();
    if (file.ownerId !== req.user.uid) {
      return res.status(403).json(fail('Acceso denegado.', 'FORBIDDEN'));
    }

    await fileService.deleteFile(fileId, UPLOAD_DIR);
    return res.json(ok({}, 'Archivo eliminado correctamente.'));
  } catch (err) {
    console.error('[deleteFile]', err);
    return res.status(500).json(fail('Error eliminando el archivo.', 'SERVER_ERROR'));
  }
};
