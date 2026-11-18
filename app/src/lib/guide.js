// Recuadro guía (el óvalo punteado de la cámara). La MISMA fórmula dibuja el óvalo en pantalla y calcula
// dónde cae dentro de la foto que se envía al servidor, así que lo que el usuario ve es lo que se valida.

const GUIDE_HEIGHT = 0.72;       // alto del óvalo = 72 % del alto de la vista
const GUIDE_ASPECT = 0.78;       // ancho / alto del óvalo
const GUIDE_MAX_WIDTH = 0.92;    // en pantallas verticales no debe pasar del ancho de la vista

/** Tamaño del óvalo en píxeles de pantalla, dado el tamaño de la vista de cámara. */
function ovalSize(viewWidth, viewHeight) {
  let h = GUIDE_HEIGHT * viewHeight;
  let w = h * GUIDE_ASPECT;
  if (w > GUIDE_MAX_WIDTH * viewWidth) {
    w = GUIDE_MAX_WIDTH * viewWidth;
    h = w / GUIDE_ASPECT;
  }
  return { w, h };
}

/**
 * Convierte el óvalo de pantalla en fracciones de la FOTO: { cx, cy, rx, ry }.
 * La vista previa llena la pantalla recortando lo que sobra ("cover"), por eso se escala con el mayor de los dos factores.
 * El óvalo está centrado, así que su centro cae siempre en el centro de la foto.
 * Devuelve undefined si faltan medidas (el servidor entonces no comprueba el encuadre).
 */
function computeGuide(view, photo) {
  if (!view?.width || !view?.height || !photo?.width || !photo?.height) return undefined;
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const { w, h } = ovalSize(view.width, view.height);
  return {
    cx: 0.5,
    cy: 0.5,
    rx: Math.min(1, w / 2 / scale / photo.width),
    ry: Math.min(1, h / 2 / scale / photo.height),
  };
}

module.exports = { GUIDE_HEIGHT, GUIDE_ASPECT, GUIDE_MAX_WIDTH, ovalSize, computeGuide };
