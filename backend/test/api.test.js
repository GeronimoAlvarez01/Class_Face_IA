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

// JPEG mínimo: el backend solo verifica los bytes mágicos; el rostro lo valida el servicio de reconocimiento
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]).toString('base64');

function fakeRecognition() {
  const fake = {
    calls: { enroll: [], remove: [], recognize: [] },
    failEnroll: null,
    next: { faces: 1, match: null, similarity: 0.3 },
    async enroll(id) {
      if (fake.failEnroll) throw new HttpError(422, fake.failEnroll);
      fake.calls.enroll.push(id);
      return { ok: true };
    },
    async remove(id) {
      fake.calls.remove.push(id);
      return { ok: true };
    },
    async recognize(_img, candidates) {
      fake.calls.recognize.push(candidates);
      return fake.next;
    },
  };
  return fake;
}

async function setup(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asistencia-'));
  const cfg = { ...loadConfig({ DATA_DIR: dataDir }), ...overrides };
  const db = openDb(path.join(dataDir, 'test.db'));
  const recognition = fakeRecognition();
  const clock = { date: '2026-11-17', today() { return this.date; } };
  const server = createApp({ cfg, db, recognition, clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, json: type.includes('json') ? await res.json() : null, res };
  }
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { call, close, recognition, clock, dataDir, db };
}

async function seed(env) {
  const g = (await env.call('POST', '/api/groups', { code: 'ET0018', group_number: '002', name: 'METODOLOGIA DE LA INVESTIGACION', term: '2026-2' })).json;
  const docs = [['1007074776', 'ARIAS YEPES SAMUEL'], ['1152712132', 'CASTRO BERRIO CAMILO ANDRES']];
  const students = [];
  for (const [document, full_name] of docs) {
    const r = await env.call('POST', '/api/students', { document, full_name, consent: true, photo_base64: JPEG_B64, group_ids: [g.id] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    students.push(r.json);
  }
  const sched = await env.call('PUT', `/api/groups/${g.id}/schedule`, { start_date: '2026-08-13', weeks: 16 });
  assert.equal(sched.status, 200);
  return { group: g, students, sessions: sched.json.sessions };
}

test('grupos: crea, arma la etiqueta como en la pantalla y rechaza duplicados', async () => {
  const env = await setup();
  try {
    const r = await env.call('POST', '/api/groups', { code: 'ET0018', group_number: '002', name: 'METODOLOGIA DE LA INVESTIGACION', term: '2026-2' });
    assert.equal(r.status, 201);
    assert.equal(r.json.label, 'Grupo 002 ET0018 - METODOLOGIA DE LA INVESTIGACION');
    const dup = await env.call('POST', '/api/groups', { code: 'ET0018', group_number: '002', name: 'X', term: '2026-2' });
    assert.equal(dup.status, 409);
    assert.equal((await env.call('POST', '/api/groups', { code: 'ET0018' })).status, 400);
  } finally { await env.close(); }
});

test('estudiantes: exige consentimiento y foto válida; si el servicio rechaza la foto no queda nada guardado', async () => {
  const env = await setup();
  try {
    const base = { document: '1007074776', full_name: 'ARIAS YEPES SAMUEL', photo_base64: JPEG_B64 };
    assert.equal((await env.call('POST', '/api/students', { ...base, consent: false })).status, 400);
    assert.equal((await env.call('POST', '/api/students', { ...base, consent: true, photo_base64: Buffer.from('no soy imagen').toString('base64') })).status, 415);
    assert.equal((await env.call('POST', '/api/students', { ...base, consent: true, document: '../etc/passwd' })).status, 400);

    env.recognition.failEnroll = 'No se detectó ningún rostro';
    const bad = await env.call('POST', '/api/students', { ...base, consent: true });
    assert.equal(bad.status, 422);
    assert.match(bad.json.error, /rostro/);
    assert.equal((await env.call('GET', '/api/students')).json.students.length, 0);
    assert.equal(fs.existsSync(path.join(env.dataDir, 'photos', '1007074776.jpg')), false);

    env.recognition.failEnroll = null;
    const ok = await env.call('POST', '/api/students', { ...base, consent: true });
    assert.equal(ok.status, 201);
    assert.deepEqual(env.recognition.calls.enroll, ['1007074776']);
    assert.equal((await env.call('POST', '/api/students', { ...base, consent: true })).status, 409);

    const photo = await env.call('GET', `/api/students/${ok.json.id}/photo`);
    assert.equal(photo.status, 200);
    assert.equal(photo.res.headers.get('content-type'), 'image/jpeg');
  } finally { await env.close(); }
});

test('calendario + cuadrícula: semanas futuras deshabilitadas como en la pantalla de referencia', async () => {
  const env = await setup();
  try {
    const { group } = await seed(env);
    const grid = (await env.call('GET', `/api/groups/${group.id}/grid`)).json;
    assert.equal(grid.sessions.length, 16);
    assert.deepEqual(grid.sessions.filter((s) => !s.editable).map((s) => s.label), ['19 nov', '26 nov']);
    assert.equal(grid.sessions[0].weekday, 'Ju');
    assert.deepEqual(grid.students.map((s) => s.full_name), ['ARIAS YEPES SAMUEL', 'CASTRO BERRIO CAMILO ANDRES']);

    const sched = (await env.call('GET', `/api/groups/${group.id}/schedule`)).json;
    assert.equal(sched.params.start_date, '2026-08-13');
  } finally { await env.close(); }
});

test('reconocimiento: marca presente, evita duplicados, rechaza desconocidos y varios rostros', async () => {
  const env = await setup();
  try {
    const { group, students, sessions } = await seed(env);
    const week14 = sessions.find((s) => s.week_number === 14); // 12 nov
    const url = `/api/sessions/${week14.id}/recognize`;

    // Fuera del día de clase no se permite
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).status, 409);

    env.clock.date = '2026-11-12';
    env.recognition.next = { faces: 1, match: '1007074776', similarity: 0.82 };
    const first = await env.call('POST', url, { image_base64: JPEG_B64 });
    assert.equal(first.json.status, 'marked');
    assert.equal(first.json.student.document, '1007074776');
    // El backend manda al servicio SOLO los estudiantes del grupo
    assert.deepEqual(env.recognition.calls.recognize.at(-1).sort(), ['1007074776', '1152712132']);

    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).json.status, 'already_present');

    env.recognition.next = { faces: 1, match: null, similarity: 0.31 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).json.status, 'unknown');
    env.recognition.next = { faces: 0 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).json.status, 'no_face');
    env.recognition.next = { faces: 2, match: '1152712132', similarity: 0.9 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).json.status, 'multiple_faces');

    // Un match que NO es del grupo se trata como desconocido, aunque el servicio lo devuelva
    env.recognition.next = { faces: 1, match: '9999999999', similarity: 0.95 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64 })).json.status, 'unknown');

    const grid = (await env.call('GET', `/api/groups/${group.id}/grid`)).json;
    const samuel = grid.students.find((s) => s.document === '1007074776');
    const camilo = grid.students.find((s) => s.document === '1152712132');
    assert.equal(samuel.cells[week14.id].status, 'present');
    assert.equal(samuel.cells[week14.id].source, 'auto');
    assert.equal(camilo.cells[week14.id], undefined); // ni multiple_faces ni unknown marcaron nada
    assert.equal(samuel.present_count, 1);
    // Lógica de asistencia: con 14 clases ya dictadas y 1 presente, hay 13 faltas; el que no vino nunca tiene 14
    assert.equal(grid.elapsed_count, 14);
    assert.equal(samuel.absent_count, 13);
    assert.equal(samuel.attendance_pct, 7);
    assert.equal(camilo.absent_count, 14);
    assert.ok(students.length === 2);
  } finally { await env.close(); }
});

