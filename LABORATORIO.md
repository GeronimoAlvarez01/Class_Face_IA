# Laboratorio IA — ver el recorrido de una foto en vivo

Pestaña **Laboratorio** de la app: dibuja, en otra pantalla, cómo viaja una foto desde que se toma
(inscripción o reconocimiento) hasta la decisión: detección del rostro, recorte, bloques de la red
neuronal FaceNet con mapas de activación reales, capa densa 1792→512, comparación con el grupo y
resultado (asistencia marcada, desconocido, fuera del recuadro, estudiante inscrito).

Es una herramienta de **demostración**: está apagada por defecto y no cambia ningún resultado del sistema.

## Cómo encenderla

Hay que activar `DEMO_TRACE=1` en los **dos** servidores (si falta en uno, la pestaña no aparece o sale vacía).

```bash
# 1. Servicio de reconocimiento (Python)
cd recognition
DEMO_TRACE=1 uvicorn server:app --host 127.0.0.1 --port 8001

# 2. Backend (Node)
cd backend
DEMO_TRACE=1 ADMIN_TOKEN=<clave> npm start

# 3. Pantalla de la demo (portátil / proyector)
cd app
npx expo start --web
```

### En Windows (PowerShell)

Abran **una ventana de PowerShell por cada servidor**. La variable solo vale en esa ventana.

```powershell
# 1. Servicio de reconocimiento (Python)
cd recognition
.venv\Scripts\Activate.ps1        # solo si usan el entorno virtual del proyecto
$env:DEMO_TRACE = "1"
uvicorn server:app --host 127.0.0.1 --port 8001

# 2. Backend (Node)
cd backend
$env:DEMO_TRACE = "1"
$env:ADMIN_TOKEN = "<clave>"
npm start

# 3. Pantalla de la demo
cd app
npx expo start --web
```

En `cmd` (no PowerShell) la variable se pone así: `set DEMO_TRACE=1`.

Para que la tablet llegue al backend, averigüen la IP del equipo con `ipconfig` (línea "Dirección IPv4")
y permitan el puerto 3000 en el firewall (PowerShell como administrador):

```powershell
New-NetFirewallRule -DisplayName "Asistencia backend" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Luego, en la app del portátil: **Ajustes** → URL del servidor (`http://<ip-del-backend>:3000`) y token.
La pestaña **Laboratorio** aparece sola cuando `/api/health` informa `demo_trace: true`.
La tablet (o el celular de tu compañero) sigue usando la app normal contra el mismo backend.

Variable opcional del backend: `TRACE_BUFFER` (cuántos recorridos guarda en memoria, 20 por defecto).

## Cómo se usa

| Control | Qué hace |
|---|---|
| **En vivo** | anima el recorrido apenas llega la foto |
| **Paso a paso** | se queda en el paso actual; ← → avanzan o retroceden |
| Velocidad (Lento / Normal / Rápido) | ritmo del modo En vivo |
| Historial (parte inferior) | toque en un recorrido para repetirlo |
| Teclado | Espacio cambia de modo · ← → pasos · R repite |

Si llega un recorrido nuevo mientras se ve otro en modo Paso a paso, aparece el aviso **Ver el nuevo**.
Solo se muestran los recorridos donde se detectó al menos un rostro.

## Qué muestra cada bloque

1. **Foto recibida**: la imagen, con la caja del rostro y el óvalo guía.
2. **Detección (MTCNN)**: rostros encontrados (confianza ≥ 0,95) y cuál se eligió.
3. **Recorte**: 160×160 px normalizado a [−1, 1], lo que realmente entra a la red.
4. **Red FaceNet (congelada)**: nueve etapas con tamaño del tensor y % de activación, lupa con los 6
   canales más activos y barras de cuánto corrige cada uno de los 21 bloques residuales.
5. **1792 → 512**: mapas de calor de la entrada y del embedding (azul negativo, naranja positivo).
6. **Comparación**: similitud coseno con cada persona del grupo, umbral τ y ventaja sobre el segundo.
7. **Decisión**: resultado y tiempos (detección, red, comparación).

## Privacidad y seguridad

- El recorrido incluye **la foto y el nombre** del estudiante: es dato personal. Se guarda solo en memoria,
  nunca en disco ni en la base de datos, y se pierde al reiniciar.
- `GET /api/trace` está detrás de `ADMIN_TOKEN` como el resto de `/api`. Úsenlo siempre en una red compartida.
- Las respuestas que recibe la app de asistencia **no** llevan el trace. El cliente solo puede pedir que
  se apague (`"trace": false`), nunca encenderlo: lo decide el servidor.
- El escaneo automático de la guía facial (`/api/face-check`) no genera trace.
- Apáguenlo después de la presentación (quitar `DEMO_TRACE`).

## Endpoint (por si quieren probarlo a mano)

```
GET /api/trace                    -> { demo, last_id, items: [] }       (fija el cursor)
GET /api/trace?since=N&faces=1    -> recorridos con id > N, del más viejo al más nuevo (máx. 5)
```

El visor consulta cada 400 ms con el último `id` recibido (polling; no hay WebSocket).

## Pruebas

```bash
cd recognition && python -m pytest tests   # trace del servicio (netprobe necesita torch)
cd backend     && npm test                 # almacén y endpoint /api/trace
cd app         && npm test                 # PNG de mapas de calor y pasos del visor
```
