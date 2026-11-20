# Class Face IA — asistencia automática por reconocimiento facial

El docente toma una foto del estudiante con la tablet; el sistema detecta el rostro, lo compara con los
estudiantes inscritos en el grupo y marca la asistencia de la sesión del día.

```
App (Expo / React Native)  ──HTTP──▶  Backend (Node)  ──HTTP──▶  Reconocimiento (Python)
 tablet · celular · web               :3000 · SQLite             :8001 · MTCNN + FaceNet
```

| Carpeta | Qué es | Tecnologías |
|---|---|---|
| `recognition/` | Servicio de reconocimiento: detecta el rostro y genera/compara embeddings | Python 3.12, Starlette + Uvicorn, PyTorch, facenet-pytorch |
| `backend/` | API de grupos, estudiantes, calendario y asistencia | Node.js ≥ 22.5 (sin dependencias: `node:sqlite`, `node:test`) |
| `app/` | Aplicación para la tablet / web | Expo SDK 58, React Native 0.88, expo-camera |

## Cómo funciona el reconocimiento

1. **Detección (MTCNN)**: rostros con confianza ≥ 0,95. Las caras mucho más pequeñas que la principal
   (< 35 % del área, p. ej. alguien al fondo) no cuentan. Debe haber exactamente un rostro.
2. **Embedding (FaceNet, InceptionResnetV1 preentrenada en VGGFace2)**: recorte de 160×160 px →
   vector de 512 dimensiones normalizado (L2).
3. **Comparación 1:N**: similitud coseno solo contra los estudiantes del grupo. Se marca asistencia si la
   mejor similitud es ≥ **τ = 0,55** y supera a la segunda por al menos **0,05**; si no, el resultado es
   "desconocido".

Sobre τ: en pares 1:1 de LFW el umbral calibrado fue 0,42. En producción se usa 0,55 porque al comparar
contra N estudiantes el riesgo de falsa aceptación crece con N; preferimos no marcar a nadie antes que
marcar al equivocado.

## Puesta en marcha

### 1. Servicio de reconocimiento (Python)

```bash
cd recognition
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install facenet-pytorch --no-deps   # aparte, para que no cambie la versión de torch
uvicorn server:app --host 127.0.0.1 --port 8001
```

Pesos del modelo: si existe `recognition/weights/facenet_vggface2.pt` (el que guardó el notebook) se usa ese;
si no, facenet-pytorch descarga los de VGGFace2 la primera vez. Los `.pt` no se suben a git.

Variables opcionales: `TAU`, `MIN_MARGIN`, `WEIGHTS_PATH`, `DATA_DIR`, `MAX_IMAGE_MB`, `DEMO_TRACE`.

### 2. Backend (Node)

```bash
cd backend
npm start          # o npm run dev (recarga al guardar)
```

Se configura con `backend/.env` (no se sube a git):

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `ADMIN_TOKEN` | vacío | Clave que la app envía en `x-api-key`. **Defínala** si la red es compartida |
| `RECOGNITION_MODE` | `http` | `http` = servicio Python real · `mock` = simulado, solo para desarrollar la app |
| `RECOGNITION_URL` | `http://127.0.0.1:8001` | Dirección del servicio Python |
| `TIMEZONE` | `America/Bogota` | Zona horaria para saber qué sesión es "hoy" |
| `ALLOW_ANY_DAY` | `false` | `true` permite tomar asistencia cualquier día (pruebas) |
| `FACE_GUIDE` | `true` | Solo cuenta el rostro dentro del recuadro guía |
| `DEMO_TRACE` | apagado | Modo demo del Laboratorio IA |

La base de datos y las fotos quedan en `backend/data/` (no se sube a git).

### 3. App

```bash
cd app
npm install
npx expo start          # o: npx expo start --web
```

En **Ajustes** de la app se configura la URL del backend (`http://<ip-del-equipo>:3000`) y la clave.
APK de Android: `eas build -p android --profile preview`.

## Pruebas

```bash
cd recognition && pip install pytest && python -m pytest tests
cd backend     && npm test
cd app         && npm test
```

## Laboratorio IA

Visor en vivo del recorrido de una foto por la red (detección, recorte, bloques de FaceNet, embedding,
comparación y decisión). Ver [LABORATORIO.md](LABORATORIO.md).

## Privacidad

Las fotos y los embeddings son datos biométricos (Ley 1581 de 2012). El sistema registra el consentimiento
de cada estudiante al inscribirlo; la API se protege con `ADMIN_TOKEN`.
