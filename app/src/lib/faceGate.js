// Decide EN EL DISPOSITIVO si ya se puede tomar la foto, a partir de los rostros que ve el detector local
// (MediaPipe en la web). Así no se toma ni se envía ninguna foto mientras no haya un rostro en el óvalo.
// El servidor vuelve a validar la foto con su propio detector (MTCNN): aquí solo se evita disparar en vano.

const { checkFaceInGuide, GUIDE_MESSAGES } = require('./guide');
const { NO_FACE, MULTIPLE } = require('./scan');

const BACKGROUND_RATIO = 0.35; // igual que el servidor: caras mucho más pequeñas (alguien al fondo) no cuentan
const STABLE_FRAMES = 3;       // cuadros seguidos con el rostro bien ubicado antes de disparar (~0,5 s)
// Un poco más exigente que el servidor (tolerancia 1.05): con las fotos reales, de cada 200 veces que aquí se
// dispara el servidor rechaza ~1 (y entonces se espera 1,5 s antes de reintentar)
const LOCAL = { tolerance: 1.0, minRatio: 0.35 };
const HOLD = 'Mantén el rostro quieto.';

/**
 * BlazeFace (MediaPipe) enmarca la cara más baja y sin la frente que MTCNN: su caja mide ~80 % de alto y su
 * centro queda más abajo. Se lleva a la forma de la de MTCNN para usar los mismos umbrales del servidor.
 * (Medido con las fotos de backend/data/photos.)
 */
function toServerBox([x1, y1, x2, y2]) {
  const h = (y2 - y1) / 0.8;
  const cy = (y1 + y2) / 2 - 0.2 * h;
  return [x1, cy - h / 2, x2, cy + h / 2];
}

/** boxes = cajas del detector en fracciones del cuadro [x1, y1, x2, y2]; guide = computeGuide(...) */
function faceStatus(boxes, guide) {
  if (!boxes.length) return { status: 'no_face', message: NO_FACE };
  const area = ([x1, y1, x2, y2]) => (x2 - x1) * (y2 - y1);
  const biggest = Math.max(...boxes.map(area));
  const significant = boxes.filter((b) => area(b) >= BACKGROUND_RATIO * biggest);
  if (significant.length > 1) return { status: 'multiple_faces', message: MULTIPLE };
  const fit = checkFaceInGuide(toServerBox(significant[0]), guide, LOCAL);
  if (fit.ok) return { status: 'ok', message: HOLD };
  return { status: fit.reason, message: GUIDE_MESSAGES[fit.reason] };
}

/** Exige varios cuadros seguidos bien ubicados: `ready` = se puede disparar. */
function createFaceTracker(stableFrames = STABLE_FRAMES) {
  let streak = 0;
  return (s) => {
    streak = s.status === 'ok' ? streak + 1 : 0;
    return { ...s, ready: streak >= stableFrames };
  };
}

module.exports = { faceStatus, createFaceTracker, toServerBox, STABLE_FRAMES };
