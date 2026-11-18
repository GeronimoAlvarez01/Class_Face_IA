const { HttpError } = require('./http');

/**
 * Cliente del servicio de reconocimiento (Python/FastAPI, Parte 3). CONTRATO:
 *   POST   /enroll        { student_id, image_base64, replace }        -> 200 { ok: true } | 422 { detail }
 *   DELETE /students/{id}                                              -> 200 | 404
 *   POST   /recognize     { image_base64, candidate_ids: [..] }        -> 200 { faces, match: id|null, similarity, box }
 * `candidate_ids` restringe la comparación a los estudiantes del grupo: menos candidatos = menos falsas asistencias.
 * `box` = [x1, y1, x2, y2] normalizada 0..1 del rostro único (o null). Con candidate_ids = [] solo detecta el rostro.
 */
function createRecognitionClient(cfg, fetchImpl = globalThis.fetch) {
  if (cfg.recognitionMode === 'mock') return createMockClient();

  const base = cfg.recognitionUrl.replace(/\/+$/, '');

  async function call(method, pathname, payload) {
    let res;
    try {
      res = await fetchImpl(base + pathname, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(cfg.recognitionTimeoutMs),
      });
    } catch {
      throw new HttpError(503, 'El servicio de reconocimiento no está disponible');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* respuesta sin cuerpo */
    }
    if (res.status === 422) {
      const detail = typeof data?.detail === 'string' ? data.detail : 'La foto no sirve para el reconocimiento';
      throw new HttpError(422, detail);
    }
    if (method === 'DELETE' && res.status === 404) return { ok: true };
    if (!res.ok) throw new HttpError(502, 'Error en el servicio de reconocimiento', { status: res.status });
    return data ?? {};
  }

  return {
    enroll: (document, imageBase64) => call('POST', '/enroll', { student_id: document, image_base64: imageBase64, replace: true }),
    remove: (document) => call('DELETE', `/students/${encodeURIComponent(document)}`),
    recognize: (imageBase64, candidateIds) => call('POST', '/recognize', { image_base64: imageBase64, candidate_ids: candidateIds }),
  };
}

/** SOLO para desarrollar la app antes de tener el servicio real: "reconoce" siempre al primer candidato. */
function createMockClient() {
  const enrolled = new Set();
  return {
    async enroll(document) {
      enrolled.add(document);
      return { ok: true };
    },
    async remove(document) {
      enrolled.delete(document);
      return { ok: true };
    },
    async recognize(_image, candidateIds) {
      const match = candidateIds.find((id) => enrolled.has(id)) ?? null;
      return { faces: 1, match, similarity: match ? 0.99 : 0, mock: true };
    },
  };
}

module.exports = { createRecognitionClient };
