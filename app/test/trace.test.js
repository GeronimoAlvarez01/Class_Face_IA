const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { encodePng, heatmapImage, heatRgb, toBase64 } = require('../src/lib/png');
const T = require('../src/lib/trace');

// ---------- PNG propio: debe ser un PNG válido que cualquier lector abra ----------

function parsePng(bytes) {
  const buf = Buffer.from(bytes);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    assert.equal(buf.readUInt32BE(p + 8 + len), zlib.crc32(buf.subarray(p + 4, p + 8 + len)), `CRC de ${type}`);
    chunks.push([type, data]);
    p += 12 + len;
  }
  return chunks;
}

test('png: IHDR, CRC e IDAT válidos; los píxeles salen idénticos al descomprimir', () => {
  const w = 3; const h = 2;
  const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const chunks = parsePng(encodePng(w, h, rgb));
  assert.deepEqual(chunks.map(([t]) => t), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0][1];
  assert.deepEqual([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]], [3, 2, 8, 2]);
  const raw = zlib.inflateSync(chunks[1][1]);                      // si el Adler-32 o los bloques estuvieran mal, esto lanza
  assert.equal(raw.length, (w * 3 + 1) * h);
  assert.deepEqual([...raw.subarray(1, 10)], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...raw.subarray(11, 20)], [10, 20, 30, 40, 50, 60, 70, 80, 90]);
});

test('png: imágenes grandes (varios bloques de 65535 bytes) también descomprimen bien', () => {
  const w = 300; const h = 300;                                     // 270 300 bytes brutos > 4 bloques
  const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 7) % 256);
  const idat = parsePng(encodePng(w, h, rgb)).find(([t]) => t === 'IDAT')[1];
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, (w * 3 + 1) * h);
  assert.deepEqual([...raw.subarray(1 + (w * 3 + 1) * 299, 4 + (w * 3 + 1) * 299)], [...rgb.subarray(299 * w * 3, 299 * w * 3 + 3)]);
});

test('base64 propio coincide con el de Node (incluido el relleno =)', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'));
  }
});

test('mapa de calor: tamaño = celdas × píxeles, azul negativo, naranja positivo, gris cerca de 0', () => {
  assert.deepEqual(heatRgb(0, 1), [244, 244, 244]);
  assert.deepEqual(heatRgb(1, 1), [224, 110, 20]);
  assert.deepEqual(heatRgb(-5, 1), [36, 86, 229]);                  // satura
  const img = heatmapImage([1, -1, 0, 1, -1, 0], 3, 4);
  assert.deepEqual([img.width, img.height], [12, 8]);
  assert.ok(img.uri.startsWith('data:image/png;base64,'));
  const raw = zlib.inflateSync(parsePng(Buffer.from(img.uri.split(',')[1], 'base64')).find(([t]) => t === 'IDAT')[1]);
  const px = (x, y) => [...raw.subarray(y * (12 * 3 + 1) + 1 + x * 3, y * (12 * 3 + 1) + 4 + x * 3)];
  assert.deepEqual([px(0, 0), px(4, 0), px(8, 0)], [[224, 110, 20], [36, 86, 229], [244, 244, 244]]);
  assert.deepEqual(px(3, 3), px(0, 0));                              // toda la celda del mismo color
});

// ---------- pasos y textos del visor ----------

const stage = (key, name) => ({ key, name, shape: [1], units: 1, mean_abs: 0.1, std: 0.1, active_fraction: 0.5 });
const STAGES = ['conv1', 'stem', 'block35', 'reduction_a', 'block17', 'reduction_b', 'block8', 'avgpool', 'dense'].map((k) => stage(k, k));

const recognizeItem = (over = {}) => ({
  id: 7, kind: 'recognize', faces: 1,
  decision: { status: 'marked', similarity: 0.83, student: { document: '1007074776', full_name: 'ARIAS YEPES SAMUEL' } },
  trace: {
    outcome: 'ok', params: { tau: 0.55, min_margin: 0.05 }, input: { image: 'data:...' },
    detection: { faces: [], faces_counted: 1 }, crop: { size: 160 },
    network: { stages: STAGES, residual: [{ group: 'block35', index: 0, rel_change: 0.2 }, { group: 'block35', index: 1, rel_change: 0.1 }, { group: 'block17', index: 0, rel_change: 0.4 }] },
    comparison: {
      tau: 0.55, min_margin: 0.05, candidates: 3, enrolled: 2, margin: 0.7, match: '1007074776',
      scores: [{ student_id: '1007074776', full_name: 'ARIAS YEPES SAMUEL', similarity: 0.83 }, { student_id: '1152712132', full_name: null, similarity: 0.13 }],
    },
  },
  ...over,
});