test('cuadrícula manual: guarda inasistencias, es atómica y no deja editar semanas futuras', async () => {
  const env = await setup();
  try {
    const { group, students, sessions } = await seed(env);
    const [s1, s2] = students;
    const w1 = sessions[0];
    const future = sessions.find((s) => s.week_number === 15);

    const ok = await env.call('PUT', `/api/groups/${group.id}/grid`, { changes: [
      { session_id: w1.id, student_id: s1.id, status: 'absent' },
      { session_id: w1.id, student_id: s2.id, status: 'present' },
    ] });
    assert.equal(ok.status, 200);

    const bad = await env.call('PUT', `/api/groups/${group.id}/grid`, { changes: [
      { session_id: w1.id, student_id: s1.id, status: 'present' },   // válida...
      { session_id: future.id, student_id: s1.id, status: 'absent' }, // ...pero esta no
    ] });
    assert.equal(bad.status, 422);
    const grid = (await env.call('GET', `/api/groups/${group.id}/grid`)).json;
    assert.equal(grid.students[0].cells[w1.id].status, 'absent'); // la válida tampoco se aplicó

    await env.call('PUT', `/api/groups/${group.id}/grid`, { changes: [{ session_id: w1.id, student_id: s1.id, status: null }] });
    const cleared = (await env.call('GET', `/api/groups/${group.id}/grid`)).json;
    assert.equal(cleared.students[0].cells[w1.id], undefined);
  } finally { await env.close(); }
});

