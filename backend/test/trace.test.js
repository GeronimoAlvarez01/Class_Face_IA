const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createRecognitionClient } = require('../src/recognition');
const { HttpError } = require('../src/http');
const { TraceStore } = require('../src/trace');

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]).toString('base64');
const GUIDE = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.4 };
const BOX_INSIDE = [0.38, 0.32, 0.62, 0.68];
const BOX_ASIDE = [0.02, 0.32, 0.26, 0.68];

/** Doble del servicio de reconocimiento: devuelve un `trace` como el de Python (solo lo que el backend usa). */
function fakeRecognition() {
  const fake = {
    calls: { enroll: [], recognize: [] },
    next: { faces: 1, match: null, similarity: 0.3 },
    failEnroll: null,
    async enroll(id) {
      if (fake.failEnroll) {
        const err = new HttpError(422, fake.failEnroll);
        err.trace = { kind: 'enroll', outcome: 'no_face', detection: { faces: [], faces_counted: 0 } };
        throw err;
      }
      fake.calls.enroll.push(id);
      return { ok: true, faces: 1, trace: { kind: 'enroll', outcome: 'stored', detection: { faces_counted: 1 }, storage: { student_id: id } } };
    },
    async remove() { return { ok: true }; },
    async recognize(_img, candidates, opts) {
      fake.calls.recognize.push({ candidates, opts });
      return fake.next;
    },
  };
  return fake;
}

/** Respuesta del servicio para un reconocimiento con 2 candidatos (misma forma que recognition/app/main.py). */
function recognizeResult(match, sims, box = BOX_INSIDE) {
  const scores = Object.entries(sims).map(([student_id, similarity]) => ({ student_id, similarity }));
  return {
    faces: 1, match, similarity: scores[0]?.similarity ?? 0, box,
    trace: { kind: 'recognize', outcome: match ? 'ok' : 'below_threshold', detection: { faces_counted: 1 },
      comparison: { tau: 0.55, min_margin: 0.05, candidates: scores.length, enrolled: scores.length, scores, match } },
  };
}

async function setup(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistencia-trace-'));
  const cfg = loadConfig({ DATA_DIR: dataDir, ...env });
  const db = openDb(path.join(dataDir, 'test.db'));
  const recognition = fakeRecognition();
  const clock = { today: () => '2026-11-12' };
  const server = createApp({ cfg, db, recognition, clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { call, close, recognition };
}

async function seed(env) {
  const g = (await env.call('POST', '/api/groups', { code: 'ET0018', group_number: '002', name: 'METODOLOGIA', term: '2026-2' })).json;
  for (const [document, full_name] of [['1007074776', 'ARIAS YEPES SAMUEL'], ['1152712132', 'CASTRO BERRIO CAMILO ANDRES']]) {
    const r = await env.call('POST', '/api/students', { document, full_name, consent: true, photo_base64: JPEG_B64, group_ids: [g.id] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  const sched = await env.call('PUT', `/api/groups/${g.id}/schedule`, { start_date: '2026-08-13', weeks: 16 });
  const session = sched.json.sessions.find((s) => s.week_number === 14);
  return { group: g, url: `/api/sessions/${session.id}/recognize` };
}

test('TraceStore: ids consecutivos, anillo con tope, cursor y filtro de cuadros sin rostro', () => {
  const store = new TraceStore(3);
  for (let i = 1; i <= 5; i += 1) store.add({ kind: 'recognize', faces: i % 2 });   // faces: 1,0,1,0,1
  const all = store.since(0, { limit: 10 });
  assert.deepEqual(all.items.map((i) => i.id), [3, 4, 5]);                         // solo quedan los 3 últimos
  assert.equal(all.lastId, 5);
  assert.deepEqual(store.since(4).items.map((i) => i.id), [5]);
  assert.deepEqual(store.since(5).items, []);
  assert.deepEqual(store.since(0, { onlyFaces: true, limit: 10 }).items.map((i) => i.id), [3, 5]);
  assert.deepEqual(store.since(0, { limit: 2 }).items.map((i) => i.id), [4, 5]);   // con exceso, los más recientes
});

test('sin DEMO_TRACE: no se guarda nada y el endpoint lo dice', async () => {
  const env = await setup();
  try {
    const { url } = await seed(env);
    env.recognition.next = recognizeResult('1007074776', { 1007074776: 0.9, 1152712132: 0.1 });
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'marked');
    assert.deepEqual((await env.call('GET', '/api/trace?since=0')).json, { demo: false, last_id: 0, items: [] });
    assert.equal((await env.call('GET', '/api/health')).json.demo_trace, false);
  } finally { await env.close(); }
});

test('DEMO_TRACE: reconocimiento guarda el recorrido con nombres y decisión; el cursor evita repetidos', async () => {
  const env = await setup({ DEMO_TRACE: '1' });
  try {
    const { url } = await seed(env);
    assert.equal((await env.call('GET', '/api/health')).json.demo_trace, true);
    // Sin `since` solo se fija el cursor (el visor no repite lo viejo al abrirse); las 2 inscripciones ya están guardadas
    const first = (await env.call('GET', '/api/trace')).json;
    assert.deepEqual([first.demo, first.items.length, first.last_id], [true, 0, 2]);

    env.recognition.next = recognizeResult('1007074776', { 1007074776: 0.88, 1152712132: 0.12 });
    const out = await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE });
    assert.equal(out.json.status, 'marked');
    assert.equal(out.json.trace, undefined);                                        // el trace nunca viaja en la respuesta de la app

    const poll = (await env.call('GET', `/api/trace?since=${first.last_id}`)).json;
    assert.equal(poll.items.length, 1);
    const item = poll.items[0];
    assert.equal(item.kind, 'recognize');
    assert.equal(item.decision.status, 'marked');
    assert.equal(item.decision.student.full_name, 'ARIAS YEPES SAMUEL');
    assert.deepEqual(item.decision.guide, { ...GUIDE, ok: true });
    assert.match(item.context.group, /ET0018/);
    assert.deepEqual(item.trace.comparison.scores.map((s) => [s.student_id, s.full_name]),
      [['1007074776', 'ARIAS YEPES SAMUEL'], ['1152712132', 'CASTRO BERRIO CAMILO ANDRES']]);
    assert.equal((await env.call('GET', `/api/trace?since=${poll.last_id}`)).json.items.length, 0);   // ya visto

    // Otra vez el mismo estudiante: la decisión de Node es "ya tiene asistencia"
    await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE });
    const again = (await env.call('GET', `/api/trace?since=${poll.last_id}`)).json.items[0];
    assert.equal(again.decision.status, 'already_present');
  } finally { await env.close(); }
});

