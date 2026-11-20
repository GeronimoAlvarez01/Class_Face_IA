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
    // true = solo cuenta el rostro que está dentro del recuadro punteado. Poner FACE_GUIDE=false lo desactiva
    // (por si el encuadre no coincidiera con la cámara de algún dispositivo).
    faceGuide: String(env.FACE_GUIDE || 'true') !== 'false',
    // Modo demo "Laboratorio IA": guarda en memoria los últimos recorridos para el visor. Apagado por defecto.
    // Poner también DEMO_TRACE=1 en el servicio Python (es quien genera los datos de la red).
    demoTrace: ['1', 'true', 'yes', 'on'].includes(String(env.DEMO_TRACE || '').trim().toLowerCase()),
    traceBuffer: Number(env.TRACE_BUFFER || 20),
  };
}

module.exports = { loadConfig, ROOT };
