# Nubifly Cloud — Documentación de la API

**Base URL en producción (Render):** `https://nubifly-cloud-api.onrender.com`  
**Base URL local:** `http://localhost:3000`

---

## Índice

1. [Health Check](#1-health-check)
2. [POST /api/register — Registro de usuario](#2-post-apiregister)
3. [POST /api/login — Inicio de sesión](#3-post-apilogin)
4. [Uso del token JWT en rutas protegidas](#4-uso-del-token-jwt)
5. [Códigos de error comunes](#5-códigos-de-error-comunes)
6. [Configuración en Render](#6-configuración-en-render)
7. [Variables de entorno](#7-variables-de-entorno)

---

## 1. Health Check

Verifica que el servidor está corriendo.

```
GET /
```

**Respuesta exitosa `200`**
```json
{
  "success": true,
  "message": "🚀 Nubifly Cloud API is running"
}
```

---

## 2. POST /api/register

Registra un nuevo usuario. Crea el perfil público (`users`), el perfil de control interno (`controlUsers`) y los índices de búsqueda por email y username en Firebase Realtime Database.

```
POST /api/register
Content-Type: application/json
```

### Body (JSON)

| Campo      | Tipo     | Requerido | Descripción                                      |
|------------|----------|-----------|--------------------------------------------------|
| `name`     | `string` | ✅        | Nombre real del usuario (2–50 caracteres)        |
| `username` | `string` | ✅        | Nombre de usuario único (3–20 chars, `[a-zA-Z0-9_]`) |
| `email`    | `string` | ✅        | Email válido y único                             |
| `password` | `string` | ✅        | Mínimo 6 caracteres                              |
| `avatar`   | `string` | ❌        | URL del avatar (opcional, por defecto `""`)      |
| `bio`      | `string` | ❌        | Biografía corta (opcional, por defecto `""`)     |

### Ejemplo de petición

```bash
curl -X POST https://nubifly-cloud-api.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ana García",
    "username": "anagarcia",
    "email": "ana@example.com",
    "password": "miClave123",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "Hola, soy Ana!"
  }'
```

### Respuesta exitosa `201`

```json
{
  "success": true,
  "message": "✅ Usuario registrado correctamente.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "uid": "-NxKjH2abc123",
  "user": {
    "name": "Ana García",
    "username": "anagarcia",
    "email": "ana@example.com",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "Hola, soy Ana!",
    "isOnline": true,
    "lastSeen": 1714000000000,
    "createdAt": 1714000000000,
    "updatedAt": 1714000000000
  }
}
```

> El campo `token` es un JWT válido por **7 días** (configurable con `JWT_EXPIRES_IN`). Guárdalo para autenticar las siguientes peticiones.

### Errores posibles

| Status | Mensaje                                                        | Causa                           |
|--------|----------------------------------------------------------------|---------------------------------|
| `400`  | `Campos requeridos: name, username, email, password.`          | Falta algún campo obligatorio   |
| `400`  | `El nombre debe tener entre 2 y 50 caracteres.`                | `name` muy corto o muy largo    |
| `400`  | `El username solo puede contener letras, números y guion bajo` | Formato de username inválido    |
| `400`  | `El formato del email no es válido.`                           | Email mal formado                |
| `400`  | `La contraseña debe tener al menos 6 caracteres.`              | Password demasiado corta        |
| `409`  | `Este email ya está registrado.`                               | Email duplicado en la base      |
| `409`  | `Este username ya está en uso.`                                | Username duplicado en la base   |
| `500`  | `Error interno del servidor.`                                  | Error de Firebase o servidor    |

---

## 3. POST /api/login

Autentica a un usuario existente. Verifica la contraseña, comprueba el estado de la cuenta (activa / suspendida / baneada) y devuelve un JWT.

```
POST /api/login
Content-Type: application/json
```

### Body (JSON)

| Campo      | Tipo     | Requerido | Descripción           |
|------------|----------|-----------|-----------------------|
| `email`    | `string` | ✅        | Email del usuario     |
| `password` | `string` | ✅        | Contraseña del usuario|

### Ejemplo de petición

```bash
curl -X POST https://nubifly-cloud-api.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "ana@example.com",
    "password": "miClave123"
  }'
```

### Respuesta exitosa `200`

```json
{
  "success": true,
  "message": "✅ Inicio de sesión exitoso.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "uid": "-NxKjH2abc123",
  "user": {
    "name": "Ana García",
    "username": "anagarcia",
    "email": "ana@example.com",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "Hola, soy Ana!",
    "isOnline": true,
    "lastSeen": 1714000000000,
    "createdAt": 1714000000000,
    "updatedAt": 1714000000000
  }
}
```

### Comportamiento especial: suspensión y ban

Si la cuenta está **baneada** (`403`):
```json
{
  "success": false,
  "message": "Tu cuenta ha sido baneada permanentemente.",
  "reason": "Violación de los términos de servicio.",
  "bannedAt": 1714000000000
}
```

Si la cuenta está **suspendida temporalmente** (`403`):
```json
{
  "success": false,
  "message": "Tu cuenta está suspendida temporalmente.",
  "reason": "Comportamiento inapropiado.",
  "until": "2025-06-01T00:00:00.000Z"
}
```

> Si la suspensión ya expiró, el sistema la levanta automáticamente y el login procede con normalidad.

### Errores posibles

| Status | Mensaje                                          | Causa                                 |
|--------|--------------------------------------------------|---------------------------------------|
| `400`  | `Email y contraseña son requeridos.`             | Falta algún campo                     |
| `401`  | `Credenciales inválidas.`                        | Email no existe o contraseña incorrecta |
| `403`  | `Tu cuenta ha sido baneada permanentemente.`     | Usuario baneado                       |
| `403`  | `Tu cuenta está suspendida temporalmente.`       | Usuario suspendido                    |
| `403`  | `Tu cuenta no está activa. Contacta al soporte.` | accountStatus distinto de `active`    |
| `403`  | `No tienes permiso para iniciar sesión.`         | `canLogin: false` en los permisos     |
| `500`  | `Error interno del servidor.`                    | Error de Firebase o servidor          |

---

## 4. Uso del token JWT

Todas las rutas protegidas requieren el JWT en el header `Authorization`:

```
Authorization: Bearer <token>
```

### Ejemplo con curl

```bash
curl -X GET https://nubifly-cloud-api.onrender.com/api/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Contenido del token decodificado

```json
{
  "uid": "-NxKjH2abc123",
  "username": "anagarcia",
  "email": "ana@example.com",
  "iat": 1714000000,
  "exp": 1714604800
}
```

### Errores de autenticación

| Status | Mensaje                       | Causa                              |
|--------|-------------------------------|------------------------------------|
| `401`  | `Token de acceso requerido.`  | No se envió el header              |
| `403`  | `Token inválido o expirado.`  | Token malformado o caducado        |

---

## 5. Códigos de error comunes

| Código | Significado                                                    |
|--------|----------------------------------------------------------------|
| `200`  | OK — Petición exitosa                                          |
| `201`  | Created — Recurso creado correctamente                         |
| `400`  | Bad Request — Datos inválidos o campos faltantes               |
| `401`  | Unauthorized — Credenciales incorrectas o token ausente        |
| `403`  | Forbidden — Cuenta restringida o token inválido                |
| `409`  | Conflict — Email o username ya en uso                          |
| `500`  | Internal Server Error — Error en el servidor o Firebase        |

---

## 6. Configuración en Render

Sigue estos pasos para desplegar la API en [Render](https://render.com):

### Paso 1 — Conecta tu repositorio

1. Ve a [dashboard.render.com](https://dashboard.render.com) → **New → Web Service**
2. Conecta tu cuenta de GitHub y selecciona el repositorio `nubifly-cloud`
3. Render detecta automáticamente el `render.yaml` del proyecto

### Paso 2 — Configura las variables de entorno

En el panel de Render → **Environment**, agrega estas variables:

| Variable                   | Valor                                                        |
|----------------------------|--------------------------------------------------------------|
| `FIREBASE_DATABASE_URL`    | `https://TU-PROYECTO-default-rtdb.firebaseio.com`            |
| `FIREBASE_SERVICE_ACCOUNT` | JSON completo del serviceAccountKey **en una sola línea**    |
| `JWT_SECRET`               | Cadena aleatoria larga (Render puede auto-generarla)         |
| `JWT_EXPIRES_IN`           | `7d` (o el valor que prefieras)                              |

> **¿Cómo obtener `FIREBASE_SERVICE_ACCOUNT`?**  
> Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio → **Generar nueva clave privada**.  
> Abre el archivo `.json` descargado, selecciona TODO su contenido y pégalo en el campo de valor de Render (en una sola línea, sin saltos de línea).

### Paso 3 — Deploy

Haz clic en **Create Web Service**. Render ejecutará `npm install` y luego `npm start`.

Cuando el deploy termina, tu API estará disponible en:
```
https://nubifly-cloud-api.onrender.com
```

---

## 7. Variables de entorno

| Variable                   | Requerida | Descripción                                              |
|----------------------------|-----------|----------------------------------------------------------|
| `PORT`                     | ❌        | Puerto del servidor (por defecto `3000`)                 |
| `FIREBASE_DATABASE_URL`    | ✅        | URL de la Realtime Database de Firebase                  |
| `FIREBASE_SERVICE_ACCOUNT` | ✅*       | JSON del serviceAccountKey (en producción / Render)      |
| `JWT_SECRET`               | ✅        | Clave secreta para firmar y verificar los tokens JWT     |
| `JWT_EXPIRES_IN`           | ❌        | Duración del token (por defecto `7d`)                    |

> \* En desarrollo local puedes usar el archivo `serviceAccountKey.json` en la raíz del proyecto en vez de la variable de entorno.

---

## Estructura del proyecto

```
nubifly-cloud/
├── server.js                      # Punto de entrada — arranca el servidor
├── render.yaml                    # Configuración de despliegue en Render
├── .env.example                   # Plantilla de variables de entorno
├── package.json
└── src/
    ├── app.js                     # Express app (middlewares y rutas)
    ├── config/
    │   └── firebase.js            # Inicialización de Firebase Admin SDK
    ├── controllers/
    │   └── auth.controller.js     # Lógica de register y login
    ├── middlewares/
    │   └── auth.middleware.js     # Verificación JWT (verifyToken)
    └── routes/
        └── auth.routes.js         # POST /api/register, POST /api/login
```

---

## Desarrollo local

```bash
# 1. Clona el repositorio
git clone https://github.com/devcashflow42-sys/nubifly-cloud.git
cd nubifly-cloud

# 2. Instala las dependencias
npm install

# 3. Configura las variables de entorno
cp .env.example .env
# Edita .env con tus valores reales

# 4. (Opción A) Coloca el serviceAccountKey.json en la raíz
#    — descárgalo desde Firebase Console

# 5. Inicia el servidor en modo desarrollo
npm run dev
```

El servidor estará disponible en `http://localhost:3000`.
