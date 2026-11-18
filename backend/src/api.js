const fs = require('node:fs');
const path = require('node:path');
const { Router, HttpError, created, binary } = require('./http');
const { tx } = require('./db');
const { ValidationError, buildSchedule, weekdayLabel, shortDateLabel } = require('./schedule');
const { parseGuide, checkFaceInGuide, GUIDE_MESSAGES } = require('./guide');

const DOC_RE = /^[A-Za-z0-9]{4,20}$/;
const STATUSES = new Set(['present', 'absent']);

// ---------- validación ----------

function text(value, field, { max = 120, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new HttpError(400, `Falta el campo "${field}"`);
  }
  if (typeof value !== 'string') throw new HttpError(400, `"${field}" debe ser texto`);
  const t = value.trim();
  if (!t) throw new HttpError(400, `Falta el campo "${field}"`);
  if (t.length > max) throw new HttpError(400, `"${field}" supera ${max} caracteres`);
  return t;
}

function toId(value, what = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${what} inválido`);
  return n;
}

/** Decodifica una imagen base64 y verifica por sus primeros bytes que sea JPEG o PNG (no confiamos en la extensión). */
function decodeImage(value, field) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, `Falta el campo "${field}"`);
  const b64 = value.replace(/^data:image\/[a-z+]+;base64,/i, '');
  const buf = Buffer.from(b64, 'base64');
  let ext = null;
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.length > 8 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ext = 'png';
  if (!ext) throw new HttpError(415, 'La imagen debe ser JPEG o PNG');
  return { buf, b64, ext };
}

const groupLabel = (g) => `Grupo ${g.group_number} ${g.code} - ${g.name}`;

function buildApi({ db, cfg, recognition, clock }) {
  const router = new Router();
  const photosDir = path.join(cfg.dataDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  // ---------- helpers de acceso a datos ----------

  const getGroup = (id) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(toId(id, 'id de grupo'));
    if (!g) throw new HttpError(404, 'Grupo no encontrado');
    return g;
  };
  const getStudent = (id) => {
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(toId(id, 'id de estudiante'));
    if (!s) throw new HttpError(404, 'Estudiante no encontrado');
    return s;
  };
  const groupView = (g) => ({
    id: g.id, code: g.code, group_number: g.group_number, name: g.name, term: g.term, label: groupLabel(g),
    student_count: db.prepare('SELECT COUNT(*) AS n FROM group_students WHERE group_id = ?').get(g.id).n,
    session_count: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE group_id = ?').get(g.id).n,
  });
  const studentView = (s) => ({
    id: s.id, document: s.document, full_name: s.full_name, photo_url: `/api/students/${s.id}/photo`,
    consent_at: s.consent_at,
  });
  const conflictOr = (err, message) => {
    if (String(err?.message).includes('UNIQUE')) throw new HttpError(409, message);
    throw err;
  };

  /** Guarda la foto de inscripción (la que se ve con "Ver Foto"). Devuelve la ruta relativa para la base de datos. */
  function savePhoto(document, img) {
    const rel = `photos/${document}.${img.ext}`;
    for (const ext of ['jpg', 'png']) {
      if (ext !== img.ext) fs.rmSync(path.join(cfg.dataDir, `photos/${document}.${ext}`), { force: true });
    }
    fs.writeFileSync(path.join(cfg.dataDir, rel), img.buf);
    return rel;
  }

  // ---------- salud ----------

  router.add('GET', '/api/health', () => ({
    ok: true, today: clock.today(), recognition: cfg.recognitionMode, allow_any_day: cfg.allowAnyDay,
  }));

  // =====================================================================
  // ADMIN 1 · Grupos y estudiantes
  // =====================================================================

  router.add('GET', '/api/groups', () => ({
    groups: db.prepare('SELECT * FROM groups ORDER BY code, group_number').all().map(groupView),
  }));

  router.add('POST', '/api/groups', ({ body }) => {
    try {
      const info = db.prepare('INSERT INTO groups (code, group_number, name, term) VALUES (?, ?, ?, ?)').run(
        text(body.code, 'code', { max: 30 }), text(body.group_number, 'group_number', { max: 10 }),
        text(body.name, 'name'), text(body.term, 'term', { max: 20, optional: true }) ?? '');
      return created(groupView(getGroup(info.lastInsertRowid)));
    } catch (err) {
      return conflictOr(err, 'Ya existe ese grupo para ese periodo');
    }
  });

  router.add('GET', '/api/groups/:id', ({ params }) => groupView(getGroup(params.id)));

  router.add('PUT', '/api/groups/:id', ({ params, body }) => {
    const g = getGroup(params.id);
    try {
      db.prepare('UPDATE groups SET code = ?, group_number = ?, name = ?, term = ? WHERE id = ?').run(
        text(body.code, 'code', { max: 30, optional: true }) ?? g.code,
        text(body.group_number, 'group_number', { max: 10, optional: true }) ?? g.group_number,
        text(body.name, 'name', { optional: true }) ?? g.name,
        text(body.term, 'term', { max: 20, optional: true }) ?? g.term, g.id);
    } catch (err) {
      conflictOr(err, 'Ya existe ese grupo para ese periodo');
    }
    return groupView(getGroup(g.id));
  });

  router.add('DELETE', '/api/groups/:id', ({ params }) => {
    const g = getGroup(params.id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id); // borra en cascada sesiones, asistencia y matrículas
    return { ok: true };
  });

  router.add('GET', '/api/students', ({ query }) => {
    const rows = query.group_id
      ? db.prepare(`SELECT s.* FROM students s JOIN group_students gs ON gs.student_id = s.id
                    WHERE gs.group_id = ? ORDER BY s.full_name`).all(toId(query.group_id, 'group_id'))
      : db.prepare('SELECT * FROM students ORDER BY full_name').all();
    return { students: rows.map(studentView) };
  });

  /**
   * Crea un estudiante: valida que la foto tenga UN rostro, guarda su embedding en el servicio de reconocimiento
   * (instantáneo, sin reentrenar) y recién entonces guarda la fila. Si falla algo, deshace lo anterior.
   */
  router.add('POST', '/api/students', async ({ body }) => {
    const document = text(body.document, 'document', { max: 20 });
    if (!DOC_RE.test(document)) throw new HttpError(400, 'El documento debe ser alfanumérico de 4 a 20 caracteres');
    const fullName = text(body.full_name, 'full_name');
    if (body.consent !== true) {
      throw new HttpError(400, 'Se requiere el consentimiento para tratar datos biométricos (consent: true)');
    }
    const img = decodeImage(body.photo_base64, 'photo_base64');
    const groupIds = (Array.isArray(body.group_ids) ? body.group_ids : []).map((v) => toId(v, 'group_ids'));
    for (const gid of groupIds) getGroup(gid);
    if (db.prepare('SELECT 1 FROM students WHERE document = ?').get(document)) {
      throw new HttpError(409, 'Ya existe un estudiante con ese documento');
    }

    await recognition.enroll(document, img.b64);
    const rel = savePhoto(document, img);
    try {
      const id = tx(db, () => {
        const info = db.prepare('INSERT INTO students (document, full_name, photo_path, consent_at) VALUES (?, ?, ?, ?)')
          .run(document, fullName, rel, new Date().toISOString());
        const sid = Number(info.lastInsertRowid);
        for (const gid of groupIds) db.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)').run(gid, sid);
        return sid;
      });
      return created(studentView(getStudent(id)));
    } catch (err) {
      await recognition.remove(document).catch(() => {});
      fs.rmSync(path.join(cfg.dataDir, rel), { force: true });
      throw err;
    }
  });

  router.add('GET', '/api/students/:id', ({ params }) => {
    const s = getStudent(params.id);
    const groups = db.prepare(`SELECT g.* FROM groups g JOIN group_students gs ON gs.group_id = g.id
                               WHERE gs.student_id = ? ORDER BY g.code`).all(s.id).map(groupView);
    return { ...studentView(s), groups };
  });

  router.add('GET', '/api/students/:id/photo', ({ params }) => {
    const s = getStudent(params.id);
    const file = path.join(cfg.dataDir, s.photo_path);
    if (!fs.existsSync(file)) throw new HttpError(404, 'La foto no está disponible');
    return binary(fs.readFileSync(file), file.endsWith('.png') ? 'image/png' : 'image/jpeg');
  });

  router.add('PUT', '/api/students/:id', async ({ params, body }) => {
    const s = getStudent(params.id);
    const fullName = text(body.full_name, 'full_name', { optional: true }) ?? s.full_name;
    let rel = s.photo_path;
    if (body.photo_base64) {
      const img = decodeImage(body.photo_base64, 'photo_base64');
      await recognition.enroll(s.document, img.b64); // reemplaza el embedding anterior
      rel = savePhoto(s.document, img);
    }
    db.prepare('UPDATE students SET full_name = ?, photo_path = ? WHERE id = ?').run(fullName, rel, s.id);
    return studentView(getStudent(s.id));
  });

  router.add('DELETE', '/api/students/:id', async ({ params }) => {
    const s = getStudent(params.id);
    // Primero el servicio: si quedara el embedding de alguien ya borrado, sería un dato biométrico huérfano
    await recognition.remove(s.document);
    db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    fs.rmSync(path.join(cfg.dataDir, s.photo_path), { force: true });
    return { ok: true };
  });

  router.add('POST', '/api/groups/:gid/students/:sid', ({ params }) => {
    const g = getGroup(params.gid);
    const s = getStudent(params.sid);
    db.prepare('INSERT OR IGNORE INTO group_students (group_id, student_id) VALUES (?, ?)').run(g.id, s.id);
    return created({ ok: true });
  });

  router.add('DELETE', '/api/groups/:gid/students/:sid', ({ params }) => {
    const g = getGroup(params.gid);
    const s = getStudent(params.sid);
    tx(db, () => {
      db.prepare(`DELETE FROM attendance WHERE student_id = ? AND session_id IN (SELECT id FROM sessions WHERE group_id = ?)`).run(s.id, g.id);
      db.prepare('DELETE FROM group_students WHERE group_id = ? AND student_id = ?').run(g.id, s.id);
    });
    return { ok: true };
  });

  // =====================================================================
  // ADMIN 2 · Parametrización de días y fechas de clase
  // =====================================================================

  const sessionsView = (groupId) => {
    const today = clock.today();
    return db.prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY week_number').all(groupId).map((s) => ({
      id: s.id, week_number: s.week_number, date: s.session_date, weekday: weekdayLabel(s.session_date),
      label: shortDateLabel(s.session_date), cancelled: s.cancelled === 1,
      // Igual que en la pantalla de referencia: las semanas futuras salen deshabilitadas
      editable: s.cancelled === 0 && s.session_date <= today,
    }));
  };

  router.add('GET', '/api/groups/:id/schedule', ({ params }) => {
    const g = getGroup(params.id);
    return { group_id: g.id, params: g.schedule_json ? JSON.parse(g.schedule_json) : null, sessions: sessionsView(g.id) };
  });

  router.add('PUT', '/api/groups/:id/schedule', ({ params, body }) => {
    const g = getGroup(params.id);
    let plan;
    try {
      plan = buildSchedule(body);
    } catch (err) {
      if (err instanceof ValidationError) throw new HttpError(422, err.message);
      throw err;
    }

    const hasAttendance = db.prepare('SELECT 1 FROM attendance WHERE session_id = ?');
    const existing = db.prepare('SELECT * FROM sessions WHERE group_id = ?').all(g.id);
    const planned = new Map(plan.sessions.map((s) => [s.week_number, s]));
    const toDelete = existing.filter((s) => !planned.has(s.week_number));
    const newlyCancelled = existing.filter((s) => planned.get(s.week_number)?.cancelled && s.cancelled === 0);
    const blocked = [...toDelete, ...newlyCancelled].filter((s) => hasAttendance.get(s.id));
    if (blocked.length) {
      throw new HttpError(409, 'No se pueden quitar ni cancelar semanas que ya tienen asistencia registrada',
        { weeks: blocked.map((s) => s.week_number) });
    }

    tx(db, () => {
      for (const s of toDelete) db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      const upsert = db.prepare(`INSERT INTO sessions (group_id, week_number, session_date, cancelled) VALUES (?, ?, ?, ?)
        ON CONFLICT (group_id, week_number) DO UPDATE SET session_date = excluded.session_date, cancelled = excluded.cancelled`);
      for (const s of plan.sessions) upsert.run(g.id, s.week_number, s.session_date, s.cancelled ? 1 : 0);
      db.prepare('UPDATE groups SET schedule_json = ? WHERE id = ?').run(JSON.stringify(plan.params), g.id);
    });
    return { group_id: g.id, params: plan.params, sessions: sessionsView(g.id) };
  });

  // =====================================================================
  // Cuadrícula de asistencia (la pantalla "Control de inasistencias")
  // =====================================================================

  router.add('GET', '/api/groups/:id/grid', ({ params }) => {
    const g = getGroup(params.id);
    const sessions = sessionsView(g.id);
    const students = db.prepare(`SELECT s.* FROM students s JOIN group_students gs ON gs.student_id = s.id
                                 WHERE gs.group_id = ? ORDER BY s.full_name`).all(g.id);
    const rows = db.prepare(`SELECT a.* FROM attendance a JOIN sessions se ON se.id = a.session_id
                             WHERE se.group_id = ?`).all(g.id);
    const byStudent = new Map();
    for (const a of rows) {
      if (!byStudent.has(a.student_id)) byStudent.set(a.student_id, {});
      byStudent.get(a.student_id)[a.session_id] = { status: a.status, source: a.source, similarity: a.similarity };
    }
    // Lógica de ASISTENCIA: casilla marcada = asistió. Una clase ya dictada sin marca cuenta como falta.
    const elapsed = sessions.filter((s) => s.editable).map((s) => s.id);
    return {
      group: { id: g.id, label: groupLabel(g) },
      today: clock.today(),
      elapsed_count: elapsed.length,
      sessions,
      students: students.map((s, i) => {
        const cells = byStudent.get(s.id) ?? {};
        const present = elapsed.filter((id) => cells[id]?.status === 'present').length;
        return {
          index: i + 1, ...studentView(s), cells,
          present_count: present,
          absent_count: elapsed.length - present,
          attendance_pct: elapsed.length ? Math.round((present / elapsed.length) * 100) : null,
        };
      }),
    };
  });

  /** Guardado manual de la cuadrícula. Es atómico: si una celda es inválida no se guarda ninguna. */
  router.add('PUT', '/api/groups/:id/grid', ({ params, body }) => {
    const g = getGroup(params.id);
    if (!Array.isArray(body.changes) || body.changes.length === 0) throw new HttpError(400, 'Falta la lista "changes"');
    const sessions = new Map(sessionsView(g.id).map((s) => [s.id, s]));
    const members = new Set(db.prepare('SELECT student_id FROM group_students WHERE group_id = ?').all(g.id).map((r) => r.student_id));

    const errors = [];
    body.changes.forEach((c, index) => {
      const s = sessions.get(c?.session_id);
      if (!s) errors.push({ index, error: 'La sesión no pertenece al grupo' });
      else if (!s.editable) errors.push({ index, error: `La semana ${s.week_number} no se puede editar (futura o cancelada)` });
      if (!members.has(c?.student_id)) errors.push({ index, error: 'El estudiante no pertenece al grupo' });
      if (c?.status !== null && !STATUSES.has(c?.status)) errors.push({ index, error: 'status debe ser "present", "absent" o null' });
    });
    if (errors.length) throw new HttpError(422, 'Hay celdas inválidas; no se guardó nada', errors);

    const now = new Date().toISOString();
    tx(db, () => {
      for (const c of body.changes) {
        if (c.status === null) {
          db.prepare('DELETE FROM attendance WHERE session_id = ? AND student_id = ?').run(c.session_id, c.student_id);
        } else {
          db.prepare(`INSERT INTO attendance (session_id, student_id, status, source, similarity, marked_at)
                      VALUES (?, ?, ?, 'manual', NULL, ?)
                      ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status,
                        source = 'manual', similarity = NULL, marked_at = excluded.marked_at`)
            .run(c.session_id, c.student_id, c.status, now);
        }
      }
    });
    return { updated: body.changes.length };
  });

  // =====================================================================
  // Asistencia automática: el profesor enfoca al estudiante con la cámara
  // =====================================================================

  router.add('POST', '/api/sessions/:id/recognize', async ({ params, body }) => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(toId(params.id, 'id de sesión'));
    if (!session) throw new HttpError(404, 'Sesión no encontrada');
    if (session.cancelled) throw new HttpError(409, 'Esa clase fue cancelada');
    if (!cfg.allowAnyDay && session.session_date !== clock.today()) {
      throw new HttpError(409, `Solo se toma asistencia el día de la clase (${session.session_date})`);
    }
    const img = decodeImage(body.image_base64, 'image_base64');
    const guide = cfg.faceGuide === false ? null : parseGuide(body.guide); // recuadro punteado que ve el profesor; opcional
    const members = db.prepare(`SELECT s.* FROM students s JOIN group_students gs ON gs.student_id = s.id
                                WHERE gs.group_id = ?`).all(session.group_id);
    if (members.length === 0) throw new HttpError(409, 'El grupo no tiene estudiantes matriculados');

    const result = await recognition.recognize(img.b64, members.map((m) => m.document));
    const similarity = result.similarity ?? null;
    if (!result.faces) return { status: 'no_face', message: 'No se detectó ningún rostro' };
    // Con varios rostros no sabemos a cuál se enfocó: no se marca nada (una falsa asistencia es peor que repetir la foto)
    if (result.faces > 1) return { status: 'multiple_faces', message: 'Aparece más de una persona; enfoque a un solo estudiante' };
    // Solo cuenta el rostro que está dentro del recuadro: se comprueba ANTES de buscar al estudiante o marcar nada
    const fit = checkFaceInGuide(result.box, guide);
    if (!fit.ok) return { status: 'out_of_guide', reason: fit.reason, message: GUIDE_MESSAGES[fit.reason] };

    const student = members.find((m) => m.document === result.match);
    if (!student) return { status: 'unknown', similarity };

    const previous = db.prepare('SELECT status FROM attendance WHERE session_id = ? AND student_id = ?').get(session.id, student.id);
    if (previous?.status === 'present') {
      return { status: 'already_present', student: studentView(student), similarity };
    }
    db.prepare(`INSERT INTO attendance (session_id, student_id, status, source, similarity, marked_at)
                VALUES (?, ?, 'present', 'auto', ?, ?)
                ON CONFLICT (session_id, student_id) DO UPDATE SET status = 'present', source = 'auto',
                  similarity = excluded.similarity, marked_at = excluded.marked_at`)
      .run(session.id, student.id, similarity, new Date().toISOString());
    return { status: 'marked', student: studentView(student), similarity, ...(result.mock ? { mock: true } : {}) };
  });

  // =====================================================================
  // Comprobación de rostro (sin guardar nada): la usa la app al registrar a un estudiante para tomar la foto
  // sola en cuanto el rostro está bien encuadrado.
  // =====================================================================

  router.add('POST', '/api/face-check', async ({ body }) => {
    const img = decodeImage(body.image_base64, 'image_base64');
    const guide = cfg.faceGuide === false ? null : parseGuide(body.guide);
    const result = await recognition.recognize(img.b64, []);
    if (!result.faces) return { status: 'no_face', message: 'No se detectó ningún rostro' };
    if (result.faces > 1) return { status: 'multiple_faces', message: 'Aparece más de una persona; debe verse un solo rostro' };
    const fit = checkFaceInGuide(result.box, guide);
    if (!fit.ok) return { status: 'out_of_guide', reason: fit.reason, message: GUIDE_MESSAGES[fit.reason] };
    return { status: 'ok' };
  });

  return router;
}

module.exports = { buildApi };
