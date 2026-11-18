const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL,              -- ET0018
  group_number  TEXT NOT NULL,              -- 002
  name          TEXT NOT NULL,              -- METODOLOGIA DE LA INVESTIGACION
  term          TEXT NOT NULL DEFAULT '',   -- 2026-2
  schedule_json TEXT,                       -- parámetros del calendario (para reabrirlos en la pantalla del Admin 2)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, group_number, term)
);

CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document    TEXT NOT NULL UNIQUE,         -- es también el id del estudiante en el servicio de reconocimiento
  full_name   TEXT NOT NULL,
  photo_path  TEXT NOT NULL,                -- RELATIVA a DATA_DIR (photos/1007074776.jpg)
  consent_at  TEXT NOT NULL,                -- consentimiento de datos biométricos (Ley 1581 de 2012)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_students (
  group_id   INTEGER NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  week_number  INTEGER NOT NULL,
  session_date TEXT NOT NULL,               -- ISO AAAA-MM-DD, sin hora: no depende de la zona horaria del equipo
  cancelled    INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  UNIQUE (group_id, week_number)
);

CREATE TABLE IF NOT EXISTS attendance (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  source     TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  similarity REAL,                          -- solo cuando source = 'auto'
  marked_at  TEXT NOT NULL,
  PRIMARY KEY (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions (group_id, session_date);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // journal_mode DELETE (no WAL): el archivo .db queda autocontenido y se puede copiar entre Mac y Windows
  // o sincronizar sin perder datos (WAL deja datos pendientes en archivos -wal/-shm aparte).
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Ejecuta fn dentro de una transacción: o se aplica todo o no se aplica nada. */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };
