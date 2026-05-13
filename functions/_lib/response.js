/**
 * functions/_lib/response.js
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'X-Timestamp',
    'X-Nonce',
    'X-Signature'
  ].join(', '),
  'Access-Control-Max-Age': '86400'
};

export const ok = (data = {}, message = 'Operación completada correctamente') =>
  ({ success: true, message, data });

export const fail = (message = 'Error interno', error = 'SERVER_ERROR', extra = {}) =>
  ({ success: false, message, error, ...extra });

export function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
