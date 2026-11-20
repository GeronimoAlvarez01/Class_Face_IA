// Lógica pura del "Laboratorio IA": convierte un recorrido (lo que devuelve GET /api/trace) en pasos para animar
// y en textos para el público. Sin React ni red, para poder probarla.
//
// Forma de un item: { id, at, kind: 'recognize'|'enroll', faces, context, decision, trace }
//   trace = { input.image, image, detection, crop?, network?, embedding?, comparison?, storage?, outcome, timings_ms, params }

const STAGE_CAPTIONS = {
  conv1: 'Primera convolución: 32 filtros detectan bordes y contrastes simples en la foto.',
  stem: 'Stem: 6 convoluciones combinan los bordes en texturas y formas (256 canales).',
  block35: 'Block35 ×5: bloques residuales; cada uno solo corrige un poco la representación.',
  reduction_a: 'Reducción A: baja la resolución espacial y sube a 896 canales.',
  block17: 'Block17 ×10: diez bloques residuales sobre 896 canales, ya con rasgos más abstractos.',
  reduction_b: 'Reducción B: la imagen queda en 3×3 posiciones con 1792 canales.',
  block8: 'Block8 ×6: los últimos bloques residuales refinan los rasgos del rostro.',
  avgpool: 'Promedio global: cada uno de los 1792 canales se resume en un solo número.',
  dense: 'Capa densa 1792 → 512: aquí nace el embedding, el «código» numérico de este rostro.',
};

/** Lista ordenada de pasos del recorrido. Termina antes si no hay rostro (no hay nada que pasar por la red). */
function buildSteps(item) {
  const tr = item?.trace;
  if (!tr) return [];
  const steps = [
    { id: 'input', caption: 'La foto llega al servidor (se reduce a 1280 px como máximo).', ms: 800 },
    { id: 'detect', caption: 'MTCNN busca rostros. Solo cuentan los de confianza alta y de tamaño significativo.', ms: 1200 },
  ];
  if (tr.crop) steps.push({ id: 'crop', caption: 'Se recorta el rostro a 160×160 px y se estandarizan los píxeles: (x − 127,5) / 128.', ms: 1100 });
  for (const s of tr.network?.stages ?? []) {
    steps.push({ id: `net:${s.key}`, stage: s.key, caption: STAGE_CAPTIONS[s.key] ?? s.name, ms: 520 });
  }
  if (tr.comparison) {
    steps.push({
      id: 'compare',
      caption: 'Similitud coseno con cada estudiante del grupo (producto punto de vectores de longitud 1) frente al umbral τ.',
      ms: 1800,
    });
  } else if (tr.storage) {
    steps.push({ id: 'store', caption: 'Inscripción: el vector se guarda en la galería. No se reentrena nada.', ms: 1500 });
  }
  steps.push({ id: 'decision', caption: '', ms: 3500 });
  return steps.map((s, i) => ({ ...s, index: i }));
}

const pct = (v) => `${Math.round(v * 100)} %`;
const sim = (v) => v.toFixed(2).replace('.', ',');

