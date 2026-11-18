const { HttpError } = require('./http');

/**
 * Recuadro guía (el óvalo punteado de la cámara) expresado en fracciones de la FOTO, no de la pantalla:
 *   { cx, cy, rx, ry }  centro y semiejes, todos entre 0 y 1.
 * La app lo calcula a partir de lo que el usuario ve; aquí solo se comprueba que el rostro detectado quede dentro.
 */

// 1 = el rostro debe caber justo dentro del óvalo. Un poco más de 1 perdona el borde de la caja del detector.
const TOLERANCE = 1.05;
// La altura del rostro debe ser al menos esta fracción de la altura del óvalo (si no, está muy lejos).
const MIN_FACE_RATIO = 0.35;

const isFraction = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n > min && n <= max;

/** Devuelve el guide validado, o null si no se envió (entonces no se comprueba el encuadre). */
function parseGuide(raw) {
  if (raw === undefined || raw === null) return null;
  const ok = raw && typeof raw === 'object'
    && isFraction(raw.cx, 0, 1) && isFraction(raw.cy, 0, 1)
    && isFraction(raw.rx, 0, 1) && isFraction(raw.ry, 0, 1);
  if (!ok) throw new HttpError(400, 'El recuadro guía no es válido');
  return { cx: raw.cx, cy: raw.cy, rx: raw.rx, ry: raw.ry };
}

/**
 * box = [x1, y1, x2, y2] normalizada 0..1 (la del servicio de reconocimiento).
 * -> { ok: true } | { ok: false, reason: 'outside' | 'too_small' }
 */
function checkFaceInGuide(box, guide) {
  if (!guide || !Array.isArray(box) || box.length !== 4) return { ok: true }; // sin datos suficientes: no se bloquea
  const [x1, y1, x2, y2] = box;
  if ((y2 - y1) < MIN_FACE_RATIO * 2 * guide.ry) return { ok: false, reason: 'too_small' };
  const corners = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]];
  const inside = corners.every(([x, y]) => (((x - guide.cx) / guide.rx) ** 2 + ((y - guide.cy) / guide.ry) ** 2) <= TOLERANCE ** 2);
  return inside ? { ok: true } : { ok: false, reason: 'outside' };
}

const GUIDE_MESSAGES = {
  outside: 'Encuadre el rostro dentro del recuadro punteado',
  too_small: 'Acérquese un poco más: el rostro debe llenar el recuadro',
};

module.exports = { parseGuide, checkFaceInGuide, GUIDE_MESSAGES, TOLERANCE, MIN_FACE_RATIO };
