const test = require('node:test');
const assert = require('node:assert/strict');
const { faceStatus, createFaceTracker, toServerBox, STABLE_FRAMES } = require('../src/lib/faceGate');
const { checkFaceInGuide } = require('../src/lib/guide');

const GUIDE = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.4 };
// Cajas de BlazeFace (más bajas y sin frente que las de MTCNN), en fracciones del cuadro
const CENTERED = [0.38, 0.4, 0.62, 0.7];
const FAR = [0.47, 0.5, 0.53, 0.56];
const NEAR = [0.15, 0.25, 0.85, 1.0];
const ASIDE = [0.0, 0.4, 0.24, 0.7];

test('óvalo (app): misma geometría que el servidor', () => {
  assert.deepEqual(checkFaceInGuide([0.38, 0.32, 0.62, 0.68], GUIDE), { ok: true });
  assert.deepEqual(checkFaceInGuide([0.02, 0.32, 0.26, 0.68], GUIDE), { ok: false, reason: 'outside' });
  assert.deepEqual(checkFaceInGuide([0.46, 0.46, 0.54, 0.54], GUIDE), { ok: false, reason: 'too_small' });
  assert.deepEqual(checkFaceInGuide([0.1, 0.0, 0.9, 1.0], GUIDE), { ok: false, reason: 'too_big' });
  assert.deepEqual(checkFaceInGuide([0.1, 0.0, 0.9, 1.0], undefined), { ok: true }); // sin medidas no se bloquea
});

test('detector local: la caja de BlazeFace se lleva a la forma de la de MTCNN (más alta y más arriba)', () => {
  const [x1, y1, x2, y2] = toServerBox(CENTERED);
  assert.deepEqual([x1, x2], [CENTERED[0], CENTERED[2]]);
  assert.ok(y2 - y1 > CENTERED[3] - CENTERED[1]);
  assert.ok((y1 + y2) / 2 < (CENTERED[1] + CENTERED[3]) / 2);
});

test('detector local: aviso según dónde está el rostro', () => {
  assert.equal(faceStatus([CENTERED], GUIDE).status, 'ok');
  assert.deepEqual(faceStatus([], GUIDE), { status: 'no_face', message: 'No veo ningún rostro. Ubica el rostro en el óvalo.' });
  assert.deepEqual(faceStatus([FAR], GUIDE), { status: 'too_small', message: 'Acércate más.' });
  assert.deepEqual(faceStatus([NEAR], GUIDE), { status: 'too_big', message: 'Aléjate un poco.' });
  assert.deepEqual(faceStatus([ASIDE], GUIDE), { status: 'outside', message: 'Ubica el rostro en el óvalo.' });
  assert.equal(faceStatus([CENTERED, [0.05, 0.1, 0.25, 0.34]], GUIDE).status, 'multiple_faces');
  // Una cara diminuta al fondo no cuenta como otra persona (igual que el servidor)
  assert.equal(faceStatus([CENTERED, [0.05, 0.05, 0.08, 0.09]], GUIDE).status, 'ok');
});

test('detector local: solo se dispara tras varios cuadros seguidos bien ubicados', () => {
  const track = createFaceTracker();
  const ok = { status: 'ok', message: 'Mantén el rostro quieto.' };
  for (let i = 1; i < STABLE_FRAMES; i++) assert.equal(track(ok).ready, false);
  assert.equal(track(ok).ready, true);
  // Si se mueve, vuelve a empezar
  assert.equal(track({ status: 'outside', message: 'x' }).ready, false);
  assert.equal(track(ok).ready, false);
});