/** Qué decidió el sistema, en palabras para quien mira. */
function describeDecision(item) {
  const d = item?.decision ?? {};
  const tr = item?.trace ?? {};
  const best = tr.comparison?.scores?.[0];
  const tau = tr.comparison?.tau ?? tr.params?.tau;
  switch (d.status) {
    case 'marked':
      return { tone: 'success', icon: 'checkmark-circle', title: 'Asistencia marcada', student: d.student?.full_name,
        detail: `Similitud ${sim(d.similarity ?? best?.similarity ?? 0)} ≥ umbral τ ${sim(tau ?? 0)}. Se registró como presente.` };
    case 'already_present':
      return { tone: 'info', icon: 'information-circle', title: 'Ya tenía asistencia', student: d.student?.full_name,
        detail: 'Se reconoció a la persona, pero su asistencia de hoy ya estaba registrada; no se duplica.' };
    case 'unknown': {
      const why = {
        below_threshold: best ? `La mayor similitud (${sim(best.similarity)}) no llega al umbral τ ${sim(tau ?? 0)}.` : 'Ninguna similitud llega al umbral.',
        ambiguous: 'Dos estudiantes quedaron casi empatados; se prefiere no marcar a nadie antes que marcar al equivocado.',
        no_candidates: 'No hay estudiantes inscritos en este grupo con quién comparar.',
      }[tr.outcome] ?? 'No coincide con nadie de este grupo.';
      return { tone: 'danger', icon: 'close-circle', title: 'No se reconoció a la persona', detail: why };
    }
    case 'out_of_guide':
      return { tone: 'warning', icon: 'scan', title: 'Rostro fuera del recuadro',
        detail: d.message || 'El rostro no está dentro del recuadro punteado, así que no se marca nada.' };
    case 'no_face':
      return { tone: 'warning', icon: 'eye-off', title: 'No se detectó ningún rostro', detail: 'No hay nada que pasar por la red neuronal.' };
    case 'multiple_faces':
      return { tone: 'warning', icon: 'people', title: 'Hay más de una persona', detail: 'Con varios rostros no se sabe a quién enfocaron: no se marca nada.' };
    case 'enrolled':
      return { tone: 'success', icon: 'person-add', title: 'Estudiante inscrito', student: item.context?.full_name,
        detail: tr.storage?.replaced ? 'Se reemplazó su vector anterior en la galería.' : 'Su vector de 512 valores quedó guardado en la galería.' };
    case 'rejected':
      return { tone: 'danger', icon: 'close-circle', title: 'Foto rechazada en la inscripción', student: item.context?.full_name,
        detail: d.message || 'La foto no sirve para el reconocimiento.' };
    default:
      return { tone: 'info', icon: 'help-circle', title: 'Resultado desconocido', detail: '' };
  }
}

/** Barras de similitud: mejores primero, con el umbral τ y cuántos quedaron fuera de la lista. */
function similarityRows(item, max = 8) {
  const c = item?.trace?.comparison;
  if (!c) return null;
  const rows = c.scores.map((s, i) => ({
    name: s.full_name || s.student_id, document: s.student_id, similarity: s.similarity,
    best: i === 0, passes: s.similarity >= c.tau,
  }));
  return {
    tau: c.tau, minMargin: c.min_margin, margin: c.margin, candidates: c.candidates, enrolled: c.enrolled,
    rows: rows.slice(0, max), hidden: Math.max(0, rows.length - max), match: c.match,
  };
}

/** Inscripciones/estudiantes del grupo que no tenían embedding guardado (no se pudieron comparar). */
const notEnrolled = (item) => {
  const c = item?.trace?.comparison;
  return c ? Math.max(0, c.candidates - c.enrolled) : 0;
};

/** Barras de los 21 bloques residuales agrupadas (Block35 ×5, Block17 ×10, Block8 ×6), altura relativa al mayor. */
function residualGroups(item) {
  const list = item?.trace?.network?.residual ?? [];
  const max = Math.max(0, ...list.map((r) => r.rel_change)) || 1;
  const groups = [];
  for (const r of list) {
    let g = groups.find((x) => x.group === r.group);
    if (!g) { g = { group: r.group, bars: [] }; groups.push(g); }
    g.bars.push({ index: r.index, value: r.rel_change, height: r.rel_change / max });
  }
  return groups;
}

/** Une los recorridos nuevos a la lista (sin repetir ids) y deja los `max` más recientes. */
function mergeItems(list, incoming, max = 30) {
  const seen = new Set(list.map((i) => i.id));
  const merged = [...list, ...incoming.filter((i) => !seen.has(i.id))];
  return merged.slice(Math.max(0, merged.length - max));
}

const fmtMs = (ms) => (ms == null ? '—' : ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1).replace('.', ',')} ms`);

module.exports = { buildSteps, describeDecision, similarityRows, notEnrolled, residualGroups, mergeItems, fmtMs, STAGE_CAPTIONS, pct, sim };
