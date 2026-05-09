const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación JWT.
 * Uso en rutas protegidas:
 *
 *   const { verifyToken } = require('../middlewares/auth.middleware');
 *   router.get('/profile', verifyToken, profileController.getProfile);
 *
 * El token debe enviarse en el header:
 *   Authorization: Bearer <token>
 */
const verifyToken = (req, res, next) => {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ success: false, message: 'Servicio no disponible.' });
  }

  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acceso requerido.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { uid, username, email, iat, exp }
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      message: 'Token inválido o expirado.'
    });
  }
};

module.exports = { verifyToken };