test('DEMO_TRACE: inscripciones (éxito y rechazo), fuera del recuadro, cuadros sin rostro y face-check', async () => {
  const env = await setup({ DEMO_TRACE: '1' });
  try {
    const { group, url } = await seed(env);
    const enrolled = (await env.call('GET', '/api/trace?since=0&limit=20')).json.items;
    assert.deepEqual(enrolled.map((i) => [i.kind, i.decision.status, i.context.document]),
      [['enroll', 'enrolled', '1007074776'], ['enroll', 'enrolled', '1152712132']]);
    assert.equal(enrolled[0].context.full_name, 'ARIAS YEPES SAMUEL');
    let last = (await env.call('GET', '/api/trace')).json.last_id;

    // Foto rechazada: queda el recorrido (para mostrar por qué) pero la respuesta de la API no lo filtra
    env.recognition.failEnroll = 'No se detectó ningún rostro';
    const bad = await env.call('POST', '/api/students', { document: '9999999999', full_name: 'SIN ROSTRO', consent: true, photo_base64: JPEG_B64, group_ids: [group.id] });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.json), ['error']);
    env.recognition.failEnroll = null;
    let items = (await env.call('GET', `/api/trace?since=${last}`)).json.items;
    assert.deepEqual([items[0].kind, items[0].decision.status, items[0].faces], ['enroll', 'rejected', 0]);
    last = (await env.call('GET', '/api/trace')).json.last_id;

    // Rostro reconocido pero fuera del recuadro: Node lo bloquea y el trace lo refleja
    env.recognition.next = recognizeResult('1007074776', { 1007074776: 0.9, 1152712132: 0.1 }, BOX_ASIDE);
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'out_of_guide');
    // Cuadro sin rostro
    env.recognition.next = { faces: 0, trace: { kind: 'recognize', outcome: 'no_face', detection: { faces_counted: 0 } } };
    await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE });

    items = (await env.call('GET', `/api/trace?since=${last}&limit=20`)).json.items;
    assert.deepEqual(items.map((i) => i.decision.status), ['out_of_guide', 'no_face']);
    assert.deepEqual([items[0].decision.guide.ok, items[0].decision.guide.reason], [false, 'outside']);
    assert.deepEqual((await env.call('GET', `/api/trace?since=${last}&faces=1`)).json.items.map((i) => i.decision.status), ['out_of_guide']);
    last = (await env.call('GET', '/api/trace')).json.last_id;

    // face-check no es un reconocimiento: pide `trace:false` y no deja recorrido
    env.recognition.next = { faces: 1, match: null, similarity: 0, box: BOX_INSIDE };
    assert.equal((await env.call('POST', '/api/face-check', { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'ok');
    assert.deepEqual(env.recognition.calls.recognize.at(-1).opts, { trace: false });
    assert.equal((await env.call('GET', '/api/trace')).json.last_id, last);

    assert.equal((await env.call('GET', '/api/trace?since=abc')).status, 400);
  } finally { await env.close(); }
});

test('cliente HTTP: pide trace solo en modo demo y conserva el trace de una inscripción rechazada', async () => {
  const seen = [];
  const service = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push([req.url, body]);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/enroll' && body.student_id === 'sinrostro') {
        res.statusCode = 422;
        return res.end(JSON.stringify({ detail: 'sin rostro', trace: { outcome: 'no_face' } }));
      }
      return res.end(JSON.stringify({ faces: 1, match: null, similarity: 0, ok: true }));
    });
  });
  await new Promise((r) => service.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${service.address().port}`;
  try {
    const demo = createRecognitionClient(loadConfig({ RECOGNITION_URL: url, DEMO_TRACE: '1' }));
    await demo.enroll('abc12345', 'QUJD');
    await demo.recognize('QUJD', ['abc12345']);
    await demo.recognize('QUJD', [], { trace: false });
    assert.equal(seen[0][1].trace, true);
    assert.equal(seen[1][1].trace, true);
    assert.equal(seen[2][1].trace, false);
    await assert.rejects(demo.enroll('sinrostro', 'QUJD'), (e) => e.status === 422 && e.message === 'sin rostro'
      && e.trace.outcome === 'no_face' && e.details === undefined);

    seen.length = 0;
    const plain = createRecognitionClient(loadConfig({ RECOGNITION_URL: url }));      // demo apagado: contrato idéntico al de antes
    await plain.enroll('abc12345', 'QUJD');
    await plain.recognize('QUJD', ['abc12345']);
    assert.ok(seen.every(([, body]) => !('trace' in body)));
  } finally {
    await new Promise((r) => service.close(r));
  }
});
