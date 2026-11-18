// Mismo cálculo de calendario que el backend (schedule.js): fechas ISO "AAAA-MM-DD" y aritmética en UTC,
// así la vista previa que ve el administrador coincide exactamente con lo que se guarda.

const DAY_SHORT = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const DAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTH_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function parseISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Fecha inválida "${s}"`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`La fecha "${s}" no existe`);
  return d;
}

const isValidISO = (s) => {
  try { parseISO(s); return true; } catch { return false; }
};

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayShort = (iso) => DAY_SHORT[parseISO(iso).getUTCDay()];
const weekdayLong = (iso) => DAY_LONG[parseISO(iso).getUTCDay()];
const shortLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}`;
const longLabel = (iso) => `${weekdayLong(iso)} ${Number(iso.slice(8, 10))} de ${MONTH_LONG[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const monthTitle = (year, month0) => `${MONTH_LONG[month0]} ${year}`;
const toISO = (year, month0, day) => `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Celdas de un mes para el calendario: null = hueco; semana empieza en lunes. */
function monthCells(year, month0) {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(toISO(year, month0, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Vista previa del calendario: una clase por semana, el mismo día de la semana que start_date. */
function buildSchedule({ start_date, weeks, exceptions = [] }) {
  parseISO(start_date);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new Error('Las semanas deben estar entre 1 y 52');
  const byWeek = new Map(exceptions.map((e) => [e.week, e]));
  return Array.from({ length: weeks }, (_, i) => {
    const week = i + 1;
    const ex = byWeek.get(week);
    return {
      week_number: week,
      session_date: ex?.date ?? addDays(start_date, 7 * i),
      cancelled: ex?.cancelled === true,
      moved: Boolean(ex?.date),
    };
  });
}

module.exports = {
  parseISO, isValidISO, addDays, weekdayShort, weekdayLong, shortLabel, longLabel, monthTitle, monthCells, toISO,
  buildSchedule, DAY_SHORT, MONTH_LONG,
};
