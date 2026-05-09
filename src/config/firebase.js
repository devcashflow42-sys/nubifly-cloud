const admin = require('firebase-admin');

// ─────────────────────────────────────────────────────────────────────────────
//  Carga de credenciales — compatible con Render, Fly.io y entorno local
//
//  Producción (Render / Fly.io):
//    Configura en el dashboard o con: fly secrets set KEY="valor"
//      FIREBASE_SERVICE_ACCOUNT  →  JSON completo del serviceAccountKey
//      FIREBASE_DATABASE_URL     →  https://TU-PROYECTO-default-rtdb.firebaseio.com
//
//  Desarrollo local:
//    Coloca serviceAccountKey.json en la raíz del proyecto (ya en .gitignore)
//    O bien setea FIREBASE_SERVICE_ACCOUNT en tu .env como JSON en una línea.
// ─────────────────────────────────────────────────────────────────────────────

// Bloqueo temprano — el servidor no arranca sin estas variables críticas.
if (!process.env.JWT_SECRET) {
  console.error('❌ Falta la variable de entorno JWT_SECRET. El servidor no puede arrancar.');
  process.exit(1);
}

let _db   = null;
let _auth = null;

try {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      // Render/Fly a veces guardan la private_key con \\n literal.
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } catch (err) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido: ' + err.message);
    }
  } else {
    try {
      serviceAccount = require('../../serviceAccountKey.json');
    } catch {
      throw new Error(
        'No se encontraron credenciales de Firebase.\n' +
        '  → Local:  coloca serviceAccountKey.json en la raíz del proyecto.\n' +
        '  → Producción: configura la variable FIREBASE_SERVICE_ACCOUNT.'
      );
    }
  }

  if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error('Falta la variable de entorno FIREBASE_DATABASE_URL.');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential:  admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }

  _db   = admin.database();
  _auth = admin.auth();
  console.log('✅ Firebase conectado correctamente.');

} catch (err) {
  console.error('❌ Firebase no pudo iniciarse:', err.message);
  console.error('   Configura las variables de entorno requeridas y reinicia el servidor.');
  process.exit(1);
}

const makeProxy = (getter, label) => {
  const _target = Object.create(null);
  return new Proxy(_target, {
    get (t, prop) {
      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      const obj = getter();
      if (!obj) {
        const e = new Error(`${label} no disponible.`);
        e.statusCode = 503;
        throw e;
      }
      const val = obj[prop];
      return typeof val === 'function' ? val.bind(obj) : val;
    }
  });
};

const dbProxy   = makeProxy(() => _db,   'Base de datos');
const authProxy = makeProxy(() => _auth, 'Firebase Auth');

// Compatibilidad: el export por defecto sigue siendo db (todos los archivos existentes funcionan igual)
module.exports      = dbProxy;
module.exports.auth = authProxy;
