// Lógica pura de la cuadrícula de asistencia. Casilla marcada (✓) = el estudiante asistió.
// "pending" son los cambios que el profesor hizo a mano y todavía no guardó: { "studentId:sessionId": 'present' | null }

const keyOf = (studentId, sessionId) => `${studentId}:${sessionId}`;

const serverPresent = (student, sessionId) => student.cells?.[sessionId]?.status === 'present';

function isPresent(student, sessionId, pending = {}) {
  const k = keyOf(student.id, sessionId);
  return k in pending ? pending[k] === 'present' : serverPresent(student, sessionId);
}

/** Alterna una casilla. Si el resultado coincide con lo que ya hay en el servidor, el cambio pendiente se descarta. */
function toggle(pending, student, sessionId) {
  const k = keyOf(student.id, sessionId);
  const next = isPresent(student, sessionId, pending) ? null : 'present';
  const original = serverPresent(student, sessionId) ? 'present' : null;
  const copy = { ...pending };
  if (next === original) delete copy[k];
  else copy[k] = next;
  return copy;
}

function toChanges(pending) {
  return Object.entries(pending).map(([k, status]) => {
    const [studentId, sessionId] = k.split(':').map(Number);
    return { session_id: sessionId, student_id: studentId, status };
  });
}

/** Asistencias y faltas de un estudiante contando solo las clases ya dictadas (editable = no futura ni cancelada). */
function stats(student, sessions, pending = {}) {
  const elapsed = sessions.filter((s) => s.editable);
  const present = elapsed.filter((s) => isPresent(student, s.id, pending)).length;
  return {
    elapsed: elapsed.length, present, absent: elapsed.length - present,
    pct: elapsed.length ? Math.round((present / elapsed.length) * 100) : null,
  };
}

/** Qué clase se escanea: la de hoy. Con allowAnyDay (solo pruebas) se permite la última clase ya dictada. */
function pickScanSession(grid, allowAnyDay = false) {
  const todays = grid.sessions.find((s) => s.date === grid.today && !s.cancelled);
  if (todays) return { session: todays, isToday: true };
  if (allowAnyDay) {
    const elapsed = grid.sessions.filter((s) => s.editable);
    if (elapsed.length) return { session: elapsed[elapsed.length - 1], isToday: false };
  }
  return { session: null, isToday: false };
}

/** Próxima clase (para el mensaje "hoy no hay clase"). */
function nextSession(grid) {
  return grid.sessions.find((s) => !s.cancelled && s.date > grid.today) ?? null;
}

function sessionSummary(grid, sessionId, pending = {}) {
  const present = grid.students.filter((s) => isPresent(s, sessionId, pending));
  const missing = grid.students.filter((s) => !isPresent(s, sessionId, pending));
  return { present, missing, total: grid.students.length };
}

module.exports = { keyOf, isPresent, toggle, toChanges, stats, pickScanSession, nextSession, sessionSummary };
