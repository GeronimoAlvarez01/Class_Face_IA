const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule, shortDateLabel, weekdayLabel, todayIn, ValidationError } = require('../src/schedule');

test('reproduce el calendario de la pantalla de referencia (16 jueves desde el 13 ago 2026)', () => {
  const { sessions } = buildSchedule({ start_date: '2026-08-13', weeks: 16 });
  assert.equal(sessions.length, 16);
  const labels = sessions.map((s) => shortDateLabel(s.session_date));
  assert.deepEqual(labels, ['13 ago', '20 ago', '27 ago', '3 sep', '10 sep', '17 sep', '24 sep', '1 oct',
    '8 oct', '15 oct', '22 oct', '29 oct', '5 nov', '12 nov', '19 nov', '26 nov']);
  assert.ok(sessions.every((s) => weekdayLabel(s.session_date) === 'Ju'));
});

test('cancelar una semana conserva la numeración; mover una clase cambia solo su fecha', () => {
  const { sessions } = buildSchedule({
    start_date: '2026-08-13', weeks: 4,
    exceptions: [{ week: 2, cancelled: true }, { week: 3, date: '2026-08-28' }],
  });
  assert.deepEqual(sessions.map((s) => [s.week_number, s.session_date, s.cancelled]), [
    [1, '2026-08-13', false], [2, '2026-08-20', true], [3, '2026-08-28', false], [4, '2026-09-03', false],
  ]);
});

test('rechaza datos inválidos', () => {
  const bad = [
    { start_date: '2026-02-30', weeks: 4 },
    { start_date: '13/08/2026', weeks: 4 },
    { start_date: '2026-08-13', weeks: 0 },
    { start_date: '2026-08-13', weeks: 53 },
    { start_date: '2026-08-13', weeks: 4, exceptions: [{ week: 9, cancelled: true }] },
    { start_date: '2026-08-13', weeks: 4, exceptions: [{ week: 2 }] },
    { start_date: '2026-08-13', weeks: 4, exceptions: [{ week: 2, cancelled: true }, { week: 2, date: '2026-08-21' }] },
    { start_date: '2026-08-13', weeks: 4, exceptions: [{ week: 2, date: '2026-08-13' }] }, // choca con la semana 1
  ];
  for (const input of bad) assert.throws(() => buildSchedule(input), ValidationError, JSON.stringify(input));
});

test('"hoy" respeta la zona horaria de la universidad, no la del servidor', () => {
  // 02:00 UTC del 18 nov ya es 21:00 del 17 nov en Bogotá (UTC-5)
  assert.equal(todayIn('America/Bogota', new Date('2026-11-18T02:00:00Z')), '2026-11-17');
  assert.equal(todayIn('UTC', new Date('2026-11-18T02:00:00Z')), '2026-11-18');
});