test('pasos: foto → detección → recorte → 9 etapas de la red → comparación → decisión', () => {
  const steps = T.buildSteps(recognizeItem());
  assert.deepEqual(steps.map((s) => s.id), ['input', 'detect', 'crop', ...STAGES.map((s) => `net:${s.key}`), 'compare', 'decision']);
  assert.ok(steps.every((s, i) => s.index === i && s.ms > 0));
  assert.ok(steps.filter((s) => s.id.startsWith('net:')).every((s) => s.caption.length > 10));
});

test('pasos: sin rostro termina en la decisión; inscripción termina en "guardar"', () => {
  const noFace = recognizeItem({ faces: 0, decision: { status: 'no_face' } });
  delete noFace.trace.crop; delete noFace.trace.network; delete noFace.trace.comparison;
  assert.deepEqual(T.buildSteps(noFace).map((s) => s.id), ['input', 'detect', 'decision']);

  const enroll = recognizeItem({ kind: 'enroll', decision: { status: 'enrolled' }, context: { full_name: 'NUEVO' } });
  delete enroll.trace.comparison; enroll.trace.storage = { replaced: false };
  assert.deepEqual(T.buildSteps(enroll).slice(-2).map((s) => s.id), ['store', 'decision']);
  assert.deepEqual(T.buildSteps({}), []);
});

test('decisión: texto y tono para cada resultado', () => {
  const d = T.describeDecision(recognizeItem());
  assert.deepEqual([d.tone, d.title, d.student], ['success', 'Asistencia marcada', 'ARIAS YEPES SAMUEL']);
  assert.match(d.detail, /0,83 ≥ umbral τ 0,55/);

  const unknown = recognizeItem({ decision: { status: 'unknown' } });
  unknown.trace.outcome = 'below_threshold'; unknown.trace.comparison.scores = [{ student_id: 'x', similarity: 0.41 }];
  assert.match(T.describeDecision(unknown).detail, /0,41\) no llega al umbral τ 0,55/);
  unknown.trace.outcome = 'ambiguous';
  assert.match(T.describeDecision(unknown).detail, /empatados/);

  assert.equal(T.describeDecision({ decision: { status: 'already_present', student: { full_name: 'A' } } }).tone, 'info');
  assert.equal(T.describeDecision({ decision: { status: 'out_of_guide', message: 'Encuadre' } }).title, 'Rostro fuera del recuadro');
  assert.equal(T.describeDecision({ decision: { status: 'multiple_faces' } }).tone, 'warning');
  assert.equal(T.describeDecision({ decision: { status: 'rejected', message: 'sin rostro' }, context: { full_name: 'B' } }).detail, 'sin rostro');
  assert.equal(T.describeDecision({ decision: { status: 'enrolled' }, trace: { storage: { replaced: true } }, context: {} }).detail, 'Se reemplazó su vector anterior en la galería.');
});

test('similitudes: nombre o documento, mejor primero, umbral y no inscritos', () => {
  const s = T.similarityRows(recognizeItem());
  assert.deepEqual(s.rows.map((r) => [r.name, r.best, r.passes]), [['ARIAS YEPES SAMUEL', true, true], ['1152712132', false, false]]);
  assert.equal(s.tau, 0.55);
  assert.equal(T.notEnrolled(recognizeItem()), 1);
  assert.equal(T.similarityRows({ trace: {} }), null);
  const many = recognizeItem(); many.trace.comparison.scores = Array.from({ length: 12 }, (_, i) => ({ student_id: `d${i}`, similarity: 0.9 - i * 0.05 }));
  assert.deepEqual([T.similarityRows(many).rows.length, T.similarityRows(many).hidden], [8, 4]);
});

test('bloques residuales agrupados, con altura relativa al mayor', () => {
  const g = T.residualGroups(recognizeItem());
  assert.deepEqual(g.map((x) => [x.group, x.bars.length]), [['block35', 2], ['block17', 1]]);
  assert.equal(g[1].bars[0].height, 1);
  assert.equal(g[0].bars[0].height, 0.5);
  assert.deepEqual(T.residualGroups({}), []);
});

test('mergeItems: no repite ids y conserva los más recientes', () => {
  const a = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(T.mergeItems(a, [{ id: 2 }, { id: 3 }]).map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(T.mergeItems(a, [{ id: 3 }, { id: 4 }], 3).map((i) => i.id), [2, 3, 4]);
  assert.equal(T.fmtMs(12.34), '12,3 ms');
  assert.equal(T.fmtMs(250.4), '250 ms');
});
