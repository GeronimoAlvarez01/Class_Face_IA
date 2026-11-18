const path = require('node:path');
const { loadConfig, ROOT } = require('./config');

try {
  process.loadEnvFile(path.join(ROOT, '.env')); // opcional: si no existe .env se usan los valores por defecto
} catch {
  /* sin .env */
}

const { openDb } = require('./db');
const { createRecognitionClient } = require('./recognition');
const { createApp } = require('./app');

const cfg = loadConfig();
const db = openDb(path.join(cfg.dataDir, 'asistencia.db'));
const server = createApp({ cfg, db, recognition: createRecognitionClient(cfg) });

server.listen(cfg.port, cfg.host, () => {
  console.log(`API de asistencia en http://localhost:${cfg.port}  (reconocimiento: ${cfg.recognitionMode})`);
  if (cfg.recognitionMode === 'mock') console.warn('⚠️  MODO MOCK: el reconocimiento es simulado. No usar con estudiantes reales.');
  if (!cfg.adminToken) console.warn('⚠️  Sin ADMIN_TOKEN: la API no pide clave. Defínalo en .env antes de exponerla en una red.');
  if (cfg.allowAnyDay) console.warn('⚠️  ALLOW_ANY_DAY=true: se puede tomar asistencia cualquier día (solo para pruebas).');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
