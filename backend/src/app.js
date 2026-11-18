const { buildApi } = require('./api');
const { createServer } = require('./http');
const { todayIn } = require('./schedule');

/** Ensambla el servidor con sus dependencias inyectadas (así las pruebas usan un reloj y un reconocimiento falsos). */
function createApp({ cfg, db, recognition, clock }) {
  const theClock = clock ?? { today: () => todayIn(cfg.timezone) };
  const router = buildApi({ db, cfg, recognition, clock: theClock });
  return createServer(router, { cfg });
}

module.exports = { createApp };
