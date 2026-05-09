# `functions/` — Backend en Cloudflare Pages Functions

Este directorio contiene el backend completo de Nubifly como **funciones serverless**
de Cloudflare Pages. Antes era un único archivo `[[path]].js` de 2.441 líneas que
hacía dispatching manual de URLs; ahora está dividido en módulos pequeños usando
el **filesystem-based routing** que Cloudflare Pages ofrece de forma nativa.

## ¿Cómo funciona el routing?

Cloudflare Pages mapea **cada archivo** dentro de `functions/` a una ruta HTTP:

| Archivo                                                | URL                                              |
|--------------------------------------------------------|--------------------------------------------------|
| `api/login.js`                                         | `/api/login`                                     |
| `api/projects/index.js`                                | `/api/projects`                                  |
| `api/projects/[id]/index.js`                           | `/api/projects/<id>`                             |
| `api/projects/[id]/api-key/generate.js`                | `/api/projects/<id>/api-key/generate`            |
| `api/v1/projects/[projectId]/files/upload.js`          | `/api/v1/projects/<projectId>/files/upload`      |

Los corchetes `[name]` capturan un segmento dinámico que llega como `context.params.name`.

Cada archivo exporta funciones por verbo HTTP — `onRequestGet`, `onRequestPost`,
`onRequestPatch`, `onRequestDelete`. Si querés que un archivo maneje varios verbos,
exportás todas las que necesites.

## Estructura

```
functions/
├── _lib/                          ← código compartido (no es ruta HTTP)
│   ├── auth.js                    ← validación JWT, API keys, Bearer resolver
│   ├── crypto.js                  ← base64url, PBKDF2, JWT (HS256)
│   ├── firebase-auth.js           ← sync con Firebase Authentication
│   ├── firebase.js                ← REST API de Realtime Database + OAuth2
│   ├── helpers.js                 ← email keys, encodeApiKey, generateApiKey, sanitize
│   ├── legacy-v1-auth.js          ← resolver dual (user key OR project key)
│   ├── permissions.js             ← requirePermission + presets granulares
│   ├── plans.js                   ← límites por plan
│   ├── response.js                ← jsonRes / ok / fail / CORS
│   ├── rotate-api-key.js          ← rotación de API key del proyecto
│   ├── storage.js                 ← upload a Firebase Storage
│   ├── upload-file.js             ← handler de /api/files/upload
│   └── v1-handlers.js             ← handlers compartidos v1
│
└── api/
    ├── _middleware.js             ← se ejecuta antes de TODA ruta /api/*
    │                                (CORS preflight, validación env, token Firebase)
    │
    ├── health.js                       GET    /api/health
    ├── health/firebase-auth.js         GET    /api/health/firebase-auth
    │
    ├── register.js                     GET/POST /api/register
    ├── login.js                        GET/POST /api/login
    │
    ├── auth/google/
    │   ├── index.js                    GET    /api/auth/google
    │   └── callback.js                 GET    /api/auth/google/callback
    │
    ├── user/
    │   ├── profile.js                  GET/PATCH /api/user/profile
    │   ├── dashboard.js                GET    /api/user/dashboard
    │   ├── files.js                    GET    /api/user/files
    │   ├── publications.js             GET    /api/user/publications
    │   ├── activity.js                 GET    /api/user/activity
    │   ├── notifications.js            GET    /api/user/notifications
    │   ├── notifications/[id]/read.js  POST   /api/user/notifications/<id>/read
    │   └── apikeys/
    │       ├── index.js                GET/POST /api/user/apikeys
    │       ├── [id].js                 DELETE /api/user/apikeys/<id>
    │       └── trash/
    │           ├── index.js            GET/DELETE /api/user/apikeys/trash
    │           └── [id]/
    │               ├── index.js        DELETE /api/user/apikeys/trash/<id>
    │               └── restore.js      POST   /api/user/apikeys/trash/<id>/restore
    │
    ├── projects/
    │   ├── index.js                    GET/POST /api/projects
    │   └── [id]/
    │       ├── index.js                GET/DELETE /api/projects/<id>
    │       └── api-key/
    │           ├── index.js            GET    /api/projects/<id>/api-key
    │           ├── generate.js         POST   /api/projects/<id>/api-key/generate
    │           └── regenerate.js       POST   /api/projects/<id>/api-key/regenerate
    │
    ├── files/
    │   ├── upload.js                   POST   /api/files/upload  (JWT o x-api-key)
    │   └── [id].js                     GET    /api/files/<projectId>  (lista archivos)
    │                                    DELETE /api/files/<fileId>     (elimina archivo)
    │
    └── v1/
        ├── upload.js                       POST /api/v1/upload                    (legacy)
        ├── files.js                        GET  /api/v1/files                     (user key)
        ├── status.js                       GET  /api/v1/status                    (user o project key)
        ├── request.js                      POST /api/v1/request                   (project key)
        ├── key/status.js                   GET  /api/v1/key/status                (user key)
        ├── publications/upload.js          POST /api/v1/publications/upload       (Bearer)
        └── projects/[projectId]/
            └── files/upload.js             POST /api/v1/projects/<projectId>/files/upload  (Bearer)
```

