// Traduce lo que responde el backend a lo que ve el profesor. Es lo que decide cuándo sale la modal pequeña.
//
//   kind 'success' / 'info' / 'error'  -> modal pequeña
//   kind 'hint'                        -> aviso discreto sobre la cámara (sin modal: con el escáner automático
//                                         una modal por cada cuadro sin rostro sería insoportable)

const PLACE_FACE = 'Ubica el rostro en el óvalo.';
const NO_FACE = 'No veo ningún rostro. Ubica el rostro en el óvalo.';
const MULTIPLE = 'Hay más de una persona. Solo debe verse un rostro.';

/**
 * Escáner automático, fase 1: con la respuesta de /api/face-check decide si ya se puede reconocer.
 *   { ready: true }                    -> el rostro está bien ubicado: se envía esa misma foto a reconocer
 *   { ready: false, message }          -> aviso discreto (acércate, aléjate, ubica el rostro...) y no se reconoce
 */
function describeCheck(res) {
  if (res?.status === 'ok') return { ready: true };
  if (res?.status === 'no_face') return { ready: false, message: NO_FACE };
  if (res?.status === 'multiple_faces') return { ready: false, message: MULTIPLE };
  return { ready: false, message: res?.message || PLACE_FACE };
}

function describeResult(res) {
  switch (res?.status) {
    case 'marked':
      return {
        kind: 'success', title: 'Asistencia tomada correctamente', student: res.student,
        message: res.student.full_name, autoCloseMs: 2400, cooldownMs: 1500, countsAsMark: true,
      };
    case 'already_present':
      return {
        kind: 'info', title: 'Este estudiante ya tiene asistencia', student: res.student,
        message: res.student.full_name, autoCloseMs: 2000, cooldownMs: 1500,
      };
    case 'unknown':
      return {
        kind: 'error', title: 'No se pudo reconocer al estudiante',
        message: 'No coincide con nadie de este grupo. Pídele que mire de frente, se acerque un poco y revisa la luz.',
        autoCloseMs: null, cooldownMs: 0, actions: ['retry', 'manual'],
      };
    case 'no_face':
      return { kind: 'hint', message: NO_FACE };
    case 'multiple_faces':
      return { kind: 'hint', message: MULTIPLE };
    case 'out_of_guide':
      // El rostro se detectó pero no está dentro del óvalo (corrido, muy lejos o muy cerca): no se marca nada
      return { kind: 'hint', message: res.message || PLACE_FACE };
    default:
      return { kind: 'hint', message: 'Respuesta inesperada del servidor.' };
  }
}

/** Errores de red o del servidor (ApiError con status 0 = sin conexión). */
function describeError(err) {
  const status = err?.status ?? 0;
  let message = err?.message || 'Ocurrió un error inesperado.';
  if (status === 0) message = 'No hay conexión con el servidor. Revisa que la tablet y el computador estén en la misma red Wi-Fi.';
  if (status === 503) message = 'El servicio de reconocimiento no está disponible. Avisa al administrador.';
  if (status === 409) {
    // Reglas de negocio del backend: clase de otro día, cancelada, grupo sin estudiantes...
    return { kind: 'error', title: 'No se puede tomar asistencia ahora', message, autoCloseMs: null, cooldownMs: 0, actions: [] };
  }
  return { kind: 'error', title: 'No se pudo tomar la asistencia', message, autoCloseMs: null, cooldownMs: 0, actions: ['retry'] };
}

// ---------- Marcar manualmente: búsqueda por documento ----------

// Un documento: 4 a 20 letras o números (como exige el backend) y al menos un número, para no confundirlo con un nombre
const DOCUMENT_QUERY = /^(?=.*\d)[A-Za-z0-9]{4,20}$/;
const isDocumentQuery = (q) => DOCUMENT_QUERY.test(String(q ?? '').trim());

/** Estudiante con ese documento exacto (sin distinguir mayúsculas), o null. */
function findByDocument(students, doc) {
  const d = String(doc ?? '').trim().toUpperCase();
  return (students ?? []).find((s) => String(s.document).toUpperCase() === d) ?? null;
}

module.exports = {
  describeCheck, describeResult, describeError, PLACE_FACE, NO_FACE, MULTIPLE, isDocumentQuery, findByDocument,
};
