class ValidationError extends Error {}

const DAY_ES = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const MONTH_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Todas las fechas son cadenas ISO "AAAA-MM-DD" y la aritmética se hace en UTC.
 * Así el calendario sale idéntico en Mac, Windows y la tablet sin importar su zona horaria.
 */
function parseISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`Fecha inválida "${s}" (use AAAA-MM-DD)`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ValidationError(`La fecha "${s}" no existe`);
  }
  return d;
}

function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayLabel = (iso) => DAY_ES[parseISODate(iso).getUTCDay()];
const shortDateLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTH_ES[Number(iso.slice(5, 7)) - 1]}`;

/** "Hoy" en la zona horaria de la universidad, no la del servidor. */
function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Calendario de un grupo: una clase por semana, el mismo día de la semana que start_date.
 * `exceptions` permite cancelar una semana (festivo) o moverla a otra fecha, conservando su número de semana:
 *   [{ week: 9, cancelled: true }, { week: 6, date: '2026-09-18' }]
 */
function buildSchedule(input) {
  const { start_date, weeks, exceptions = [] } = input || {};
  parseISODate(start_date);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new ValidationError('"weeks" debe ser un entero entre 1 y 52');
  }
  if (!Array.isArray(exceptions)) throw new ValidationError('"exceptions" debe ser una lista');

  const byWeek = new Map();
  for (const ex of exceptions) {
    if (!ex || !Number.isInteger(ex.week) || ex.week < 1 || ex.week > weeks) {
      throw new ValidationError(`Excepción con semana fuera de rango (1-${weeks})`);
    }
    if (byWeek.has(ex.week)) throw new ValidationError(`La semana ${ex.week} tiene dos excepciones`);
    const cancelled = ex.cancelled === true;
    if (ex.date !== undefined) parseISODate(ex.date);
    if (!cancelled && ex.date === undefined) {
      throw new ValidationError(`La excepción de la semana ${ex.week} debe cancelar la clase o moverla a una fecha`);
    }
    byWeek.set(ex.week, { week: ex.week, cancelled, date: ex.date });
  }

  const sessions = [];
  for (let week = 1; week <= weeks; week += 1) {
    const ex = byWeek.get(week);
    sessions.push({
      week_number: week,
      session_date: ex?.date ?? addDays(start_date, 7 * (week - 1)),
      cancelled: ex?.cancelled === true,
    });
  }

  const seen = new Map();
  for (const s of sessions.filter((x) => !x.cancelled)) {
    if (seen.has(s.session_date)) {
      throw new ValidationError(`Las semanas ${seen.get(s.session_date)} y ${s.week_number} caen el mismo día (${s.session_date})`);
    }
    seen.set(s.session_date, s.week_number);
  }

  return {
    params: { start_date, weeks, exceptions: [...byWeek.values()].map(({ week, cancelled, date }) => ({ week, cancelled, ...(date ? { date } : {}) })) },
    sessions,
  };
}

module.exports = { ValidationError, parseISODate, addDays, weekdayLabel, shortDateLabel, todayIn, buildSchedule };