test('calendario: no permite quitar ni cancelar semanas con asistencia registrada', async () => {
  const env = await setup();
  try {
    const { group, students, sessions } = await seed(env);
    await env.call('PUT', `/api/groups/${group.id}/grid`, { changes: [{ session_id: sessions[0].id, student_id: students[0].id, status: 'present' }] });

    const cancel = await env.call('PUT', `/api/groups/${group.id}/schedule`, { start_date: '2026-08-13', weeks: 16, exceptions: [{ week: 1, cancelled: true }] });
    assert.equal(cancel.status, 409);
    assert.deepEqual(cancel.json.details.weeks, [1]);

    const shrink = await env.call('PUT', `/api/groups/${group.id}/schedule`, { start_date: '2026-08-13', weeks: 12 });
    assert.equal(shrink.status, 200); // las semanas 13-16 no tenían asistencia
    assert.equal(shrink.json.sessions.length, 12);

    // Mover una semana con asistencia sí se permite y conserva la asistencia
    const moved = await env.call('PUT', `/api/groups/${group.id}/schedule`, { start_date: '2026-08-13', weeks: 12, exceptions: [{ week: 1, date: '2026-08-14' }] });
    assert.equal(moved.status, 200);
    const grid = (await env.call('GET', `/api/groups/${group.id}/grid`)).json;
    assert.equal(grid.students[0].present_count, 1);
  } finally { await env.close(); }
});

test('eliminar estudiante lo borra también del servicio de reconocimiento y su foto', async () => {
  const env = await setup();
  try {
    const { students } = await seed(env);
    const del = await env.call('DELETE', `/api/students/${students[0].id}`);
    assert.equal(del.status, 200);
    assert.deepEqual(env.recognition.calls.remove, ['1007074776']);
    assert.equal(fs.existsSync(path.join(env.dataDir, 'photos', '1007074776.jpg')), false);
    assert.equal((await env.call('GET', `/api/students/${students[0].id}`)).status, 404);
  } finally { await env.close(); }
});

test('ADMIN_TOKEN: protege /api salvo /api/health', async () => {
  const env = await setup({ adminToken: 'secreto-123' });
  try {
    assert.equal((await env.call('GET', '/api/health')).status, 200);
    assert.equal((await env.call('GET', '/api/groups')).status, 401);
    assert.equal((await env.call('GET', '/api/groups', undefined, { 'x-api-key': 'mala' })).status, 401);
    assert.equal((await env.call('GET', '/api/groups', undefined, { 'x-api-key': 'secreto-123' })).status, 200);
  } finally { await env.close(); }
});

test('cliente HTTP del servicio de reconocimiento respeta el contrato (y devuelve 503 si está caído)', async () => {
  const seen = [];
  const service = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push([req.method, req.url, body]);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/enroll' && body.student_id === 'sinrostro') { res.statusCode = 422; return res.end(JSON.stringify({ detail: 'sin rostro' })); }
      if (req.url === '/recognize') return res.end(JSON.stringify({ faces: 1, match: 'abc12345', similarity: 0.9 }));
      if (req.method === 'DELETE') { res.statusCode = 404; return res.end('{}'); }
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => service.listen(0, '127.0.0.1', r));
  const cfg = loadConfig({ RECOGNITION_URL: `http://127.0.0.1:${service.address().port}` });
  const client = createRecognitionClient(cfg);
  try {
    await client.enroll('abc12345', 'QUJD');
    assert.deepEqual(seen[0], ['POST', '/enroll', { student_id: 'abc12345', image_base64: 'QUJD', replace: true }]);
    await assert.rejects(client.enroll('sinrostro', 'QUJD'), (e) => e.status === 422 && e.message === 'sin rostro');
    assert.deepEqual(await client.recognize('QUJD', ['abc12345']), { faces: 1, match: 'abc12345', similarity: 0.9 });
    assert.deepEqual(await client.remove('nadie'), { ok: true }); // 404 al borrar = ya no existe
  } finally {
    await new Promise((r) => service.close(r));
  }
  await assert.rejects(client.recognize('QUJD', []), (e) => e.status === 503);
});

// ---------- recuadro guía: solo cuenta el rostro que está dentro del óvalo ----------

const GUIDE = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.4 };
const BOX_INSIDE = [0.38, 0.32, 0.62, 0.68];   // rostro centrado y de buen tamaño
const BOX_ASIDE = [0.02, 0.32, 0.26, 0.68];    // rostro pegado al borde izquierdo (fuera del óvalo)
const BOX_FAR = [0.46, 0.46, 0.54, 0.54];      // dentro, pero diminuto (muy lejos)
const BOX_NEAR = [0.1, 0.0, 0.9, 1.0];         // más grande que el óvalo (muy cerca)

