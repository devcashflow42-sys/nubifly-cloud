'use strict';
const { fail } = require('../utils/response');

// ── 404 handler ────────────────────────────────────────────────────────────
const notFound = (req, res, _next) => {
  res.status(404).json(fail(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));
};

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  console.error('[ERROR]', err);

  const status  = err.statusCode || err.status || 500;
  const message = err.expose ? err.message : 'Error interno del servidor.';
  const code    = err.code || 'SERVER_ERROR';

  res.status(status).json(fail(message, code));
};

module.exports = { notFound, errorHandler };