## Cómo agregar una ruta nueva

1. Decidí la URL: `/api/foo/bar` → archivo `functions/api/foo/bar.js`.
2. Si tiene un parámetro: `/api/foo/<id>/bar` → archivo `functions/api/foo/[id]/bar.js`,
   y dentro accedés a `context.params.id`.
3. En el archivo, exportás `onRequestGet`, `onRequestPost`, etc:
   ```js
   import { requireAuth } from '../../_lib/auth.js';
   import { jsonRes, ok } from '../../_lib/response.js';

   export async function onRequestGet(context) {
     const { user, errorResponse } = await requireAuth(context.request, context.env);
     if (errorResponse) return errorResponse;

     const { tok, db } = context.data;   // ← lo pone _middleware.js
     // …tu lógica aquí…
     return jsonRes(ok({ message: '¡hola!' }));
   }
   ```
4. Importá los helpers de `_lib/` con rutas relativas — el script
   `node check-imports.js` (en la raíz del repo durante desarrollo)
   verifica que todos los imports resuelvan.

## Variables de entorno

Las mismas que antes (configurar en **Cloudflare Pages → Settings → Environment variables**):

| Nombre                     | Requerido     | Descripción                                                          |
|----------------------------|---------------|----------------------------------------------------------------------|
| `FIREBASE_DATABASE_URL`    | sí            | URL de la Realtime Database                                          |
| `JWT_SECRET`               | sí            | Secret para firmar/verificar JWT                                     |
| `FIREBASE_DB_SECRET`       | uno de los 2  | Database Secret (vía simple)                                         |
| `FIREBASE_SERVICE_ACCOUNT` | uno de los 2  | JSON completo del service account (vía OAuth2 + sync con Auth)       |
| `FIREBASE_STORAGE_BUCKET`  | si subís archivos | Nombre del bucket, p.ej. `mi-proyecto.appspot.com`                |
| `JWT_EXPIRES_IN`           | no (def. 7d)  | Duración del token, p.ej. `7d`                                       |
| `GOOGLE_CLIENT_ID`         | si usás Google login |                                                               |
| `GOOGLE_CLIENT_SECRET`     | si usás Google login |                                                               |
| `GOOGLE_REDIRECT_URI`      | opcional      | Por defecto `${origin}/api/auth/google/callback`                     |
| `FIREBASE_PROJECT_ID`      | opcional      | Solo si el service account no incluye `project_id`                   |

## Notas

- **CORS** y resolución del **token Firebase** se hacen una sola vez por petición
  en `api/_middleware.js`. Las rutas reciben `context.data.tok` y `context.data.db`
  ya listos para llamar a `fbGet/fbSet/etc`.
- Los handlers que se reutilizan están en `_lib/v1-handlers.js`, `_lib/upload-file.js`
  y `_lib/rotate-api-key.js`.
- La compatibilidad de rutas con el `[[path]].js` original está al 100%: mismas URLs,
  mismos verbos, mismas respuestas.