test('guía: geometría pura (dentro, fuera, muy pequeño, muy grande, sin datos)', () => {
  const { checkFaceInGuide, parseGuide } = require('../src/guide');
  assert.deepEqual(checkFaceInGuide(BOX_INSIDE, GUIDE), { ok: true });
  assert.deepEqual(checkFaceInGuide(BOX_ASIDE, GUIDE), { ok: false, reason: 'outside' });
  assert.deepEqual(checkFaceInGuide(BOX_FAR, GUIDE), { ok: false, reason: 'too_small' });
  assert.deepEqual(checkFaceInGuide(BOX_NEAR, GUIDE), { ok: false, reason: 'too_big' }); // ni centrado cabría
  // Del mismo tamaño que BOX_INSIDE pero corrido: es de posición, no de distancia
  assert.deepEqual(checkFaceInGuide([0.58, 0.32, 0.82, 0.68], GUIDE), { ok: false, reason: 'outside' });
  // Sin guía o sin caja (modo mock) no se bloquea nada
  assert.deepEqual(checkFaceInGuide(BOX_ASIDE, null), { ok: true });
  assert.deepEqual(checkFaceInGuide(undefined, GUIDE), { ok: true });
  assert.equal(parseGuide(undefined), null);
  assert.throws(() => parseGuide({ cx: 0.5, cy: 0.5, rx: 0, ry: 0.4 }), (e) => e.status === 400);
  assert.throws(() => parseGuide({ cx: 'x', cy: 0.5, rx: 0.3, ry: 0.4 }), (e) => e.status === 400);
});

test('reconocimiento: un rostro fuera del recuadro NO marca asistencia; dentro sí', async () => {
  const env = await setup();
  try {
    const { group, sessions } = await seed(env);
    const week14 = sessions.find((s) => s.week_number === 14);
    env.clock.date = '2026-11-12';
    const url = `/api/sessions/${week14.id}/recognize`;
    const countPresent = () => env.db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE status = 'present'").get().n;

    // El servicio reconocería al estudiante, pero está fuera del óvalo
    env.recognition.next = { faces: 1, match: '1007074776', similarity: 0.9, box: BOX_ASIDE };
    const out = await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE });
    assert.equal(out.json.status, 'out_of_guide');
    assert.equal(out.json.reason, 'outside');
    assert.equal(out.json.message, 'Ubica el rostro en el óvalo');
    assert.equal(countPresent(), 0);

    env.recognition.next = { faces: 1, match: '1007074776', similarity: 0.9, box: BOX_FAR };
    const far = (await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json;
    assert.deepEqual([far.reason, far.message], ['too_small', 'Acércate más']);
    assert.equal(countPresent(), 0);

    env.recognition.next = { faces: 1, match: '1007074776', similarity: 0.9, box: BOX_NEAR };
    const near = (await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json;
    assert.deepEqual([near.status, near.reason, near.message], ['out_of_guide', 'too_big', 'Aléjate un poco']);
    assert.equal(countPresent(), 0);

    env.recognition.next = { faces: 1, match: '1007074776', similarity: 0.9, box: BOX_INSIDE };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'marked');
    assert.equal(countPresent(), 1);

    // Un guide mal formado se rechaza en vez de ignorarse en silencio
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: { cx: 5 } })).status, 400);
    void group;
  } finally { await env.close(); }
});

test('face-check: informa si el rostro está bien encuadrado, sin guardar nada', async () => {
  const env = await setup();
  try {
    const url = '/api/face-check';
    env.recognition.next = { faces: 1, match: null, similarity: 0, box: BOX_INSIDE };
    assert.deepEqual((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json, { status: 'ok' });
    assert.deepEqual(env.recognition.calls.recognize.at(-1), []); // no compara contra nadie

    env.recognition.next = { faces: 1, match: null, similarity: 0, box: BOX_ASIDE };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'out_of_guide');
    env.recognition.next = { faces: 1, match: null, similarity: 0, box: BOX_NEAR };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.message, 'Aléjate un poco');
    env.recognition.next = { faces: 0 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'no_face');
    env.recognition.next = { faces: 2 };
    assert.equal((await env.call('POST', url, { image_base64: JPEG_B64, guide: GUIDE })).json.status, 'multiple_faces');
    assert.equal((await env.call('POST', url, { guide: GUIDE })).status, 400);
    assert.equal((await env.call('GET', '/api/students')).json.students.length, 0);
  } finally { await env.close(); }
});
