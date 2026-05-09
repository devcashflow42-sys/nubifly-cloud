'use strict';
const path        = require('path');
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');

const authRoutes         = require('./routes/auth.routes');
const userRoutes         = require('./routes/user.routes');
const projectRoutes      = require('./routes/project.routes');
const fileRoutes         = require('./routes/file.routes');
const apiKeyRoutes       = require('./routes/apiKey.routes');
const userApiKeyRoutes   = require('./routes/userApiKey.routes');
const publicApiRoutes    = require('./routes/publicApi.routes');

const { errorHandler, notFound } = require('./middlewares/error.middleware');
const { globalLimiter }          = require('./middlewares/rateLimit.middleware');

const app = express();

// ─── Trust proxy (Render / Fly.io sit behind a load balancer) ─────────────
app.set('trust proxy', 1);

// ─── Security headers ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// ─── CORS ──────────────────────────────────────────────────────────────────
// Si ALLOWED_ORIGINS no está configurada se permiten todos los orígenes
// (útil en producción sin configurar la variable o con apps móviles).
// Cuando SÍ está configurada solo se aceptan los orígenes de esa lista.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: (origin, cb) => {
    // Sin Origin header: móviles, curl, server-to-server → siempre permitido
    if (!origin) return cb(null, true);
    // Sin lista configurada → permitir todo
    if (!ALLOWED_ORIGINS) return cb(null, true);
    // Con lista configurada → verificar
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origen no permitido'));
  },
  credentials: true
}));

// ─── Global rate-limit ─────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static uploads ────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Redirects: .html → clean URLs (must be before express.static) ────────
app.get('/index.html',    (_req, res) => res.redirect(301, '/'));
app.get('/home.html',     (_req, res) => res.redirect(301, '/home'));
app.get('/login.html',    (_req, res) => res.redirect(301, '/login'));
app.get('/register.html', (_req, res) => res.redirect(301, '/register'));

// ─── Static assets (CSS, JS, images — not HTML pages) ─────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Clean page routes ────────────────────────────────────────────────────
const pub = (file) => (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', file));
};

app.get('/',         pub('index.html'));
app.get('/home',     pub('home/index.html'));
app.get('/login',    pub('login/index.html'));
app.get('/register', pub('register/index.html'));


// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: '🚀 Nubifly Cloud API is running', ts: Date.now() });
});

// ─── API routes ────────────────────────────────────────────────────────────
app.use('/api',              authRoutes);
app.use('/api/user',         userRoutes);
app.use('/api/user/apikeys', userApiKeyRoutes);
app.use('/api/projects',     projectRoutes);
app.use('/api/files',        fileRoutes);
app.use('/api/projects',     apiKeyRoutes);
app.use('/api/v1',           publicApiRoutes);

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Error handlers ────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
