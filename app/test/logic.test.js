const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../src/lib/dates');
const grid = require('../src/lib/grid');
const { describeResult, describeError } = require('../src/lib/scan');

// ---------- fechas ----------

test('la vista previa del calendario coincide con la pantalla de referencia', () => {
  const s = dates.buildSchedule({ start_date: '2026-08-13', weeks: 16 });
  assert.equal(s.length, 16);
  assert.equal(dates.shortLabel(s[0].session_date), '13 ago');
  assert.equal(dates.shortLabel(s[15].session_date), '26 nov');
  assert.equal(dates.weekdayShort(s[0].session_date), 'Ju');
  assert.equal(dates.longLabel('2026-08-13'), 'jueves 13 de agosto de 2026');
});

test('excepciones: cancelar o mover una semana', () => {
  const s = dates.buildSchedule({ start_date: '2026-08-13', weeks: 3, exceptions: [{ week: 2, cancelled: true }, { week: 3, date: '2026-08-28' }] });
  assert.deepEqual(s.map((x) => [x.session_date, x.cancelled, x.moved]),
    [['2026-08-13', false, false], ['2026-08-20', true, false], ['2026-08-28', false, true]]);
});

test('calendario mensual: semana empieza en lunes y rellena huecos', () => {
  const cells = dates.monthCells(2026, 10); // noviembre 2026 empieza en domingo
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.indexOf('2026-11-01'), 6);
  assert.equal(cells.filter(Boolean).length, 30);
  assert.equal(dates.isValidISO('2026-02-30'), false);
});

// ---------- cuadrícula ----------

const sessions = [
  { id: 1, week_number: 1, date: '2026-11-05', editable: true, cancelled: false },
  { id: 2, week_number: 2, date: '2026-11-12', editable: true, cancelled: false },
  { id: 3, week_number: 3, date: '2026-11-19', editable: false, cancelled: false },
];
const samuel = { id: 10, full_name: 'ARIAS YEPES SAMUEL', cells: { 1: { status: 'present', source: 'auto' } } };
const camilo = { id: 11, full_name: 'CASTRO BERRIO CAMILO', cells: {} };
const g = { today: '2026-11-12', sessions, students: [samuel, camilo] };

test('marcar y desmarcar a mano genera cambios pendientes y se cancela al volver al estado original', () => {
  let p = grid.toggle({}, camilo, 2);                      // marcar
  assert.deepEqual(grid.toChanges(p), [{ session_id: 2, student_id: 11, status: 'present' }]);
  assert.equal(grid.isPresent(camilo, 2, p), true);
  p = grid.toggle(p, camilo, 2);                           // desmarcar = vuelve a como estaba en el servidor
  assert.deepEqual(p, {});

  p = grid.toggle({}, samuel, 1);                          // quitar un ✓ que ya estaba guardado
  assert.deepEqual(grid.toChanges(p), [{ session_id: 1, student_id: 10, status: null }]);
  assert.equal(grid.isPresent(samuel, 1, p), false);
});

test('estadísticas: solo cuentan las clases ya dictadas y respetan lo pendiente', () => {
  assert.deepEqual(grid.stats(samuel, sessions), { elapsed: 2, present: 1, absent: 1, pct: 50 });
  assert.deepEqual(grid.stats(camilo, sessions), { elapsed: 2, present: 0, absent: 2, pct: 0 });
  assert.equal(grid.stats(camilo, sessions, grid.toggle({}, camilo, 2)).present, 1);
  assert.equal(grid.stats(camilo, [], {}).pct, null);
});

test('qué clase se escanea: la de hoy; otro día solo en modo pruebas', () => {
  assert.equal(grid.pickScanSession(g).session.id, 2);
  const noClass = { ...g, today: '2026-11-17' };
  assert.equal(grid.pickScanSession(noClass).session, null);
  assert.equal(grid.pickScanSession(noClass, true).session.id, 2);
  assert.equal(grid.nextSession(noClass).id, 3);
});

test('resumen de la clase: presentes y pendientes', () => {
  const sum = grid.sessionSummary(g, 1);
  assert.deepEqual(sum.present.map((s) => s.id), [10]);
  assert.deepEqual(sum.missing.map((s) => s.id), [11]);
  assert.equal(sum.total, 2);
});

// ---------- resultados del escáner ----------

test('asistencia tomada -> modal de éxito con cierre automático', () => {
  const r = describeResult({ status: 'marked', student: samuel, similarity: 0.8 });
  assert.equal(r.kind, 'success');
  assert.equal(r.title, 'Asistencia tomada correctamente');
  assert.equal(r.message, samuel.full_name);
  assert.ok(r.autoCloseMs > 0);
});

test('estudiante no reconocido -> modal de error que NO se cierra sola y ofrece reintentar y marcar a mano', () => {
  const r = describeResult({ status: 'unknown', similarity: 0.3 });
  assert.equal(r.kind, 'error');
  assert.equal(r.autoCloseMs, null);
  assert.deepEqual(r.actions, ['retry', 'manual']);
});

test('sin rostro o varios rostros -> aviso discreto, nunca modal', () => {
  assert.equal(describeResult({ status: 'no_face' }).kind, 'hint');
  assert.equal(describeResult({ status: 'multiple_faces' }).kind, 'hint');
  assert.equal(describeResult({ status: 'ya_presente' }).kind, 'hint');
});

test('ya tenía asistencia -> modal informativa', () => {
  assert.equal(describeResult({ status: 'already_present', student: samuel }).kind, 'info');
});

test('errores de red y de servicio se explican en español claro', () => {
  assert.match(describeError({ status: 0 }).message, /Wi-Fi/);
  assert.match(describeError({ status: 503 }).message, /servicio de reconocimiento/);
  const day = describeError({ status: 409, message: 'Solo se toma asistencia el día de la clase (2026-11-19)' });
  assert.deepEqual(day.actions, []);
  assert.match(day.message, /2026-11-19/);
});
