// Traduce lo que responde el backend a lo que ve el profesor. Es lo que decide cuándo sale la modal pequeña.
//
//   kind 'success' / 'info' / 'error'  -> modal pequeña
//   kind 'hint'                        -> aviso discreto sobre la cámara (sin modal: con el escáner automático
//                                         una modal por cada cuadro sin rostro sería insoportable)

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
        message: 'No coincide con nadie de este grupo. Pídale que mire de frente, se acerque un poco y revise la luz.',
        autoCloseMs: null, cooldownMs: 0, actions: ['retry', 'manual'],
      };
    case 'no_face':
      return { kind: 'hint', message: 'No veo ningún rostro. Enfoque al estudiante de frente.' };
    case 'multiple_faces':
      return { kind: 'hint', message: 'Hay más de una persona. Enfoque a un solo estudiante.' };
    case 'out_of_guide':
      // El rostro se detectó pero no está dentro del recuadro punteado: no se marca nada
      return { kind: 'hint', message: res.message || 'Encuadre el rostro dentro del recuadro punteado.' };
    default:
      return { kind: 'hint', message: 'Respuesta inesperada del servidor.' };
  }
}

/** Errores de red o del servidor (ApiError con status 0 = sin conexión). */
function describeError(err) {
  const status = err?.status ?? 0;
  let message = err?.message || 'Ocurrió un error inesperado.';
  if (status === 0) message = 'No hay conexión con el servidor. Revise que la tablet y el computador estén en la misma red Wi-Fi.';
  if (status === 503) message = 'El servicio de reconocimiento no está disponible. Avise al administrador.';
  if (status === 409) {
    // Reglas de negocio del backend: clase de otro día, cancelada, grupo sin estudiantes...
    return { kind: 'error', title: 'No se puede tomar asistencia ahora', message, autoCloseMs: null, cooldownMs: 0, actions: [] };
  }
  return { kind: 'error', title: 'No se pudo tomar la asistencia', message, autoCloseMs: null, cooldownMs: 0, actions: ['retry'] };
}

module.exports = { describeResult, describeError };
