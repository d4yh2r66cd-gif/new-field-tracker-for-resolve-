const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { SITE_TYPES } = require("./templates");

const FILE = process.env.DB_FILE || path.join(__dirname, "data", "fieldtrack.db");
fs.mkdirSync(path.dirname(FILE), { recursive: true });

const db = new Database(FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Every table below carries org_id. Nothing is ever queried without it —
// that column is the boundary between one organisation and the next.
db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  join_code   TEXT UNIQUE NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'tech',  -- owner | lead | tech | officer
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  site_type   TEXT NOT NULL DEFAULT 'general',
  location    TEXT,
  client      TEXT,
  start_date  TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | on_hold | complete
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  make            TEXT,
  model           TEXT,
  serial          TEXT,
  installed_on    TEXT,
  last_service    TEXT,
  service_days    INTEGER,        -- service interval in days
  calibration_due TEXT,
  notes           TEXT,
  checked         INTEGER NOT NULL DEFAULT 0,  -- verified present & working, independent of service/calibration dates
  checked_at      TEXT,
  checked_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The commissioning checklist belongs to a piece of equipment, not the site —
-- a site with five machines has five independent checklists.
CREATE TABLE IF NOT EXISTS equipment_stages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  name          TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  done_at       TEXT,
  done_by       TEXT,
  UNIQUE (equipment_id, idx)
);

CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  entry_date  TEXT NOT NULL,
  work        TEXT NOT NULL,
  crew        INTEGER,
  hours       REAL,
  severity    TEXT NOT NULL DEFAULT 'none',  -- none | watch | blocker
  issue       TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  log_id     INTEGER REFERENCES logs(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  equipment_id  INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  taken_on      TEXT NOT NULL,
  param         TEXT NOT NULL,
  value         REAL,
  unit          TEXT,
  flagged       INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  report_date TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_recipients (
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ack_at      TEXT,
  ack_comment TEXT,
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE IF NOT EXISTS site_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  accent      TEXT NOT NULL DEFAULT 'general',
  stages      TEXT NOT NULL,           -- JSON array of stage names
  readings    TEXT NOT NULL DEFAULT '[]',  -- JSON array of {key,label,unit,min,max}
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_site_types_org ON site_types(org_id);
CREATE INDEX IF NOT EXISTS idx_sites_org      ON sites(org_id);
CREATE INDEX IF NOT EXISTS idx_logs_org_date  ON logs(org_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_readings_site  ON readings(site_id, taken_on DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_site ON equipment(site_id);
CREATE INDEX IF NOT EXISTS idx_equipment_stages_equip ON equipment_stages(equipment_id);
`);

// Databases created before the equipment checkbox existed won't have these columns yet.
const equipCols = db.prepare("PRAGMA table_info(equipment)").all().map((c) => c.name);
if (!equipCols.includes("checked")) {
  db.exec(`
    ALTER TABLE equipment ADD COLUMN checked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE equipment ADD COLUMN checked_at TEXT;
    ALTER TABLE equipment ADD COLUMN checked_by TEXT;
  `);
}

/* ---------------------------------------------------------------- */
/*  Site types — the built-ins from templates.js, plus whatever      */
/*  each organisation has defined for itself.                        */
/* ---------------------------------------------------------------- */

function customType(orgId, key) {
  const row = db
    .prepare("SELECT label, accent, stages, readings FROM site_types WHERE org_id = ? AND key = ?")
    .get(orgId, key);
  if (!row) return null;
  return { label: row.label, accent: row.accent, stages: JSON.parse(row.stages), readings: JSON.parse(row.readings) };
}

function typeOf(orgId, key) {
  return SITE_TYPES[key] || customType(orgId, key) || SITE_TYPES.general;
}

function typeExists(orgId, key) {
  return Boolean(SITE_TYPES[key]) ||
    Boolean(db.prepare("SELECT 1 FROM site_types WHERE org_id = ? AND key = ?").get(orgId, key));
}

// A reading is flagged when its site type declares a range and the value falls outside it.
function outOfRange(orgId, siteType, key, value) {
  const def = typeOf(orgId, siteType).readings.find((r) => r.key === key);
  if (!def || value == null) return false;
  if (def.min != null && value < def.min) return true;
  if (def.max != null && value > def.max) return true;
  return false;
}

function listSiteTypes(orgId) {
  const builtins = Object.entries(SITE_TYPES).map(([key, t]) => ({
    key, label: t.label, accent: t.accent, stages: t.stages, readings: t.readings,
    equipment: t.equipment || [],
  }));
  const customs = db
    .prepare("SELECT key, label, accent, stages, readings FROM site_types WHERE org_id = ? ORDER BY label")
    .all(orgId)
    .map((r) => ({
      key: r.key, label: r.label, accent: r.accent,
      stages: JSON.parse(r.stages), readings: JSON.parse(r.readings), equipment: [], custom: true,
    }));
  return [...builtins, ...customs];
}

function createSiteType(orgId, { key, label, accent, stages, readings }) {
  db.prepare("INSERT INTO site_types (org_id, key, label, accent, stages, readings) VALUES (?,?,?,?,?,?)")
    .run(orgId, key, label, accent, JSON.stringify(stages), JSON.stringify(readings));
}

/* ---------------------------------------------------------------- */
/*  Read helpers — org_id is required on every one of them           */
/* ---------------------------------------------------------------- */

function siteWithStages(orgId, siteId) {
  const s = db.prepare("SELECT * FROM sites WHERE id = ? AND org_id = ?").get(siteId, orgId);
  if (!s) return null;
  const type = typeOf(orgId, s.site_type);
  s.type_label = type.label;
  s.accent = type.accent;
  s.tracks_calibration = type.calibration !== false;
  s.equipment_suggestions = type.equipment || [];
  s.open_blockers = db
    .prepare("SELECT COUNT(*) c FROM logs WHERE site_id = ? AND severity='blocker' AND resolved=0")
    .get(siteId).c;
  // Progress is now per equipment item — the site's percent is the average
  // across whatever equipment it has, and 0 with none on the register yet.
  s.equipment = equipmentFor(orgId, siteId);
  s.equipment_count = s.equipment.length;
  s.equipment_done = s.equipment.filter((e) => e.percent === 100).length;
  s.percent = s.equipment.length
    ? Math.round(s.equipment.reduce((t, e) => t + e.percent, 0) / s.equipment.length)
    : 0;
  return s;
}

function listSites(orgId) {
  return db
    .prepare("SELECT id FROM sites WHERE org_id = ? ORDER BY status, id DESC")
    .all(orgId)
    .map((r) => siteWithStages(orgId, r.id));
}

function logWithPhotos(orgId, id) {
  const l = db
    .prepare(
      `SELECT logs.*, users.name AS author, sites.name AS site_name, sites.site_type
       FROM logs JOIN users ON users.id = logs.user_id
       LEFT JOIN sites ON sites.id = logs.site_id
       WHERE logs.id = ? AND logs.org_id = ?`
    )
    .get(id, orgId);
  if (!l) return null;
  l.resolved = !!l.resolved;
  l.photos = db.prepare("SELECT id, filename FROM photos WHERE log_id = ?").all(id);
  return l;
}

// Equipment carries derived service/calibration status and its own commissioning
// checklist, so the client doesn't have to recompute any of it.
function equipmentFor(orgId, siteId) {
  const site = db.prepare("SELECT site_type FROM sites WHERE id = ?").get(siteId);
  const tracksCalibration = site ? typeOf(orgId, site.site_type).calibration !== false : true;
  const rows = db
    .prepare("SELECT * FROM equipment WHERE org_id = ? AND site_id = ? ORDER BY name")
    .all(orgId, siteId);
  const now = new Date();
  return rows.map((e) => {
    let serviceDue = null;
    if (e.last_service && e.service_days) {
      const d = new Date(e.last_service);
      d.setDate(d.getDate() + e.service_days);
      serviceDue = d.toISOString().slice(0, 10);
    }
    const days = (dateStr) =>
      dateStr ? Math.round((new Date(dateStr) - now) / 86400000) : null;
    const svc = days(serviceDue);
    const cal = tracksCalibration ? days(e.calibration_due) : null;
    const worst = [svc, cal].filter((x) => x != null).sort((a, b) => a - b)[0];
    const stages = db
      .prepare("SELECT idx, name, done, done_at, done_by FROM equipment_stages WHERE equipment_id = ? ORDER BY idx")
      .all(e.id)
      .map((x) => ({ ...x, done: !!x.done }));
    const percent = stages.length
      ? Math.round((stages.filter((x) => x.done).length / stages.length) * 100)
      : 0;
    return {
      ...e,
      checked: !!e.checked,
      stages,
      percent,
      calibration_tracked: tracksCalibration,
      service_due: serviceDue,
      service_in_days: svc,
      calibration_in_days: cal,
      status: worst == null ? "ok" : worst < 0 ? "overdue" : worst <= 30 ? "due_soon" : "ok",
    };
  });
}

function createEquipmentStages(orgId, equipmentId, stageNames) {
  const ins = db.prepare("INSERT INTO equipment_stages (org_id, equipment_id, idx, name) VALUES (?,?,?,?)");
  stageNames.forEach((name, i) => ins.run(orgId, equipmentId, i, name));
}

function readingsFor(orgId, siteId, limit = 100) {
  return db
    .prepare(
      `SELECT readings.*, users.name AS author, equipment.name AS equipment_name
       FROM readings JOIN users ON users.id = readings.user_id
       LEFT JOIN equipment ON equipment.id = readings.equipment_id
       WHERE readings.org_id = ? AND readings.site_id = ?
       ORDER BY readings.taken_on DESC, readings.id DESC LIMIT ?`
    )
    .all(orgId, siteId, limit)
    .map((r) => ({ ...r, flagged: !!r.flagged }));
}

module.exports = {
  db,
  siteWithStages,
  listSites,
  logWithPhotos,
  equipmentFor,
  createEquipmentStages,
  readingsFor,
  typeOf,
  typeExists,
  outOfRange,
  listSiteTypes,
  createSiteType,
};
