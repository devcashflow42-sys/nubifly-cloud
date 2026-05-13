/**
 * GET  /api/users   — mensaje público amigable
 * POST/PUT/DELETE   — 405 Method Not Allowed
 */
import { jsonRes, fail } from '../../_lib/response.js';

const INFO = {
  success: true,
  message: '👋 Bienvenido a la API de Nubifly',
  info:    'Este endpoint no devuelve la lista de usuarios por razones de privacidad.',
  uso: {
    ver_perfil_publico: 'GET /api/users/:username',
    mi_perfil:          'GET /api/user/profile  (requiere token)',
    documentacion:      'https://nubifly.com/api'
  },
  version: '2.0'
};

export function onRequestGet()    { return jsonRes(INFO); }
export function onRequestPost()   { return jsonRes(fail('Método no permitido.', 'METHOD_NOT_ALLOWED'), 405); }
export function onRequestPut()    { return jsonRes(fail('Método no permitido.', 'METHOD_NOT_ALLOWED'), 405); }
export function onRequestDelete() { return jsonRes(fail('Método no permitido.', 'METHOD_NOT_ALLOWED'), 405); }
