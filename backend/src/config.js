const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Toda la configuración sale de variables de entorno (.env) para que Mac, Windows y la tablet usen el mismo código. */
function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    // Solo rutas relativas a la carpeta del proyecto: nunca guardamos rutas absolutas en la base de datos
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    timezone: env.TIMEZONE || 'America/Bogota',
    adminToken: env.ADMIN_TOKEN || '',
    // 'http' = servicio Python real (Parte 3) | 'mock' = simulado, SOLO para desarrollar la app
    recognitionMode: env.RECOGNITION_MODE || 'http',
    recognitionUrl: env.RECOGNITION_URL || 'http://127.0.0.1:8001',
    recognitionTimeoutMs: Number(env.RECOGNITION_TIMEOUT_MS || 20000),
    // En producción solo se toma asistencia el día de la clase; en pruebas conviene poder hacerlo cualquier día
    allowAnyDay: String(env.ALLOW_ANY_DAY || 'false') === 'true',
    maxBodyMb: Number(env.MAX_BODY_MB || 15),
  };
}

module.exports = { loadConfig, ROOT };
