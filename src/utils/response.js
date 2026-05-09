'use strict';

/**
 * src/utils/response.js
 *
 * Helpers de respuesta JSON reutilizables en todos los controladores.
 * Estos helpers son importados por project.controller, user.controller, etc.
 */

/**
 * Respuesta exitosa estándar.
 * @param {Object} data  - Datos a incluir en la respuesta.
 * @param {string} message - Mensaje descriptivo.
 */
const ok = (data = {}, message = 'Operación completada correctamente.') => ({
  success: true,
  message,
  ...data,
});

/**
 * Respuesta de error estándar.
 * @param {string} message - Descripción del error.
 * @param {string} error   - Código de error en SCREAMING_SNAKE_CASE.
 * @param {Object} extra   - Campos adicionales opcionales.
 */
const fail = (message = 'Error interno del servidor.', error = 'SERVER_ERROR', extra = {}) => ({
  success: false,
  message,
  error,
  ...extra,
});

module.exports = { ok, fail };
