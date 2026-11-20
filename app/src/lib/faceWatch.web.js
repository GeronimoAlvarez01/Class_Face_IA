// Detector de rostros EN EL NAVEGADOR (MediaPipe, modelo BlazeFace). Mira la vista previa de la cámara sin tomar
// fotos y avisa cuándo el rostro está bien ubicado en el óvalo. Si no carga (sin internet, navegador sin WebAssembly),
// avisa con null y la pantalla vuelve al método anterior (revisar el encuadre en el servidor).
//
// MediaPipe se carga desde el CDN al abrir la cámara (no se empaqueta): su código usa un import() dinámico que
// Metro no acepta. La versión está fija y el wasm sale de la misma versión.
import { computeGuide } from './guide';
import { createFaceTracker, faceStatus } from './faceGate';

const VERSION = '1.2.2';
const LIB_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const EVERY_MS = 150;

let loading = null;
// import() nativo del navegador, fuera del alcance de Metro
const importModule = new Function('url', 'return import(url)');
let lastTs = 0; // MediaPipe exige marcas de tiempo crecientes, también entre una pantalla y otra

function loadDetector() {
  if (!loading) {
    loading = (async () => {
      const { FaceDetector, FilesetResolver } = await importModule(LIB_URL);
      const files = await FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate) => FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.7,
      });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })().catch((err) => {
      console.warn('Detector de rostros no disponible; se usa la revisión en el servidor.', err);
      loading = null; // se reintenta la próxima vez que se abra la cámara
      return null;
    });
  }
  return loading;
}

/**
 * Empieza a vigilar la cámara del contenedor `containerId`. onChange recibe:
 *   { status: 'loading', ready: false, message }  mientras carga el modelo
 *   { status, message, ready }                    cada vez que cambia (ready = se puede tomar la foto)
 *   null                                          si el detector no está disponible
 * Devuelve la función para detenerlo.
 */
export function startFaceWatch({ containerId, getLayout, onChange }) {
  let stopped = false;
  let timer = null;
  let lastKey = '';
  const track = createFaceTracker();

  onChange({ status: 'loading', ready: false, message: 'Preparando la cámara…' });
  loadDetector().then((detector) => {
    if (stopped) return;
    if (!detector) { onChange(null); return; }
    timer = setInterval(() => {
      const video = document.getElementById(containerId)?.querySelector('video');
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      lastTs = Math.max(performance.now(), lastTs + 1);
      let result;
      try {
        result = detector.detectForVideo(video, lastTs);
      } catch (err) {
        console.warn('El detector de rostros falló; se usa la revisión en el servidor.', err);
        clearInterval(timer);
        onChange(null);
        return;
      }
      const W = video.videoWidth;
      const H = video.videoHeight;
      const boxes = result.detections.map(({ boundingBox: b }) => [b.originX / W, b.originY / H, (b.originX + b.width) / W, (b.originY + b.height) / H]);
      const s = track(faceStatus(boxes, computeGuide(getLayout(), { width: W, height: H })));
      const key = `${s.status}|${s.ready}`;
      if (key !== lastKey) {
        lastKey = key;
        onChange(s);
      }
    }, EVERY_MS);
  });

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
